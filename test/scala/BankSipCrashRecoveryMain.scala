package example.bankwealth.service

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.Behaviors
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.persistence.query.PersistenceQuery
import akka.persistence.query.journal.leveldb.scaladsl.LeveldbReadJournal
import akka.serialization.{SerializationExtension, Serializers}
import akka.stream.{Materializer, SystemMaterializer}
import akka.stream.scaladsl.Sink
import akka.util.Timeout
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.{ArrayNode, ObjectNode}
import com.typesafe.config.{Config, ConfigFactory, ConfigParseOptions}
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash,
  bank_sip_dispatch_v1Execution => Dispatch, bank_ta_submission_v1Execution => Ta,
  bank_payment_hostHost => PaymentHost, bank_payment_hostDefinition => PaymentDefinition,
  bank_sip_dispatchEffectHost => SipHost}
import example.bankwealth.bindings.{BankTaEffectBindings, MockTAClient}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.integration._
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import example.bankwealth.sip.BankSipApplication
import example.bankwealth.ta.BankTaRefundApplication
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.PersistentMonarch
import scalapb.GeneratedMessage

import java.io.{ByteArrayOutputStream, DataOutputStream}
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path, Paths, StandardCopyOption, StandardOpenOption}
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.{ConcurrentHashMap, Executors, ThreadFactory, TimeUnit, TimeoutException}
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}
import scala.collection.mutable
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.reflect.ClassTag
import scala.util.control.NonFatal

/** Standalone cross-JVM SIP child. Exactly seven arguments, like BankCrashRecoveryMain:
  * crash|recover|verify caseName ownedCaseRoot namespace node worker invocationDir.
  *
  * Only crash supplies customer create/operator tick/external TA advance. Successors
  * read the original journal before installing actors, then start BankRecoveryLoop.
  * The nonpersistent plan proxy changes delivery, never decisions or persistence IDs.
  * The parent owns SIGKILL and worker-EOF observation; normal successors close/wait.
  * This package intentionally permits the generated private[service] Principal.
  */
object BankSipCrashRecoveryMain {
  val supportedCases: Vector[String] = Vector(
    "sip-intent-before-create", "sip-create-before-append", "sip-append-before-next",
    "sip-before-seal", "sip-tick-before-catchup", "sip-occurrence-before-dispatch",
    "sip-terminal-before-bridge", "sip-terminal-ack-lost")

  private val mapper = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
  private val reportNames = Vector("ready.json", "barrier.json", "result.json", "closed.json")
  private val javaPid = ProcessHandle.current().pid()
  private val machineToken = "bank-p31-owned-sip-machine-recovery-v1"
  private final case class Settings(mode: String, caseName: String, root: Path, namespace: String,
      node: Path, worker: Path, invocation: Path) {
    def crashing: Boolean = mode == "crash"
    def creationCase: Boolean = supportedCases.take(4).contains(caseName)
    def terminalCase: Boolean = caseName.startsWith("sip-terminal-")
    def tick: Long = if (creationCase) -1L else if (terminalCase) 10L else 20L
    def finalOccurrences: Int = if (creationCase) 0 else if (terminalCase) 1 else 2
  }

  private def noSymlinks(p: Path): Unit = {
    var at = p
    while (at != null) { require(!Files.isSymbolicLink(at), "symlink in owned/configured path refused"); at = at.getParent }
  }
  private def path(text: String, directory: Boolean): Path = {
    val p = Paths.get(text)
    require(p.isAbsolute && p.normalize() == p, "explicit absolute normalized path required")
    noSymlinks(p)
    if (directory) require(Files.isDirectory(p), "explicit existing directory required")
    p
  }
  private def parse(args: Array[String]): Settings = {
    require(args.length == 7, "exactly seven arguments required: mode caseName ownedCaseRoot namespace node worker invocationDir")
    require(Set("crash", "recover", "verify")(args(0)), "mode must be crash, recover or verify")
    require(supportedCases.contains(args(1)), "unsupported SIP crash case")
    val root = path(args(2), directory = true)
    val invocation = path(args(6), directory = true)
    val runs = root.resolve("runs")
    require(Files.isDirectory(runs) && invocation != runs && invocation.startsWith(runs),
      "invocation directory must already exist strictly beneath ownedCaseRoot/runs")
    val s = Settings(args(0), args(1), root, args(3), path(args(4), directory = false),
      path(args(5), directory = false), invocation)
    new BankPersistenceIds(s.namespace)
    MockTAClient.Configuration(s.node, s.worker, s.root)
    (reportNames ++ Vector("worker.jsonl", "worker.stderr.log", ".bank-crash-main.claim")).foreach { name =>
      require(!Files.exists(invocation.resolve(name)), "fresh exclusive invocation files required")
    }
    Files.createFile(invocation.resolve(".bank-crash-main.claim"))
    Vector("journal", "snapshots").foreach { name =>
      val store = root.resolve(name)
      noSymlinks(store)
      if (s.crashing) {
        if (Files.exists(store)) {
          require(Files.isDirectory(store), "owned storage directory required")
          val entries = Files.list(store)
          try require(!entries.findAny().isPresent, "crash requires fresh case storage") finally entries.close()
        } else Files.createDirectory(store)
      } else require(Files.isDirectory(store), "recovery requires the existing case storage")
    }
    val ta = root.resolve("ta.jsonl")
    noSymlinks(ta)
    if (s.crashing) require(!Files.exists(ta), "crash requires a new TA journal")
    else require(Files.isRegularFile(ta), "recovery requires the original TA journal")
    s
  }
  private def storageConfiguration(s: Settings): Config = {
    // Never load the unit/production application configuration or its persistence backend.
    val serializers = ConfigFactory.parseResources("serialization.conf", ConfigParseOptions.defaults().setAllowMissing(false))
    require(serializers.hasPath("akka.actor.serializers.domainProto0") &&
      serializers.hasPath("akka.actor.serializers.strict-saga"), "generated serializer configuration required")
    val top = ConfigFactory.parseString(s"""
      akka.actor.provider = local
      akka.actor.allow-java-serialization = off
      akka.actor.warn-about-java-serializer-usage = on
      akka.loglevel = WARNING
      akka.stdout-loglevel = WARNING
      akka.coordinated-shutdown.run-by-jvm-shutdown-hook = off
      akka.coordinated-shutdown.exit-jvm = off
      akka.persistence.journal.plugin = "akka.persistence.journal.leveldb"
      akka.persistence.journal.auto-start-journals = ["akka.persistence.journal.leveldb"]
      akka.persistence.journal.leveldb {
        class = "akka.persistence.journal.leveldb.LeveldbJournal"
        dir = ${quote(s.root.resolve("journal").toString)}
        native = false
        fsync = true
        checksum = true
      }
      akka.persistence.snapshot-store.plugin = "akka.persistence.snapshot-store.local"
      akka.persistence.snapshot-store.auto-start-snapshot-stores = ["akka.persistence.snapshot-store.local"]
      akka.persistence.snapshot-store.local {
        class = "akka.persistence.snapshot.local.LocalSnapshotStore"
        dir = ${quote(s.root.resolve("snapshots").toString)}
      }
      akka.persistence.query.journal.leveldb {
        write-plugin = "akka.persistence.journal.leveldb"
        refresh-interval = 100ms
        max-buffer-size = 128
      }
    """)
    val config = top.withFallback(serializers).withFallback(ConfigFactory.defaultReference()).resolve()
    require(config.getString("akka.actor.provider") == "local" &&
      config.getString("akka.persistence.journal.plugin") == "akka.persistence.journal.leveldb" &&
      config.getString("akka.persistence.snapshot-store.plugin") == "akka.persistence.snapshot-store.local" &&
      !config.getBoolean("akka.persistence.journal.leveldb.native") && config.getBoolean("akka.persistence.journal.leveldb.fsync"),
      "exclusive local durable configuration required")
    config
  }

  private def quote(s: String): String = mapper.writeValueAsString(s)
  private def sha(bytes: Array[Byte]): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).iterator.map(b => f"${b & 0xff}%02x").mkString
  private def obj(fields: (String, JsonNode)*): ObjectNode = {
    val o = mapper.createObjectNode(); fields.foreach { case (k, v) => o.set[JsonNode](k, v) }; o
  }
  private def array(values: Iterable[JsonNode]): ArrayNode = {
    val a = mapper.createArrayNode(); values.foreach(v => a.add(v)); a
  }
  private def json(value: Any): JsonNode = value match {
    case null => mapper.getNodeFactory.nullNode()
    case n: JsonNode => n
    case s: String => mapper.getNodeFactory.textNode(s)
    case b: Boolean => mapper.getNodeFactory.booleanNode(b)
    case n: Int => mapper.getNodeFactory.numberNode(n)
    case n: Long => if (n.isValidInt) mapper.getNodeFactory.numberNode(n.toInt) else mapper.getNodeFactory.numberNode(n)
    case n: BigDecimal => mapper.getNodeFactory.textNode(n.bigDecimal.stripTrailingZeros().toPlainString)
    case None => mapper.getNodeFactory.nullNode()
    case Some(v) => json(v)
    case m: scala.collection.Map[_, _] => array(m.iterator.map { case (k, v) =>
      obj("key" -> json(k), "value" -> json(v))
    }.toVector.sortBy(n => mapper.writeValueAsString(n.get("key"))))
    case s: scala.collection.Set[_] => array(s.iterator.map(json).toVector.sortBy(mapper.writeValueAsString))
    case xs: Iterable[_] => array(xs.iterator.map(json).toVector)
    case p: Product if p.productArity == 0 => json(p.productPrefix)
    case p: Product => obj(p.productElementNames.zip(p.productIterator).map { case (name, v) => name -> json(v) }.toSeq: _*)
    case other => throw new IllegalArgumentException("unsupported evidence value type: " + other.getClass.getName)
  }
  private def header(schema: String, s: Settings): ObjectNode = obj("schemaVersion" -> json(schema),
    "mode" -> json(s.mode), "caseName" -> json(s.caseName), "pid" -> json(javaPid), "namespace" -> json(s.namespace))
  private def publish(s: Settings, name: String, report: JsonNode): Unit = {
    val target = s.invocation.resolve(name)
    val temporary = s.invocation.resolve("." + name + "." + javaPid + ".tmp")
    require(!Files.exists(target), "report overwrite refused")
    val channel = FileChannel.open(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
    try {
      val bytes = ByteBuffer.wrap((mapper.writeValueAsString(report) + "\n").getBytes(UTF_8))
      while (bytes.hasRemaining) channel.write(bytes)
      channel.force(true)
    } finally channel.close()
    require(!Files.exists(target), "report overwrite refused")
    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE)
  }

  private def payment(o: SipOccurrence): BankPaymentOriginal = BankPaymentOriginal(o.operationId, o.fundOrderId,
    o.config.investorAccountId, o.config.fundCollectionAccountId, o.config.fundCode, o.config.amount)
  private def cashInput(p: BankPaymentOriginal): Cash.State = Cash.State(Cash.Inputs(
    p.operationId, p.operationId, p.investorAccountId, p.fundOrderId, p.fundCollectionAccountId, p.amount, p.fundCode))
  private def paymentTx(o: SipOccurrence): String = PaymentHost.operationIdentity(cashInput(payment(o)))
  private def dispatchInput(o: SipOccurrence): Dispatch.State = Dispatch.State(Dispatch.Inputs(o.occurrenceId, o))
  private final case class Facts(original: BankSipCreateIntent, occurrences: Vector[SipOccurrence], ta: Vector[BankTaEffectRequest])
  private final case class Recorded(row: BankJournalEnvelope, serializerId: Int, manifest: String,
      bytes: Array[Byte], pb: Option[Array[Byte]]) {
    def description: ObjectNode = obj("persistenceId" -> json(row.persistenceId), "sequenceNr" -> json(row.sequenceNr),
      "eventType" -> json(row.event.getClass.getName), "serializerId" -> json(serializerId), "manifest" -> json(manifest),
      "byteCount" -> json(bytes.length), "serializedSha256" -> json(sha(bytes)), "pbSha256" -> json(pb.map(sha)))
  }
  // Identical framing/schema to the cash child; hashes include PID, sequence, serializer and manifest.
  private def vectorHash(rows: Vector[Recorded], pbOnly: Boolean): String = {
    val buffer = new ByteArrayOutputStream(); val out = new DataOutputStream(buffer)
    def framed(bytes: Array[Byte]): Unit = { out.writeInt(bytes.length); out.write(bytes) }
    rows.filter(r => !pbOnly || r.pb.nonEmpty).foreach { r =>
      framed(r.row.persistenceId.getBytes(UTF_8)); out.writeLong(r.row.sequenceNr)
      out.writeInt(r.serializerId); framed(r.manifest.getBytes(UTF_8)); framed(if (pbOnly) r.pb.get else r.bytes)
    }
    out.flush(); sha(buffer.toByteArray)
  }
  private final case class JournalImage(streams: Vector[(String, Vector[Recorded])]) {
    val rows: Vector[Recorded] = streams.flatMap(_._2)
    def events(pid: String): Vector[Any] = streams.find(_._1 == pid).toVector.flatMap(_._2.map(_.row.event))
    def count[A: ClassTag](pid: String): Int = events(pid).count(implicitly[ClassTag[A]].unapply(_).nonEmpty)
    def pbVector: ArrayNode = array(rows.filter(_.pb.nonEmpty).map(_.description))
    def allHash: String = vectorHash(rows, pbOnly = false)
    def pbHash: String = vectorHash(rows, pbOnly = true)
    def report: ObjectNode = obj("persistenceIds" -> json(streams.map(_._1)),
      "allDurableEventsSerializedSha256" -> json(allHash), "allPbEventsSha256" -> json(pbHash),
      "streams" -> array(streams.map { case (pid, events) => obj("persistenceId" -> json(pid),
        "eventCount" -> json(events.size), "lastSequenceNr" -> json(events.lastOption.map(_.row.sequenceNr).getOrElse(0L)),
        "serializedSha256" -> json(vectorHash(events, pbOnly = false)), "pbSha256" -> json(vectorHash(events, pbOnly = true)),
        "events" -> array(events.map(_.description))) }))
  }
  private final case class LedgerFact(kind: String, tx: String, resource: AccountId, amount: Money, pid: String)
  private def ledgerFact(pid: String, event: Any): Option[LedgerFact] = event match {
    case p: CreditBalanceReserveFundsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceReserveFundsConfirmedPB(p); Some(LedgerFact("reserve", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceRecordIncomingCreditsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceRecordIncomingCreditsConfirmedPB(p); Some(LedgerFact("recordIncoming", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceDeductFundsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(p); Some(LedgerFact("deduct", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceCommitIncomingCreditsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(p); Some(LedgerFact("commitIncoming", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceReleaseReservedFundsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceReleaseReservedFundsConfirmedPB(p); Some(LedgerFact("release", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceCancelIncomingCreditConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceCancelIncomingCreditConfirmedPB(p); Some(LedgerFact("cancelIncoming", e.txid.value, e.resource, e.amount, pid))
    case _ => None
  }
  private final case class ObservedState(plan: SipPlanState, orders: Vector[FundOrderState],
      accounts: Vector[CreditBalanceState], sagas: Vector[(OccurrenceId, StrictState)])
  private final case class Withheld(command: SipPlanProtocol.RecordSipInstallmentSucceeded,
      reply: SipPlanAggregate.Reply, destination: ActorRef[SipPlanAggregate.Reply])

  private final class Harness(val settings: Settings, val workDeadline: Deadline)(implicit val system: ActorSystem[Nothing]) {
    implicit private val ec: ExecutionContext = system.executionContext
    implicit private val materializer: Materializer = SystemMaterializer(system).materializer
    implicit private val timeout: Timeout = Timeout(3.seconds)
    val ids = new BankPersistenceIds(settings.namespace)
    private val investor = AccountId("investor")
    private val collection = AccountId("collection")
    private val operatorAccount = AccountId("operator")
    private val request = BankSipCreate("crash-sip-request", "fund", MoneyWire("10000", "CNY"), 0L, Vector(10L, 20L))
    private val alice = Principal("alice", Set("customer"))
    private val operator = Principal("operator", Set("operator"))
    private val config = BankDemoConfiguration("bank-crash-sip-authority-v1", "http://127.0.0.1:18081", Vector(
      BankDemoPrincipal("alice", investor, Set("customer"), "crash-sip-customer-token", "crash-sip-customer-csrf"),
      BankDemoPrincipal("operator", operatorAccount, Set("operator"), "crash-sip-operator-token", "crash-sip-operator-csrf")),
      Vector(BankFund("fund", collection)), Vector(
        BankSeed(investor, "CNY", Money(BigDecimal("1000.00"), "CNY")),
        BankSeed(collection, "CNY", Money(BigDecimal("0.00"), "CNY")),
        BankSeed(operatorAccount, "CNY", Money(BigDecimal("0.00"), "CNY"))))
    private val admission = new BankTrustedAdmission(config)
    // These are actor handles / verified authorization evidence, not durable business maps.
    private val cashGraphs = new ConcurrentHashMap[OperationId, BankCashRuntime]()
    private val verifiedIdentities = ConcurrentHashMap.newKeySet[TransactionIdentity]()
    private val proxies = mutable.ArrayBuffer.empty[ActorRef[_]]
    private var planProxy: Option[BankActorHandle[SipPlanAggregate.Request]] = None
    private var proxiesClosed = false
    private val blocked = Promise[Unit]()
    private val heldCommand = new AtomicReference[SipPlanProtocol.Command](null)
    private val withheldAcks = new AtomicInteger(0)
    private val nonemptyAcks = new AtomicInteger(0)
    private val forwardedTerminals = new AtomicInteger(0)
    private val withheldEvents = new AtomicReference[Vector[SipPlanProtocol.Event]](Vector.empty)
    private val faultFailure = new AtomicReference[Throwable](null)
    private val blockedDispatch = new AtomicReference[SipOccurrence](null)
    private val neverDispatch = Promise[BankSipDispatchRuntime]()
    private var sourceOriginal: BankSipCreateIntent = null
    private var readQuery: LeveldbReadJournal = null
    private var raw: BankPersistenceJournal = null
    private var client: MockTAClient = null
    private var runtime: BankRuntime = null
    private var directory: BankRuntimeDirectory = null
    private var cash: BankCashRequests = null
    private var sip: BankSipApplication = null
    private var ta: BankTaRefundApplication = null
    private var recovery: BankRecovery = null
    private var loop: BankRecoveryLoop = null
    private var runtimeClosed = false
    private var driversClosed = false
    var nodePid: Long = 0L

    private def await[A](f: Future[A]): A = {
      require(workDeadline.hasTimeLeft(), "main work deadline exceeded")
      Await.result(f, workDeadline.timeLeft.min(10.seconds))
    }
    private def eventually(label: String)(body: => Unit): Unit = {
      var last: Throwable = null; var done = false
      while (!done && workDeadline.hasTimeLeft()) {
        try { require(faultFailure.get() == null, "command proxy failed"); body; done = true }
        catch { case NonFatal(error) => last = error }
        if (!done) Thread.sleep(100L)
      }
      if (!done) throw new IllegalStateException("deadline waiting for " + label, last)
    }
    private def initializeJournal(): Unit = {
      Class.forName("org.iq80.leveldb.impl.Iq80DBFactory")
      readQuery = PersistenceQuery(system.toClassic).readJournalFor[LeveldbReadJournal](LeveldbReadJournal.Identifier)
      raw = new BankPersistenceJournal(ids.namespace, readQuery, () => readQuery.currentPersistenceIds())
    }
    private def image(): JournalImage = {
      val pids = await(readQuery.currentPersistenceIds().runWith(Sink.seq)).toVector.distinct.sorted
      require(pids.forall(ids.owns), "foreign persistence ID in exclusive case journal")
      val serialization = SerializationExtension(system.toClassic)
      JournalImage(await(Future.traverse(pids) { pid => raw.currentEvents(pid, 0L).map { rows =>
        require(rows.nonEmpty && rows.zipWithIndex.forall { case (r, i) => r.persistenceId == pid && r.sequenceNr == i.toLong + 1L },
          "complete nonempty contiguous journal streams required")
        pid -> rows.map { row =>
          val event = row.event.asInstanceOf[AnyRef]
          val serializer = serialization.findSerializerFor(event)
          Recorded(row, serializer.identifier, Serializers.manifestFor(serializer, event), serialization.serialize(event).get,
            row.event match { case p: GeneratedMessage => Some(p.toByteArray); case _ => None })
        }
      } }))
    }
    private def initializeWorker(): Unit = {
      client = new MockTAClient(MockTAClient.Configuration(settings.node, settings.worker, settings.root),
        settings.root.resolve("ta.jsonl"), settings.invocation.resolve("worker.jsonl"), settings.invocation.resolve("worker.stderr.log"))
      val readinessId = "bank-p31-sip-worker-readiness"
      val response = await(client.query(readinessId))
      require(response.path("requestId").asText() == readinessId && response.path("status").asText() == "unknown",
        "real worker readiness acknowledgement required")
      val starts = workerLog().filter(_.path("kind").asText() == "worker-started")
      require(starts.size == 1 && starts.head.path("pid").isIntegralNumber && starts.head.path("pid").asLong() > 0L,
        "exact worker-started PID required")
      nodePid = starts.head.path("pid").asLong()
    }

    /** Validate the three retained occurrence IDs by decoding their original framed
      * payload, without inventing a plan state or trusting a replacement identity. */
    private def validateOccurrence(o: SipOccurrence, intent: BankSipCreateIntent): Unit = {
      require(o.planId == intent.planId && o.config == intent.config && o.revision == intent.config.revision &&
        intent.request.dueSlots.contains(o.dueSlot), "occurrence changed admitted plan/config/due slot")
      val prefix = "sip-occurrence-v1/"
      require(o.occurrenceId.value.startsWith(prefix), "original occurrence identity format required")
      val payload = o.occurrenceId.value.drop(prefix.length)
      val bytes = Base64.getUrlDecoder.decode(payload)
      require(Base64.getUrlEncoder.withoutPadding().encodeToString(bytes) == payload &&
        o.operationId.value == "sip-payment-v1/" + payload && o.fundOrderId.value == "sip-order-v1/" + payload,
        "occurrence/payment/order identities are not the same original framed identity")
      val buffer = ByteBuffer.wrap(bytes)
      def component(): String = {
        require(buffer.remaining() >= 4, "truncated occurrence identity")
        val length = buffer.getInt()
        require(length > 0 && length <= buffer.remaining(), "invalid occurrence identity component")
        val text = new Array[Byte](length); buffer.get(text); new String(text, UTF_8)
      }
      require(component() == intent.planId.value && component() == intent.config.revision.value &&
        buffer.remaining() == 8 && buffer.getLong() == o.dueSlot && !buffer.hasRemaining,
        "retained occurrence identity does not encode its original plan/revision/due slot")
    }
    private def facts(i: JournalImage): Facts = {
      val originals = i.rows.collect { case r if r.row.event.isInstanceOf[SipPlanSipCreateIntentRecordedPB] =>
        val e = DomainConverters.decodeSipPlanSipCreateIntentRecordedPB(r.row.event.asInstanceOf[SipPlanSipCreateIntentRecordedPB])
        admission.validateSip(e.intent)
        require(e.source.contains(e.intent) && r.row.persistenceId == ids.plan(e.intent.planId), "complete original create source/PID required")
        e.intent
      }
      require(originals.size == 1, "exactly one durable original SIP create intent required")
      val original = originals.head
      require(original.principalId == "alice" && original.clientRequestId == "crash-sip-request" && original.request == request &&
        original.config.investorAccountId == investor && original.config.fundCollectionAccountId == collection &&
        original.config.amount == Money(BigDecimal("100.00"), "CNY"), "durable original differs from the fixed SIP oracle")
      val occurrences = i.rows.collect { case r if r.row.event.isInstanceOf[SipPlanSipInstallmentTriggeredPB] =>
        val e = DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(r.row.event.asInstanceOf[SipPlanSipInstallmentTriggeredPB])
        require(r.row.persistenceId == ids.plan(original.planId) && e.position >= 0L && e.position < request.dueSlots.size &&
          request.dueSlots(e.position.toInt) == e.occurrence.dueSlot, "trigger changed original positional schedule")
        validateOccurrence(e.occurrence, original); e.occurrence
      }.sortBy(_.dueSlot)
      require(occurrences.map(_.dueSlot).distinct.size == occurrences.size &&
        occurrences.map(_.occurrenceId).distinct.size == occurrences.size, "duplicate original occurrence")
      val registrations = i.rows.collect { case r if r.row.event.isInstanceOf[FundOrderFundTASubmissionRegisteredPB] =>
        val e = DomainConverters.decodeFundOrderFundTASubmissionRegisteredPB(r.row.event.asInstanceOf[FundOrderFundTASubmissionRegisteredPB])
        val o = occurrences.find(_.fundOrderId == e.fundOrderId).getOrElse(throw new IllegalStateException("TA registration lacks original occurrence"))
        require(r.row.persistenceId == ids.order(o.fundOrderId) && e.paymentTxId.value == paymentTx(o) && e.taRequestId.value.nonEmpty,
          "TA registration changed original transaction/PID")
        BankTaEffectRequest(e.taRequestId, e.fundOrderId, e.paymentTxId)
      }.sortBy(_.fundOrderId.value)
      require(registrations.map(_.fundOrderId).distinct.size == registrations.size &&
        registrations.map(_.taRequestId).distinct.size == registrations.size, "duplicate original TA registration")
      Facts(original, occurrences, registrations)
    }
    private def verifiedOccurrence(o: SipOccurrence): Future[Unit] = raw.readPb(ids.plan(o.planId)).map { rows =>
      val originals = rows.collect { case p: SipPlanSipCreateIntentRecordedPB => DomainConverters.decodeSipPlanSipCreateIntentRecordedPB(p) }
      require(originals.size == 1 && originals.head.source.contains(originals.head.intent), "dispatch needs the real original create source")
      admission.validateSip(originals.head.intent)
      require(originals.head.intent == sourceOriginal, "dispatch outside this original SIP request")
      validateOccurrence(o, originals.head.intent)
      val triggered = rows.collect { case p: SipPlanSipInstallmentTriggeredPB => DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(p) }
      require(triggered.count(_.occurrence == o) == 1 && triggered.forall(e =>
        e.position >= 0 && e.position < request.dueSlots.size && request.dueSlots(e.position.toInt) == e.occurrence.dueSlot),
        "dispatch requires exact original triggered PB, not a guessed due occurrence")
    }
    private def rememberIdentity(o: SipOccurrence, events: Vector[Any]): Unit = {
      val p = payment(o); val input = cashInput(p)
      val associated = events.collect { case e: PaymentHost.Associated => e }
      require(associated.size <= 1, "duplicate payment host association")
      associated.foreach(e => require(Cash.codec.decode(e.original.toByteArray) == input &&
        java.util.Arrays.equals(e.original.toByteArray, Cash.codec.encode(input)) && e.operation == paymentTx(o) &&
        e.args == PaymentDefinition.argsCodec.encode(PaymentHost.invocationArgs(input)), "host changed complete original input/args"))
      val identities = events.collect { case e: PaymentHost.IdentityObserved => e.identity }
      require(identities.size <= 1 && (identities.isEmpty || associated.nonEmpty), "identity without one original host association")
      identities.foreach { identity =>
        require(identity.transactionId == paymentTx(o) && identity.definitionName == "bank-cash-payment-v1" &&
          identity.definitionVersion == 1 &&
          identity.definitionDigest == "sha256:c13f703e76eaee9bfceeff701ecc5f41dd011d6db6890c6820a7faa944538f64" &&
          identity.argsCodec == PaymentDefinition.argsCodec.pin &&
          identity.argsDigest == sha(associated.head.args.toByteArray), "host identity differs from verified original args")
        verifiedIdentities.add(identity)
      }
    }
    private def rememberCash(o: SipOccurrence, graph: BankCashRuntime): Future[BankCashRuntime] = {
      require(graph.original == payment(o) && graph.transactionId == paymentTx(o) &&
        graph.parent.persistenceId == ids.paymentRun(o.operationId) && graph.host.persistenceId == ids.paymentHost(o.operationId) &&
        graph.coordinator.persistenceId == ids.paymentSaga(o.operationId), "runtime changed original payment graph")
      cashGraphs.put(o.operationId, graph)
      raw.readAll(ids.paymentHost(o.operationId)).map { events => rememberIdentity(o, events); graph }
    }
    private def markBlocked(command: SipPlanProtocol.Command): Unit = {
      val old = heldCommand.get()
      require(old == null || old == command, "fault intercepted a different original command")
      heldCommand.compareAndSet(null, command); blocked.trySuccess(())
    }
    private def beforeForward(c: SipPlanProtocol.Command): Boolean = (settings.caseName, c) match {
      case ("sip-intent-before-create", p: SipPlanProtocol.CreateSipPlan) =>
        require(p.planId == sourceOriginal.planId && p.config == sourceOriginal.config, "create proxy changed original"); true
      case ("sip-create-before-append", p: SipPlanProtocol.AppendSipDueSlot) if p.position == 0L =>
        require(p.dueSlot == 10L, "first original append required"); true
      case ("sip-append-before-next", p: SipPlanProtocol.AppendSipDueSlot) if p.position == 1L =>
        require(p.dueSlot == 20L, "second original append required"); true
      case ("sip-before-seal", _: SipPlanProtocol.SealSipSchedule) => true
      case ("sip-tick-before-catchup", p: SipPlanProtocol.ObserveSipDueSlot) if p.position == 0L =>
        require(p.dueSlot == 10L, "first original observation required"); true
      case ("sip-terminal-before-bridge", p: SipPlanProtocol.RecordSipInstallmentSucceeded) =>
        validateOccurrence(p.occurrence, sourceOriginal); require(p.occurrence.dueSlot == 10L && p.evidence == "ta-confirmed", "original real success required"); true
      case _ => false
    }
    private def proxy(h: BankActorHandle[SipPlanAggregate.Request]): BankActorHandle[SipPlanAggregate.Request] = synchronized {
      require(h.persistenceId == ids.plan(sourceOriginal.planId) && !proxiesClosed, "proxy must retain the real plan PID")
      planProxy.getOrElse {
        val ref = system.systemActorOf(Behaviors.setup[Any] { context =>
          Behaviors.receiveMessage[Any] { message =>
            try {
              message match {
                case e: SipPlanAggregate.Execute if beforeForward(e.command) => markBlocked(e.command)
                case e: SipPlanAggregate.Execute if settings.caseName == "sip-terminal-ack-lost" &&
                    e.command.isInstanceOf[SipPlanProtocol.RecordSipInstallmentSucceeded] =>
                  val command = e.command.asInstanceOf[SipPlanProtocol.RecordSipInstallmentSucceeded]
                  validateOccurrence(command.occurrence, sourceOriginal)
                  require(command.occurrence.dueSlot == 10L && command.evidence == "ta-confirmed" &&
                    command.receiptId.nonEmpty && command.receiptBody.nonEmpty, "ACK fault needs real original success command")
                  val old = heldCommand.get()
                  require(old == null || old == command, "ACK fault cannot swallow a changed duplicate")
                  heldCommand.compareAndSet(null, command)
                  // Forward the exact business command; only its replyTo is an adapter.
                  // The aggregate's nonempty Accepted is sent AFTER its real persist.
                  val adapter = context.spawnAnonymous(Behaviors.receiveMessage[SipPlanAggregate.Reply] { reply =>
                    context.self ! Withheld(command, reply, e.replyTo); Behaviors.stopped
                  })
                  forwardedTerminals.incrementAndGet()
                  h.ref ! SipPlanAggregate.Execute(command, adapter)
                case Withheld(command, accepted: SipPlanAggregate.Accepted, _) =>
                  require(heldCommand.get() == command, "withheld ACK original mismatch")
                  if (accepted.events.nonEmpty) {
                    require(accepted.events.size == 1 && accepted.events.head.isInstanceOf[SipPlanProtocol.SipInstallmentSucceeded],
                      "ACK fault must observe actual nonempty generated success")
                    val event = accepted.events.head.asInstanceOf[SipPlanProtocol.SipInstallmentSucceeded]
                    require(event.occurrence == command.occurrence && event.evidence == command.evidence &&
                      event.receiptId == command.receiptId && event.receiptBody == command.receiptBody && event.outcome == "succeeded",
                      "durable Accepted changed original terminal evidence")
                    withheldEvents.set(accepted.events); nonemptyAcks.incrementAndGet()
                  }
                  withheldAcks.incrementAndGet()
                  if (nonemptyAcks.get() > 0) blocked.trySuccess(())
                  // Also swallow every later matching empty duplicate Accepted until kill.
                case Withheld(_, refused, destination) =>
                  faultFailure.compareAndSet(null, new IllegalStateException("real terminal command was refused")); destination ! refused
                case request: SipPlanAggregate.Request => h.ref ! request // GetState always reaches the real actor.
                case _ => throw new IllegalArgumentException("unknown plan proxy message")
              }
              Behaviors.same
            } catch { case NonFatal(error) => faultFailure.compareAndSet(null, error); throw error }
          }
        }, "bank-p31-sip-command-proxy")
        proxies += ref
        val result = BankActorHandle(h.persistenceId, ref.narrow[SipPlanAggregate.Request])
        planProxy = Some(result); result
      }
    }
    private val scenarioForOrder: FundOrderId => String = id => {
      // These cached handles were obtained only after verifiedOccurrence read the
      // original PB. Do not block an actor dispatcher on a second full journal scan.
      require(cashGraphs.values().asScala.exists(_.original.fundOrderId == id), "scenario for a foreign original order")
      if (settings.terminalCase) "confirmed" else "accepted"
    }
    private def initializeRuntime(): Unit = {
      runtime = new BankRuntime(ids.namespace, raw, new ReconcileAuthorizer {
        def authorize(identity: TransactionIdentity, token: String): Either[String, String] =
          if (identity != null && token == machineToken && verifiedIdentities.contains(identity)) Right("bank-p31-owned-sip-machine")
          else Left("no authority for an unverified original transaction identity")
      }, BankTaEffectBindings.forOrders(client, scenarioForOrder))
      directory = new BankRuntimeDirectory {
        def account(id: AccountId): Future[BankActorHandle[CreditBalanceAggregate.Request]] = {
          require(config.seeds.exists(_.accountId == id), "foreign account lookup"); runtime.account(id)
        }
        def plan(id: PlanId): Future[BankActorHandle[SipPlanAggregate.Request]] = {
          require(id == sourceOriginal.planId, "foreign plan lookup")
          runtime.plan(id).map(h => if (settings.crashing) proxy(h) else h)
        }
        def order(id: FundOrderId): Future[BankActorHandle[FundOrderAggregate.Request]] = raw.readPb(ids.plan(sourceOriginal.planId)).flatMap { rows =>
          require(rows.collect { case p: SipPlanSipInstallmentTriggeredPB => DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(p).occurrence }
            .exists(_.fundOrderId == id), "order lookup lacks original triggered PB")
          runtime.order(id)
        }
        def ensureCash(original: BankPaymentOriginal): Future[BankCashRuntime] = raw.readPb(ids.plan(sourceOriginal.planId)).flatMap { rows =>
          val occurrences = rows.collect { case p: SipPlanSipInstallmentTriggeredPB => DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(p).occurrence }
          val o = occurrences.find(o => payment(o) == original).getOrElse(throw new IllegalStateException("cash graph lacks original occurrence"))
          verifiedOccurrence(o).flatMap(_ => runtime.ensureCash(original)).flatMap(rememberCash(o, _))
        }
        def ensureRefund(original: BankRefundOriginal): Future[BankRefundRuntime] =
          Future.failed(new IllegalStateException("this SIP oracle has no refund graph"))
        def ensureTa(request: BankTaEffectRequest): Future[BankTaRuntime] = raw.readPb(ids.order(request.fundOrderId)).flatMap { rows =>
          val registrations = rows.collect { case p: FundOrderFundTASubmissionRegisteredPB => DomainConverters.decodeFundOrderFundTASubmissionRegisteredPB(p) }
          require(registrations.size == 1 && BankTaEffectRequest(registrations.head.taRequestId, registrations.head.fundOrderId,
            registrations.head.paymentTxId) == request, "TA graph lacks exact original registration")
          runtime.ensureTa(request)
        }
        def ensureSipDispatch(o: SipOccurrence): Future[BankSipDispatchRuntime] = verifiedOccurrence(o).flatMap { _ =>
          if (settings.crashing && settings.caseName == "sip-occurrence-before-dispatch") {
            blockedDispatch.compareAndSet(null, o); blocked.trySuccess(())
            neverDispatch.future // BEFORE runtime delegate, even its settlement command.
          } else runtime.ensureSipDispatch(o).flatMap { graph =>
            require(graph.occurrence == o && graph.host.persistenceId == ids.sipHost(o.occurrenceId) &&
              graph.parent.persistenceId == ids.sipRun(o.occurrenceId), "SIP runtime changed original graph")
            // BankRuntime.ensureSipDispatch invokes its OWN ensureCash, bypassing this
            // outer directory. Re-obtain only that same cached graph and register its
            // real host identity; never assume outer ensureCash saw that invocation.
            runtime.ensureCash(payment(o)).flatMap(rememberCash(o, _)).map(_ => graph)
          }
        }
        def close(): Unit = closeRuntime()
      }
      cash = new BankCashRequests(directory, config, admission, raw)
      sip = new BankSipApplication(directory, raw, config, admission)
      recovery = new BankRecovery(directory, raw, config, cash, machineToken)
      ta = new BankTaRefundApplication(directory, raw, client, scenarioForOrder, id =>
        raw.readPb(ids.plan(sourceOriginal.planId)).flatMap { rows =>
          val occurrences = rows.collect { case p: SipPlanSipInstallmentTriggeredPB => DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(p).occurrence }
            .filter(_.fundOrderId == id)
          require(occurrences.size == 1, "TA terminal callback must resolve exactly one actual triggered PB")
          verifiedOccurrence(occurrences.head).flatMap(_ => sip.recordTerminal(occurrences.head)).map { result =>
            require(result.isRight, "real SIP terminal callback remains unacknowledged"); ()
          }
        }, config, admission, 100.millis)
      loop = new BankRecoveryLoop(raw, cash, ta, sip, recovery)
    }

    private def ledger(i: JournalImage): Vector[LedgerFact] = i.rows.flatMap(r => ledgerFact(r.row.persistenceId, r.row.event))
    private def checkSeeds(i: JournalImage): Unit = config.seeds.foreach { seed =>
      val initialized = i.events(ids.account(seed.accountId)).collect { case p: CreditBalanceAccountInitializedPB =>
        DomainConverters.decodeCreditBalanceAccountInitializedPB(p)
      }
      require(initialized.size == 1 && initialized.head.resource == seed.accountId && initialized.head.currency == seed.currency &&
        initialized.head.amount == seed.amount, "one matching original account initialization required")
    }
    private def checkKnown(i: JournalImage, f: Facts): Unit = {
      val base = config.seeds.map(s => ids.account(s.accountId)).toSet + ids.plan(f.original.planId)
      val known = base ++ f.occurrences.flatMap(o => Vector(ids.order(o.fundOrderId), ids.paymentSaga(o.operationId),
        ids.paymentHost(o.operationId), ids.paymentRun(o.operationId), ids.sipHost(o.occurrenceId), ids.sipRun(o.occurrenceId))) ++
        f.ta.flatMap(t => Vector(ids.taHost(t.taRequestId), ids.taRun(t.taRequestId)))
      require(base.subsetOf(i.streams.map(_._1).toSet) && i.streams.forall(s => known(s._1)), "missing source/account stream or unknown durable graph")
      require(i.rows.filter(_.pb.nonEmpty).forall(r => base(r.row.persistenceId) || f.occurrences.exists(o => ids.order(o.fundOrderId) == r.row.persistenceId)),
        "domain PB in an unexpected graph")
      val transactions = f.occurrences.map(paymentTx).toSet
      require(ledger(i).forall(e => transactions(e.tx)), "unrelated financial transaction")
      config.seeds.foreach { seed => i.events(ids.account(seed.accountId)).foreach {
        case _: CreditBalanceAccountInitializedPB => ()
        case e if ledgerFact(ids.account(seed.accountId), e).nonEmpty => ()
        case _ => throw new IllegalStateException("unexpected account durable event")
      }}
    }
    private def checkParent[S](i: JournalImage, pid: String, run: String, input: S, encode: S => Array[Byte],
        decode: Array[Byte] => S, cursor: String, starts: Int, done: Int): Unit = {
      val originals = i.events(pid).collect { case e: PersistentMonarch.RunStarted => e }
      require(originals.size == starts && i.count[PersistentMonarch.StageDone](pid) == done &&
        i.count[PersistentMonarch.RunFailedEvt](pid) == 0, "exact parent original/checkpoint counts required: " + pid)
      originals.foreach(e => require(e.runId == run && e.stageCursors == Vector(cursor) && decode(e.initialSnapshot) == input &&
        java.util.Arrays.equals(e.initialSnapshot, encode(input)), "parent changed original input bytes/cursor/run identity"))
    }
    private def checkLedger(i: JournalImage, o: SipOccurrence, expected: Int): Unit = {
      val events = ledger(i).filter(_.tx == paymentTx(o))
      Vector("reserve", "recordIncoming", "deduct", "commitIncoming").foreach(kind =>
        require(events.count(_.kind == kind) == expected, "one original payment ledger phase required: " + kind))
      require(events.forall(e => Set("reserve", "recordIncoming", "deduct", "commitIncoming")(e.kind)), "unexpected compensation/reversal")
      events.foreach { e =>
        val resource = if (Set("reserve", "deduct")(e.kind)) investor else collection
        require(e.resource == resource && e.pid == ids.account(resource) && e.amount == o.config.amount, "ledger substituted original resource/amount/PID")
      }
    }
    private def checkPayment(i: JournalImage, f: Facts, o: SipOccurrence): Unit = {
      val pid = ids.order(o.fundOrderId)
      val settlements = i.events(pid).collect { case p: FundOrderFundPurchaseSettlementRequestedPB =>
        DomainConverters.decodeFundOrderFundPurchaseSettlementRequestedPB(p)
      }
      require(settlements.size == 1 && BankPaymentOriginal(settlements.head.operationId, settlements.head.fundOrderId,
        settlements.head.investorAccountId, settlements.head.fundCollectionAccountId, settlements.head.fundCode, settlements.head.amount) == payment(o),
        "exact original occurrence settlement required")
      require(i.count[FundOrderCashRequestSourceRecordedPB](pid) == 0 && i.count[FundOrderReserveFundSubscriptionConfirmedPB](pid) == 1 &&
        i.count[FundOrderFundSubscriptionPaymentConfirmedPB](pid) == 1 && i.count[FundOrderFundCashPaymentSucceededPB](pid) == 1 &&
        i.count[FundOrderFundPurchaseRefundRequestedPB](pid) == 0 && i.count[FundOrderFundTARejectedPB](pid) == 0 &&
        i.count[FundOrderFundRefundSucceededPB](pid) == 0, "SIP payment business vector is not exactly once/no-refund")
      val succeeded = i.events(pid).collect { case p: FundOrderFundCashPaymentSucceededPB => DomainConverters.decodeFundOrderFundCashPaymentSucceededPB(p) }
      require(succeeded.head.txid.value == paymentTx(o) && succeeded.head.kind == "succeeded", "payment result changed original transaction")
      checkLedger(i, o, 1)
      checkParent(i, ids.paymentRun(o.operationId), o.operationId.value, cashInput(payment(o)),
        Cash.codec.encode, Cash.codec.decode, "pay-cash-purchase#0", 1, 1)
      checkParent(i, ids.sipRun(o.occurrenceId), o.occurrenceId.value, dispatchInput(o),
        Dispatch.codec.encode, Dispatch.codec.decode, "dispatch-cash#0", 1, 1)
      rememberIdentity(o, i.events(ids.paymentHost(o.operationId)))
      require(i.count[PaymentHost.Associated](ids.paymentHost(o.operationId)) == 1 &&
        i.count[PaymentHost.IdentityObserved](ids.paymentHost(o.operationId)) == 1, "one original host association/identity required")
      val t = f.ta.find(_.fundOrderId == o.fundOrderId).getOrElse(throw new IllegalStateException("original TA registration missing"))
      checkParent(i, ids.taRun(t.taRequestId), t.taRequestId.value, Ta.State(Ta.Inputs(t.taRequestId, t.fundOrderId, t.paymentTxId)),
        Ta.codec.encode, Ta.codec.decode, "submit-ta#0", 1, 1)
      val confirmations = i.events(pid).collect { case p: FundOrderFundTASharesConfirmedPB => DomainConverters.decodeFundOrderFundTASharesConfirmedPB(p) }
      require(confirmations.size == (if (settings.terminalCase) 1 else 0), "technical TA acceptance was promoted into a terminal")
      confirmations.foreach(e => require(e.fundOrderId == o.fundOrderId && e.paymentTxId.value == paymentTx(o) &&
        e.taRequestId == t.taRequestId && e.fundCode == o.config.fundCode && e.currency == o.config.amount.currency &&
        e.receiptId.nonEmpty && e.receiptBody.nonEmpty && e.shares.shares.value.nonEmpty, "TA confirmation changed original correlation/evidence"))
    }
    private def checkPlan(i: JournalImage, f: Facts, created: Int, appended: Int, sealedCount: Int,
        clocks: Int, observed: Int, triggered: Int, successes: Int): Unit = {
      val pid = ids.plan(f.original.planId); val events = i.events(pid)
      val kinds = Vector.fill(1)(classOf[SipPlanSipCreateIntentRecordedPB].getName) ++
        Vector.fill(created)(classOf[SipPlanSipPlanCreatedPB].getName) ++ Vector.fill(appended)(classOf[SipPlanSipDueSlotAppendedPB].getName) ++
        Vector.fill(sealedCount)(classOf[SipPlanSipScheduleSealedPB].getName) ++ Vector.fill(clocks)(classOf[SipPlanSipClockAdvancedPB].getName) ++
        Vector.fill(observed)(classOf[SipPlanSipDueSlotObservedPB].getName) ++ Vector.fill(triggered)(classOf[SipPlanSipInstallmentTriggeredPB].getName) ++
        Vector.fill(successes)(classOf[SipPlanSipInstallmentSucceededPB].getName)
      require(events.map(_.getClass.getName) == kinds, "exact selected plan PB prefix/vector required")
      events.collect { case p: SipPlanSipPlanCreatedPB => DomainConverters.decodeSipPlanSipPlanCreatedPB(p) }.foreach(e =>
        require(e.planId == f.original.planId && e.config == f.original.config, "created original mismatch"))
      val appends = events.collect { case p: SipPlanSipDueSlotAppendedPB => DomainConverters.decodeSipPlanSipDueSlotAppendedPB(p) }
      require(appends.map(e => e.position -> e.dueSlot) == request.dueSlots.take(appended).zipWithIndex.map { case (slot, position) => position.toLong -> slot },
        "append is not the exact original positional prefix")
      events.collect { case p: SipPlanSipScheduleSealedPB => DomainConverters.decodeSipPlanSipScheduleSealedPB(p) }.foreach(e => require(e.`sealed`, "schedule not sealed"))
      events.collect { case p: SipPlanSipClockAdvancedPB => DomainConverters.decodeSipPlanSipClockAdvancedPB(p) }.foreach(e =>
        require(e.tick == settings.tick, "clock not the original operator tick"))
      val observations = events.collect { case p: SipPlanSipDueSlotObservedPB => DomainConverters.decodeSipPlanSipDueSlotObservedPB(p) }
      require(observations.map(e => e.position -> e.dueSlot) == request.dueSlots.take(observed).zipWithIndex.map { case (slot, position) => position.toLong -> slot } &&
        observations.forall(_.disposition == "backlog"), "observation changed original due prefix/disposition")
      require(f.occurrences.size == triggered && f.occurrences.map(_.dueSlot) == request.dueSlots.take(triggered), "original trigger prefix mismatch")
      val terminals = events.collect { case p: SipPlanSipInstallmentSucceededPB => DomainConverters.decodeSipPlanSipInstallmentSucceededPB(p) }
      terminals.foreach { e =>
        require(f.occurrences.contains(e.occurrence) && e.evidence == "ta-confirmed" && e.outcome == "succeeded" &&
          e.receiptId == "bank-sip-terminal-v1/" + e.occurrence.occurrenceId.value, "first terminal original/evidence mismatch")
        val confirmations = i.events(ids.order(e.occurrence.fundOrderId)).collect { case p: FundOrderFundTASharesConfirmedPB =>
          DomainConverters.decodeFundOrderFundTASharesConfirmedPB(p)
        }
        require(confirmations.size == 1 && confirmations.head.receiptBody == e.receiptBody &&
          confirmations.head.paymentTxId.value == paymentTx(e.occurrence), "terminal lacks exact original TA confirmation PB body")
      }
    }
    private def checkPrefix(i: JournalImage, f: Facts): Unit = {
      checkSeeds(i); checkKnown(i, f)
      settings.caseName match {
        case "sip-intent-before-create" => checkPlan(i, f, 0, 0, 0, 0, 0, 0, 0)
        case "sip-create-before-append" => checkPlan(i, f, 1, 0, 0, 0, 0, 0, 0)
        case "sip-append-before-next" => checkPlan(i, f, 1, 1, 0, 0, 0, 0, 0)
        case "sip-before-seal" => checkPlan(i, f, 1, 2, 0, 0, 0, 0, 0)
        case "sip-tick-before-catchup" => checkPlan(i, f, 1, 2, 1, 1, 0, 0, 0)
        case "sip-occurrence-before-dispatch" => checkPlan(i, f, 1, 2, 1, 1, 2, 2, 0)
        case "sip-terminal-before-bridge" => checkPlan(i, f, 1, 2, 1, 1, 1, 1, 0)
        case "sip-terminal-ack-lost" => checkPlan(i, f, 1, 2, 1, 1, 1, 1, 1)
      }
      if (!settings.terminalCase) {
        require(f.ta.isEmpty && ledger(i).isEmpty && i.streams.map(_._1).toSet ==
          (config.seeds.map(s => ids.account(s.accountId)).toSet + ids.plan(f.original.planId)),
          "pre-dispatch barrier already has settlement/host/parent/payment/TA effects")
      } else {
        require(f.ta.size == 1, "terminal barrier needs the actual original TA graph")
        f.occurrences.foreach(checkPayment(i, f, _))
      }
    }
    private def observed(i: JournalImage, f: Facts): ObservedState = {
      val plan = await(await(runtime.plan(f.original.planId)).ref.ask[SipPlanState](SipPlanAggregate.GetState))
      val orders = f.occurrences.filter(o => i.events(ids.order(o.fundOrderId)).nonEmpty).map(o =>
        await(await(runtime.order(o.fundOrderId)).ref.ask[FundOrderState](FundOrderAggregate.GetState)))
      val accounts = config.seeds.map(seed => await(await(runtime.account(seed.accountId)).ref.ask[CreditBalanceState](CreditBalanceAggregate.GetState)))
      val sagas = f.occurrences.flatMap { o => Option(cashGraphs.get(o.operationId)).map { g =>
        val state = await(g.coordinator.ref.ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus)) match {
          case StrictSagaCoordinator.Status(s) => s
          case _ => throw new IllegalStateException("real coordinator did not return status")
        }
        o.occurrenceId -> state
      }}
      ObservedState(plan, orders, accounts, sagas)
    }
    private def checkState(i: JournalImage, f: Facts, s: ObservedState, complete: Boolean): Unit = {
      val p = s.plan; val pid = ids.plan(f.original.planId)
      val created = i.count[SipPlanSipPlanCreatedPB](pid) == 1
      val appended = i.count[SipPlanSipDueSlotAppendedPB](pid)
      val positions = request.dueSlots.take(appended).zipWithIndex.map { case (slot, position) => position.toLong -> slot }.toMap
      val succeeded = i.events(pid).collect { case raw: SipPlanSipInstallmentSucceededPB => DomainConverters.decodeSipPlanSipInstallmentSucceededPB(raw) }
      require(p.id == f.original.planId && p.createIntent.contains(f.original) && p.sipCreateIntents == Map("original" -> f.original) &&
        p.createIntentDueSlots == request.dueSlots && p.initialized == created && p.scheduleCount == appended.toLong &&
        p.slots == positions && p.intentAppendedDueSlots == positions.map { case (position, slot) => slot -> position } &&
        p.lastDueSlot == request.dueSlots.take(appended).lastOption.getOrElse(-1L) &&
        p.scheduleSealed == (i.count[SipPlanSipScheduleSealedPB](pid) == 1), "generated plan differs from complete original schedule prefix")
      require(p.revisions == (if (created) Map(f.original.config.revision -> f.original.config) else Map.empty[RevisionId, SipRevisionConfig]) &&
        p.revisionEnds.isEmpty && p.latestRevision == (if (created) f.original.config.revision else RevisionId("")) &&
        p.latestEffectiveSlot == (if (created) 0L else -1L) && !p.paused && p.pauseTick == -1L && p.pauseIntervals.isEmpty,
        "plan fabricated revisions or pause history")
      val clock = if (i.count[SipPlanSipClockAdvancedPB](pid) == 0) -1L else settings.tick
      val observations = i.count[SipPlanSipDueSlotObservedPB](pid)
      val first = succeeded.map(e => e.occurrence.occurrenceId -> "succeeded").toMap
      require(p.currentTick == clock && p.observedCount == observations.toLong && p.startCount == f.occurrences.size.toLong &&
        p.slotDisposition == request.dueSlots.take(observations).map(_ -> "backlog").toMap &&
        p.occurrences == f.occurrences.map(o => o.dueSlot -> o).toMap && p.firstTerminals == first &&
        p.occurrenceProgress == f.occurrences.map(o => o.occurrenceId -> first.getOrElse(o.occurrenceId, "pending")).toMap &&
        p.terminalReceiptBodies == succeeded.map(e => e.receiptId -> e.receiptBody).toMap &&
        p.successTotal == succeeded.size.toLong && p.failureTotal == 0L, "generated progress/first-terminal fold differs from original PB")
      val paid = if (settings.terminalCase || complete) f.occurrences else Vector.empty
      val credits = paid.map(o => TxId(paymentTx(o)) -> o.config.amount).toMap
      s.accounts.foreach { a =>
        val balance = if (a.id == investor) BigDecimal("1000.00") - BigDecimal(100 * paid.size)
          else if (a.id == collection) BigDecimal(100 * paid.size) else BigDecimal("0.00")
        require(config.seeds.exists(_.accountId == a.id) && a.initialized && a.accountBalance == Map("CNY" -> Money(balance, "CNY")) &&
          a.reservedAmount.isEmpty && a.incomingCredits.isEmpty && a.compensatedOutgoing.isEmpty && a.compensatedIncoming.isEmpty &&
          a.committedOutgoing == (if (a.id == investor) credits else Map.empty[TxId, Money]) &&
          a.committedIncoming == (if (a.id == collection) credits else Map.empty[TxId, Money]), "generated accounts do not reconcile with original payments")
      }
      if (paid.nonEmpty) {
        require(s.orders.size == paid.size && s.sagas.size == paid.size, "actual order/coordinator evidence missing")
        paid.foreach { o =>
          val order = s.orders.find(_.id == o.fundOrderId).getOrElse(throw new IllegalStateException("original generated order missing"))
          val t = f.ta.find(_.fundOrderId == o.fundOrderId).get
          require(order.operationId == o.operationId && order.investorAccountId == investor && order.fundCollectionAccountId == collection &&
            order.fundCode == "fund" && order.amount == o.config.amount && order.cashRequestSource.isEmpty && order.cashRequestOriginals.isEmpty &&
            order.selectedPaymentTxId.value == paymentTx(o) && order.cashPaymentFinalResults == Map(TxId(paymentTx(o)) -> "succeeded") &&
            order.taRequestId == t.taRequestId && order.taStatus == (if (settings.terminalCase) "confirmed" else "accepted") &&
            order.refundOperationId.value.isEmpty && order.refundFinalResults.isEmpty, "generated order changed original payment/TA or acquired a refund")
          if (settings.terminalCase) {
            val e = i.events(ids.order(o.fundOrderId)).collect { case raw: FundOrderFundTASharesConfirmedPB => DomainConverters.decodeFundOrderFundTASharesConfirmedPB(raw) }.head
            require(order.taConfirmedShares == e.shares && order.taReference == e.taReference &&
              order.taReceipts.get(e.receiptId).contains(e.receiptBody) && order.taReceiptOutcomes.get(e.receiptId).contains("confirmed"),
              "generated TA success differs from actual confirmed PB")
          } else require(order.taConfirmedShares.shares.value.isEmpty, "accepted-only TA became investment success")
          val saga = s.sagas.find(_._1 == o.occurrenceId).get._2
          val retained = i.events(ids.paymentHost(o.operationId)).collect { case e: PaymentHost.IdentityObserved => e.identity }
          require(retained.size == 1 && saga.identity.contains(retained.head) && saga.identity.exists(_.transactionId == paymentTx(o)) &&
            saga.argsBytes == PaymentDefinition.argsCodec.encode(PaymentHost.invocationArgs(cashInput(payment(o)))) &&
            saga.status == StrictStatus.Succeeded && saga.terminal, "actual Saga did not retain the original successful transaction")
        }
      } else require(s.orders.isEmpty && s.sagas.isEmpty, "no-tick/pre-dispatch state acquired a financial graph")
    }
    private def checkFinal(i: JournalImage, f: Facts, s: ObservedState): Unit = {
      checkSeeds(i); checkKnown(i, f)
      val n = settings.finalOccurrences
      checkPlan(i, f, 1, 2, 1, if (settings.creationCase) 0 else 1, n, n, if (settings.terminalCase) 1 else 0)
      require(f.ta.size == n, "one real TA registration per original payment required")
      f.occurrences.foreach(checkPayment(i, f, _))
      if (n == 0) require(ledger(i).isEmpty && i.streams.map(_._1).toSet ==
        (config.seeds.map(seed => ids.account(seed.accountId)).toSet + ids.plan(f.original.planId)), "no-tick recovery created a financial graph")
      checkState(i, f, s, complete = true)
    }

    private def taJournal(): ObjectNode = {
      val bytes = Files.readAllBytes(settings.root.resolve("ta.jsonl"))
      require(bytes.nonEmpty && bytes.last == '\n'.toByte, "complete real TA JSONL journal required")
      val records = new String(bytes, UTF_8).split("\n").toVector.map(mapper.readTree)
      require(records.zipWithIndex.forall { case (r, index) => r.path("seq").asLong() == index.toLong + 1L }, "TA journal sequence gap")
      obj("byteCount" -> json(bytes.length), "sha256" -> json(sha(bytes)), "recordCount" -> json(records.size),
        "submissionCount" -> json(records.count(_.path("event").path("kind").asText() == "RequestSubmitted")), "records" -> array(records))
    }
    private def checkTa(f: Facts): ObjectNode = {
      val queries = f.occurrences.flatMap { o => f.ta.find(_.fundOrderId == o.fundOrderId).map { t =>
        val response = await(client.query(t.taRequestId.value)); val original = response.path("request")
        require(response.path("requestId").asText() == t.taRequestId.value &&
          response.path("status").asText() == (if (settings.terminalCase) "confirmed" else "accepted") &&
          response.path("businessTick").asLong() == (if (settings.terminalCase) 1L else 0L) &&
          original.path("requestId").asText() == t.taRequestId.value && original.path("orderId").asText() == o.fundOrderId.value &&
          original.path("paymentTxId").asText() == paymentTx(o) && original.path("investorAccountId").asText() == investor.value &&
          original.path("fundCollectionAccountId").asText() == collection.value && original.path("fundCode").asText() == "fund" &&
          original.path("amount").path("minorUnits").asText() == "10000" && original.path("amount").path("currency").asText() == "CNY" &&
          original.path("scenario").asText() == (if (settings.terminalCase) "confirmed" else "accepted"), "real TA original/status/clock mismatch")
        val receipts = response.path("canonicalReceipts").elements().asScala.toVector
        require(receipts.map(_.path("outcome").asText()) == (if (settings.terminalCase) Vector("accepted", "confirmed") else Vector("accepted")),
          "real TA canonical receipt vector mismatch")
        if (settings.terminalCase) {
          val state = await(await(runtime.order(o.fundOrderId)).ref.ask[FundOrderState](FundOrderAggregate.GetState))
          val shares = receipts.last.path("shares")
          require(state.taConfirmedShares.shares.value == shares.path("shares").asText() &&
            state.taConfirmedShares.nav.value == shares.path("nav").asText(), "TA share/NAV exact strings changed in generated state")
        }
        response
      }}
      val durable = taJournal(); val records = durable.path("records").elements().asScala.toVector
      val submissions = records.filter(_.path("event").path("kind").asText() == "RequestSubmitted")
      val advances = records.filter(_.path("event").path("kind").asText() == "ClockAdvanced")
      require(submissions.size == f.ta.size && submissions.map(_.path("event").path("request").path("requestId").asText()).toSet ==
        f.ta.map(_.taRequestId.value).toSet && advances.size == (if (settings.terminalCase && f.ta.nonEmpty) 1 else 0),
        "TA submitted an original twice or clock changed outside the crash input")
      submissions.foreach { row =>
        val stored = row.path("event").path("request")
        require(queries.exists(_.path("request") == stored), "TA durable submitted body differs from real query")
      }
      advances.foreach(row => require(row.path("event").path("fromTick").asLong() == 0L && row.path("event").path("tick").asLong() == 1L,
        "external terminal clock must be exactly the crash's advance1"))
      obj("queries" -> array(queries), "journal" -> durable)
    }
    private def parentCounts(i: JournalImage, pid: String, run: String, occurrence: OccurrenceId): ObjectNode = {
      val starts = i.events(pid).collect { case e: PersistentMonarch.RunStarted => e }
      obj("persistenceId" -> json(pid), "runId" -> json(run), "occurrenceId" -> json(occurrence.value),
        "RunStarted" -> json(starts.size), "StageDone" -> json(i.count[PersistentMonarch.StageDone](pid)),
        "RunFailedEvt" -> json(i.count[PersistentMonarch.RunFailedEvt](pid)),
        "originalInputs" -> array(starts.map(e => obj("runId" -> json(e.runId), "stageCursors" -> json(e.stageCursors),
          "initialSnapshotSha256" -> json(sha(e.initialSnapshot))))))
    }
    private def counts(i: JournalImage, f: Facts, s: ObservedState): ObjectNode = {
      val pid = ids.plan(f.original.planId)
      def total[A: ClassTag]: Int = f.occurrences.map(o => i.count[A](ids.order(o.fundOrderId))).sum
      obj("createIntent" -> json(i.count[SipPlanSipCreateIntentRecordedPB](pid)), "created" -> json(i.count[SipPlanSipPlanCreatedPB](pid)),
        "appended" -> json(i.count[SipPlanSipDueSlotAppendedPB](pid)), "sealed" -> json(i.count[SipPlanSipScheduleSealedPB](pid)),
        "clockAdvanced" -> json(i.count[SipPlanSipClockAdvancedPB](pid)), "observed" -> json(i.count[SipPlanSipDueSlotObservedPB](pid)),
        "occurrences" -> json(i.count[SipPlanSipInstallmentTriggeredPB](pid)), "successTotal" -> json(s.plan.successTotal),
        "failureTotal" -> json(s.plan.failureTotal), "terminalSucceeded" -> json(i.count[SipPlanSipInstallmentSucceededPB](pid)),
        "terminalFailed" -> json(i.count[SipPlanSipInstallmentFailedPB](pid)), "cashSettlements" -> json(total[FundOrderFundPurchaseSettlementRequestedPB]),
        "paymentResults" -> json(total[FundOrderFundCashPaymentSucceededPB]), "taRegistrations" -> json(total[FundOrderFundTASubmissionRegisteredPB]),
        "taConfirmations" -> json(total[FundOrderFundTASharesConfirmedPB]),
        "sipParents" -> array(f.occurrences.filter(o => i.events(ids.sipRun(o.occurrenceId)).nonEmpty).map(o => parentCounts(i, ids.sipRun(o.occurrenceId), o.occurrenceId.value, o.occurrenceId))),
        "paymentParents" -> array(f.occurrences.filter(o => i.events(ids.paymentRun(o.operationId)).nonEmpty).map(o => parentCounts(i, ids.paymentRun(o.operationId), o.operationId.value, o.occurrenceId))),
        "taParents" -> array(f.occurrences.flatMap(o => f.ta.find(_.fundOrderId == o.fundOrderId).map(t =>
          parentCounts(i, ids.taRun(t.taRequestId), t.taRequestId.value, o.occurrenceId)))),
        "payments" -> array(f.occurrences.map(o => obj("occurrenceId" -> json(o.occurrenceId.value), "paymentTxId" -> json(paymentTx(o)),
          "phases" -> obj(Vector("reserve", "recordIncoming", "deduct", "commitIncoming", "release", "cancelIncoming")
            .map(kind => kind -> json(ledger(i).count(e => e.tx == paymentTx(o) && e.kind == kind))): _*)))))
    }
    private def identities(i: JournalImage, f: Facts): ObjectNode = obj("planId" -> json(f.original.planId.value),
      "principalId" -> json(f.original.principalId), "clientRequestId" -> json(f.original.clientRequestId),
      "occurrences" -> array(f.occurrences.map { o =>
        val retained = i.events(ids.paymentHost(o.operationId)).collect { case e: PaymentHost.IdentityObserved => e.identity }
        obj("occurrence" -> json(o), "paymentOriginal" -> json(payment(o)), "paymentTxId" -> json(paymentTx(o)),
          "paymentTransactionIdentity" -> json(retained.headOption), "sipHostOperationId" -> json(SipHost.operationIdentity(dispatchInput(o))),
          "taOriginal" -> json(f.ta.find(_.fundOrderId == o.fundOrderId)))
      }))
    private def statePb(p: GeneratedMessage): ObjectNode = {
      val serialization = SerializationExtension(system.toClassic); val ref = p.asInstanceOf[AnyRef]
      val serializer = serialization.findSerializerFor(ref); val bytes = serialization.serialize(ref).get
      obj("pbSha256" -> json(sha(p.toByteArray)), "pbByteCount" -> json(p.toByteArray.length),
        "pbBase64" -> json(Base64.getEncoder.encodeToString(p.toByteArray)), "serializerId" -> json(serializer.identifier),
        "manifest" -> json(Serializers.manifestFor(serializer, ref)), "serializedSha256" -> json(sha(bytes)),
        "serializedBase64" -> json(Base64.getEncoder.encodeToString(bytes)), "byteCount" -> json(bytes.length))
    }
    private def states(s: ObservedState): ObjectNode = obj("plan" -> json(s.plan), "orders" -> json(s.orders), "accounts" -> json(s.accounts),
      "planStatePbSha256" -> json(sha(DomainConverters.encodeSipPlanStatePB(s.plan).toByteArray)),
      "planPb" -> statePb(DomainConverters.encodeSipPlanStatePB(s.plan)),
      "ordersPb" -> array(s.orders.map(o => obj("fundOrderId" -> json(o.id.value), "statePb" -> statePb(DomainConverters.encodeFundOrderStatePB(o))))),
      "accountsPb" -> array(s.accounts.map(a => obj("accountId" -> json(a.id.value), "statePb" -> statePb(DomainConverters.encodeCreditBalanceStatePB(a))))),
      "paymentSagas" -> array(s.sagas.map { case (id, actual) => obj("occurrenceId" -> json(id.value),
        "status" -> json(actual.status.toString), "terminal" -> json(actual.terminal), "identity" -> json(actual.identity),
        "argsBytesSha256" -> json(sha(actual.argsBytes.toByteArray)),
        "statePbSha256" -> json(sha(StrictSagaProtoConverters.stateToProto(actual).toByteArray)),
        "statePbBase64" -> json(Base64.getEncoder.encodeToString(StrictSagaProtoConverters.stateToProto(actual).toByteArray))) }))
    private def financial(i: JournalImage, f: Facts, s: ObservedState, external: JsonNode): ObjectNode = obj(
      "original" -> json(f.original), "identities" -> identities(i, f), "eventCounts" -> counts(i, f, s),
      "plan" -> json(s.plan), "orders" -> json(s.orders), "accounts" -> json(s.accounts),
      "investor" -> json(s.accounts.find(_.id == investor).get), "collection" -> json(s.accounts.find(_.id == collection).get),
      "durablePbVector" -> i.pbVector, "allPbEventsSha256" -> json(i.pbHash),
      "durableEventBytes" -> array(i.rows.map { r => obj("event" -> r.description,
        "serializedBase64" -> json(Base64.getEncoder.encodeToString(r.bytes)),
        "pbBase64" -> json(r.pb.map(bytes => Base64.getEncoder.encodeToString(bytes)))) }), "ta" -> external)
    private def evidence(i: JournalImage, f: Facts, s: ObservedState, external: JsonNode): ObjectNode = obj(
      "original" -> json(f.original), "identities" -> identities(i, f), "eventCounts" -> counts(i, f, s), "state" -> states(s),
      "journal" -> i.report, "financial" -> financial(i, f, s, external),
      "processes" -> obj("javaPid" -> json(javaPid), "nodePid" -> json(nodePid), "nodePidSource" -> json("worker.jsonl:worker-started")),
      "fault" -> obj("enabled" -> json(settings.crashing), "forwardBlocked" -> json(blocked.isCompleted),
        "withheldAcks" -> json(withheldAcks.get()), "nonemptyWithheldAcks" -> json(nonemptyAcks.get()),
        "forwardedTerminalCommands" -> json(forwardedTerminals.get()), "command" -> json(Option(heldCommand.get())),
        "withheldAcceptedEvents" -> json(withheldEvents.get()), "blockedDispatchOriginal" -> json(Option(blockedDispatch.get()))),
      "storage" -> obj("provider" -> json("local"), "journal" -> json("akka.persistence.journal.leveldb"), "native" -> json(false),
        "fsync" -> json(true), "snapshotStore" -> json("akka.persistence.snapshot-store.local")))

    private def preservedPrefix(before: JsonNode, after: JournalImage): Vector[Recorded] = {
      val prior = before.path("streams").elements().asScala.toVector
      require(prior.nonEmpty, "empty original-evidence prefix refused")
      val additions = Vector.newBuilder[Recorded]
      prior.foreach { stream =>
        val pid = stream.path("persistenceId").asText(); val old = stream.path("events").elements().asScala.toVector
        val now = after.streams.find(_._1 == pid).map(_._2).getOrElse(Vector.empty)
        require(old.nonEmpty && now.size >= old.size && now.take(old.size).map(_.description) == old, "serialized/PB original prefix changed: " + pid)
        additions ++= now.drop(old.size)
      }
      val priorPids = prior.map(_.path("persistenceId").asText()).toSet
      additions ++= after.streams.filterNot(s => priorPids(s._1)).flatMap(_._2)
      additions.result()
    }
    private def priorReport(name: String, schema: String, mode: String): (Path, JsonNode) = {
      val files = Files.walk(settings.root.resolve("runs"))
      val found = try files.iterator().asScala.filter(p => Files.isRegularFile(p) && p.getFileName.toString == name).map { p =>
        noSymlinks(p); p -> mapper.readTree(Files.readAllBytes(p))
      }.filter { case (_, report) => report.path("schemaVersion").asText() == schema && report.path("mode").asText() == mode &&
        report.path("caseName").asText() == settings.caseName && report.path("namespace").asText() == settings.namespace
      }.toVector finally files.close()
      require(found.size == 1, "exactly one original " + mode + " report required")
      found.head
    }
    private def recoveredReport(): JsonNode = {
      val (file, report) = priorReport("result.json", "bank-crash-result/v1", "recover")
      require(report.path("passed").isBoolean && report.path("passed").asBoolean(), "successful recover report required")
      val closed = file.getParent.resolve("closed.json"); noSymlinks(closed)
      require(Files.isRegularFile(closed), "verify requires recover's normal cleanup receipt")
      val receipt = mapper.readTree(Files.readAllBytes(closed))
      require(receipt.path("schemaVersion").asText() == "bank-crash-closed/v1" && receipt.path("mode").asText() == "recover" &&
        receipt.path("pid").asLong() == report.path("pid").asLong() && receipt.path("namespace").asText() == settings.namespace &&
        receipt.path("caseName").asText() == settings.caseName && receipt.path("workerWaited").asBoolean() &&
        receipt.path("actorSystemTerminated").asBoolean(), "recover cleanup identity/lifecycle mismatch")
      report
    }

    def run(): ObjectNode = {
      initializeJournal()
      val initial = image() // No bank actor, recovery behavior, worker, or application has been installed yet.
      val previous = if (settings.mode == "verify") Some(recoveredReport()) else None
      if (settings.crashing) {
        require(initial.rows.isEmpty && initial.streams.isEmpty, "crash requires a truly empty local journal")
        sourceOriginal = admission.sip(alice, request) match {
          case Right(original) => original
          case Left(_) => throw new IllegalStateException("trusted customer SIP admission refused")
        }
      } else {
        val retained = facts(initial) // Business authority comes ONLY from the real original journal.
        sourceOriginal = retained.original
        if (settings.mode == "recover") {
          checkPrefix(initial, retained)
          val barrier = priorReport("barrier.json", "bank-crash-barrier/v1", "crash")._2.path("evidence")
          require(barrier.path("barrierCondition").asText() == settings.caseName && barrier.path("loopStarted").isBoolean &&
            !barrier.path("loopStarted").asBoolean() && barrier.path("fault").path("enabled").asBoolean() &&
            barrier.path("fault").path("forwardBlocked").asBoolean() && barrier.path("original") == json(retained.original) &&
            barrier.path("journal") == initial.report && barrier.path("financial").path("ta").path("journal") == taJournal(),
            "bank/TA source bytes differ from exact selected crash barrier")
          if (settings.caseName == "sip-terminal-ack-lost") require(barrier.path("fault").path("withheldAcks").asInt() > 0 &&
            barrier.path("fault").path("nonemptyWithheldAcks").asInt() > 0, "ACK-loss barrier lacks actual durable Accepted")
        } else {
          require(initial.report == previous.get.path("evidence").path("journal") &&
            json(retained.original) == previous.get.path("evidence").path("original") &&
            taJournal() == previous.get.path("evidence").path("financial").path("ta").path("journal"),
            "verify's full original bank/TA journal bytes differ from recover")
          checkSeeds(initial); checkKnown(initial, retained)
          checkPlan(initial, retained, 1, 2, 1, if (settings.creationCase) 0 else 1,
            settings.finalOccurrences, settings.finalOccurrences, if (settings.terminalCase) 1 else 0)
          retained.occurrences.foreach(checkPayment(initial, retained, _))
        }
        retained.occurrences.foreach(o => rememberIdentity(o, initial.events(ids.paymentHost(o.operationId))))
      }
      initializeWorker(); initializeRuntime()
      if (settings.crashing) crash()
      else {
        // No customer create, clock tick, cash resubmit, manual ensure*, or manual
        // reconcile here. Runtime graphs below are installed only by the real loop
        // and TA journal discovery/callback, from their retained original PB facts.
        await(loop.start())
        publish(settings, "ready.json", header("bank-crash-ready/v1", settings))
        eventually("journal-only automatic SIP recovery and exact original parent checkpoints") {
          val current = image(); val f = facts(current); checkFinal(current, f, observed(current, f))
        }
        closeDrivers()
        val current = image(); val currentFacts = facts(current); val state = observed(current, currentFacts)
        // TA queries must happen before closing the actor directory; they are read-only.
        val external = checkTa(currentFacts)
        closeRuntime()
        val finalImage = image(); val finalFacts = facts(finalImage)
        require(finalFacts.original == sourceOriginal, "recovery changed the original admitted SIP request")
        checkFinal(finalImage, finalFacts, state)
        val additions = preservedPrefix(initial.report, finalImage)
        val proof = evidence(finalImage, finalFacts, state, external)
        proof.set[JsonNode]("initialJournal", initial.report)
        proof.set[JsonNode]("recovery", obj("driver" -> json("BankRecoveryLoop"), "customerResubmissions" -> json(0),
          "pendingPersistenceIds" -> json(loop.pendingPersistenceIds), "preservedOriginalSerializedPrefix" -> json(true)))
        val comparison = obj("financialPolicy" -> json("exact complete original, plan/orders/accounts, PB vector and TA JSONL/query"),
          "technicalPolicy" -> json("exact complete serialized journal; no ignored runtime appends or duplicated checkpoints"),
          "appendedSinceInvocationStart" -> array(additions.map(_.description)))
        previous.foreach { prior =>
          require(proof.path("financial") == prior.path("evidence").path("financial"), "third JVM complete financial evidence differs from recover")
          require(finalImage.report == prior.path("evidence").path("journal") && additions.isEmpty,
            "third JVM appended/changed durable runtime or business bytes")
          require(proof.path("state") == prior.path("evidence").path("state"), "third JVM generated state/PB/serializer evidence differs from recover")
          comparison.put("financialEqualsRecover", true)
          comparison.put("allDurableSerializedEventsEqualRecover", true)
          comparison.set[JsonNode]("allowedTechnicalAppendsSinceRecover", array(Vector.empty))
        }
        proof.set[JsonNode]("comparison", comparison)
        val result = header("bank-crash-result/v1", settings); result.set[JsonNode]("evidence", proof); result
      }
    }
    private def crash(): Nothing = {
      val seeds = new BankSeedAuthority(raw)
      config.seeds.foreach(seed => await(seeds.ensure(seed, await(directory.account(seed.accountId)))))
      checkSeeds(image())
      publish(settings, "ready.json", header("bank-crash-ready/v1", settings))
      val creation = sip.create(alice, request) // Always the real customer DTO/application.
      if (!settings.creationCase) {
        require(await(creation).isRight, "real SIP create failed before selected tick barrier")
        val ticking = sip.tick(operator, BankTick(settings.tick)) // Distinct configured operator; no customer role substitution.
        if (settings.terminalCase) {
          require(await(ticking).isRight, "real operator tick10 failed")
          eventually("one actual accepted TA submission before external advance1") {
            val i = image(); val f = facts(i)
            require(f.occurrences.size == 1 && f.ta.size == 1, "original due10/TA registration missing")
            val o = await(await(runtime.order(f.occurrences.head.fundOrderId)).ref.ask[FundOrderState](FundOrderAggregate.GetState))
            require(o.taStatus == "accepted" && taJournal().path("submissionCount").asInt() == 1, "actual accepted TA receipt missing")
            val response = await(client.query(f.ta.head.taRequestId.value))
            require(response.path("status").asText() == "accepted" && response.path("businessTick").asLong() == 0L,
              "confirmed scenario must really be accepted at external tick0")
          }
          require(await(client.advance(1L)).path("businessTick").asLong() == 1L, "real external advance1 required")
        }
        // Catchup and pre-dispatch ticks are intentionally held by the selected fault.
      }
      await(blocked.future)
      eventually("exact durable SIP crash barrier") {
        val i = image(); val f = facts(i); val s = observed(i, f)
        checkPrefix(i, f); checkState(i, f, s, complete = false)
        require(blocked.isCompleted && faultFailure.get() == null, "actual command/dispatch forward not blocked")
        if (settings.caseName == "sip-terminal-ack-lost") require(withheldAcks.get() > 0 && nonemptyAcks.get() == 1 &&
          forwardedTerminals.get() > 0, "ACK loss must observe one nonempty actual durable Accepted")
      }
      closeDrivers() // Stop polling/callback admission; keep real durable actors/store alive for the parent's kill.
      val frozen = image(); val f = facts(frozen); val state = observed(frozen, f)
      checkPrefix(frozen, f); checkState(frozen, f, state, complete = false)
      val external = checkTa(f)
      val proof = evidence(frozen, f, state, external)
      proof.set[JsonNode]("barrierCondition", json(settings.caseName)); proof.set[JsonNode]("loopStarted", json(false))
      val barrier = header("bank-crash-barrier/v1", settings); barrier.set[JsonNode]("evidence", proof)
      publish(settings, "barrier.json", barrier)
      while (workDeadline.hasTimeLeft()) Thread.sleep(workDeadline.timeLeft.toMillis.min(250L).max(1L))
      throw new TimeoutException("SIP crash barrier published but parent did not terminate this JVM")
    }
    private def workerLog(): Vector[JsonNode] = Files.readAllLines(settings.invocation.resolve("worker.jsonl"), UTF_8).asScala.toVector.map(mapper.readTree)
    def workerClosed(): Unit = {
      val exits = workerLog().filter(_.path("kind").asText() == "worker-exited")
      require(exits.size == 1 && exits.head.path("pid").asLong() == nodePid && exits.head.path("waited").asBoolean() &&
        exits.head.path("exitCode").asInt(-1) == 0, "normal worker cleanup must record original PID, wait and zero exit")
    }
    private def closeDrivers(): Unit = if (!driversClosed) {
      driversClosed = true
      cleanup(Vector(() => if (loop != null) loop.close(), () => if (ta != null) ta.close(), () => if (sip != null) sip.close()))
    }
    private def closeProxies(): Unit = {
      val refs = synchronized { if (proxiesClosed) Vector.empty else { proxiesClosed = true; proxies.toVector.reverse } }
      if (refs.nonEmpty) Await.result(Future.sequence(refs.map(ref => akka.pattern.gracefulStop(ref.toClassic, 10.seconds, akka.actor.PoisonPill))), 15.seconds)
    }
    private def closeRuntime(): Unit = if (!runtimeClosed && runtime != null) {
      runtimeClosed = true; cleanup(Vector(() => runtime.close(), () => closeProxies()))
    }
    def close(): Unit = cleanup(Vector(() => closeDrivers(), () => closeRuntime(), () => closeProxies(),
      () => if (raw != null) raw.close(), () => if (client != null) client.close()))
  }

  private def cleanup(actions: Vector[() => Unit]): Unit = {
    var failure: Throwable = null
    actions.foreach { action => try action() catch { case error: Throwable =>
      if (failure == null) failure = error else failure.addSuppressed(error)
    }}
    if (failure != null) throw failure
  }
  def main(args: Array[String]): Unit = {
    val started = System.nanoTime()
    val guard = Executors.newSingleThreadScheduledExecutor(new ThreadFactory {
      def newThread(r: Runnable): Thread = { val t = new Thread(r, "bank-p31-sip-deadline"); t.setDaemon(true); t }
    })
    guard.schedule(new Runnable { def run(): Unit = {
      System.err.println("BankSipCrashRecoveryMain exceeded its 110-second total deadline"); System.exit(124)
    } }, 110L, TimeUnit.SECONDS)
    var settings: Settings = null; var system: ActorSystem[Nothing] = null; var harness: Harness = null
    var result: ObjectNode = null; var failure: Throwable = null
    def attempt(body: => Unit): Unit = try body catch { case error: Throwable =>
      if (failure == null) failure = error else failure.addSuppressed(error)
    }
    try {
      settings = parse(args)
      val remaining = (if (settings.crashing) 65.seconds else 60.seconds) - (System.nanoTime() - started).nanos
      require(remaining > Duration.Zero, "initialization exhausted the work deadline")
      val workDeadline = remaining.fromNow
      system = ActorSystem[Nothing](Behaviors.empty[Nothing], "bank-p31-sip-" + settings.namespace, storageConfiguration(settings))
      harness = new Harness(settings, workDeadline)(system); result = harness.run()
    } catch { case error: Throwable => failure = error }
    finally {
      attempt { if (harness != null) harness.close() }
      attempt { if (system != null) { system.terminate(); Await.result(system.whenTerminated, 15.seconds) } }
    }
    if (failure == null) attempt {
      require(result != null && settings.mode != "crash", "only recovered/verified invocations may complete normally")
      harness.workerClosed()
      val closed = header("bank-crash-closed/v1", settings)
      closed.put("nodePid", harness.nodePid); closed.put("workerWaited", true); closed.put("actorSystemTerminated", true)
      publish(settings, "closed.json", closed)
      result.put("passed", true); publish(settings, "result.json", result)
    }
    guard.shutdownNow()
    if (failure != null) { failure.printStackTrace(System.err); System.exit(1) }
  }
}
