package example.bankwealth.service

import akka.NotUsed
import akka.actor.typed.{ActorSystem, ActorRef, Behavior}
import akka.actor.typed.scaladsl.{Behaviors, AskPattern}
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.persistence.query.PersistenceQuery
import akka.persistence.query.journal.leveldb.scaladsl.LeveldbReadJournal
import akka.serialization.{SerializationExtension, Serializers}
import akka.stream.{Materializer, SystemMaterializer}
import akka.stream.scaladsl.{Sink, Source}
import akka.util.Timeout
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.{ArrayNode, ObjectNode}
import com.typesafe.config.{Config, ConfigFactory, ConfigParseOptions}
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash,
  bank_independent_refund_v1Execution => Refund, bank_ta_submission_v1Execution => Ta,
  bank_payment_hostHost => PaymentHost, bank_refund_hostHost => RefundHost,
  bank_payment_hostDefinition => PaymentDefinition, bank_refund_hostDefinition => RefundDefinition,
  bank_ta_effectEffectHost => TaHost}
import example.bankwealth.bindings.{BankTaEffectBindings, BankPaymentBindings, BankRefundBindings, MockTAClient}
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
import net.imadz.monarch.persistence.{PersistentMonarch, RunObserver}
import scalapb.GeneratedMessage

import java.io.{ByteArrayOutputStream, DataOutputStream}
import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path, Paths, StandardCopyOption, StandardOpenOption}
import java.security.MessageDigest
import java.util.concurrent.{ConcurrentHashMap, ConcurrentLinkedQueue, Executors, ThreadFactory, TimeUnit, TimeoutException}
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}
import scala.collection.mutable
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.reflect.ClassTag
import scala.util.control.NonFatal

/** P31's process boundary, not another implementation of the bank or its engines.
  *
  * CLI (exactly seven arguments):
  *   crash|recover|verify caseName ownedCaseRoot namespace node worker invocationDir
  *
  * ownedCaseRoot/journal, snapshots and ta.jsonl survive all three JVMs; each invocation
  * has fresh worker.jsonl/worker.stderr.log and exclusive, atomically published reports.
  * The parent kills ONLY this JVM after barrier.json, waits for it and observes the
  * worker PID from worker-started. The checked v1-service-mock-ta-worker.mjs handles
  * stdin EOF with `finally { lines.close(); close(); }`, including TA journal unlock.
  * Do not replace it with a worker that requires a Java shutdown hook to exit.
  *
  * No ActorTestKit, UnitConfigurationCheck, Play bootstrap, application/service.conf,
  * database, HTTP listener, client resubmission during recovery, or engine modification.
  * The service package is intentional: the generated Principal constructor is
  * private[service], and this standalone root supplies the trusted synthetic principal.
  */
object BankCrashRecoveryMain {
  val supportedCases: Vector[String] = Vector(
    "request-before-start", "refund-before-assembly", "refund-prepare",
    "refund-collection-commit", "refund-investor-commit", "payment-prepare",
    "payment-investor-commit", "payment-collection-commit",
    "ta-register-before-assembly", "ta-intent-before-submit", "ta-submitted-before-bank-accept",
    "ta-accepted-before-effect-reply", "ta-confirmed-before-ingest", "ta-rejected-after-ingest-before-ack",
    "payment-succeeded-before-delivery-ack", "refund-succeeded-before-delivery-ack")

  private val mapper = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
  private val reportNames = Vector("ready.json", "barrier.json", "result.json", "closed.json")
  private val javaPid = ProcessHandle.current().pid()
  private val machineToken = "bank-p31-owned-machine-recovery-v1"

  private final case class Settings(mode: String, caseName: String, root: Path, namespace: String,
      node: Path, worker: Path, invocation: Path) {
    def refundCase: Boolean = caseName.startsWith("refund-") || caseName == "ta-rejected-after-ingest-before-ack"
    // Receipt hiding is ONLY the original six money-phase cases, not TA or delivery loss.
    def phaseCase: Boolean = Set("refund-prepare", "refund-collection-commit", "refund-investor-commit",
      "payment-prepare", "payment-investor-commit", "payment-collection-commit")(caseName)
    def taCase: Boolean = caseName.startsWith("ta-")
    def deliveryAckCase: Boolean = caseName.endsWith("-before-delivery-ack")
    def newCase: Boolean = taCase || deliveryAckCase
    def confirmedCase: Boolean = caseName == "ta-confirmed-before-ingest"
    def scenario: String = if (refundCase) "rejected" else if (confirmedCase) "confirmed" else "accepted"
    def terminalTaStatus: String = scenario
    def phase: String = caseName.stripPrefix(if (refundCase) "refund-" else "payment-")
    def crashing: Boolean = mode == "crash"
  }

  private def path(text: String, directory: Boolean): Path = {
    val p = Paths.get(text)
    require(p.isAbsolute && p.normalize() == p, "explicit absolute normalized path required")
    noSymlinks(p)
    if (directory) require(Files.isDirectory(p), "explicit existing directory required")
    p
  }
  private def noSymlinks(p: Path): Unit = {
    var at = p
    while (at != null) {
      require(!Files.isSymbolicLink(at), "symlink in owned/configured path refused")
      at = at.getParent
    }
  }
  private def parse(args: Array[String]): Settings = {
    require(args.length == 7, "exactly seven arguments required: mode caseName ownedCaseRoot namespace node worker invocationDir")
    require(Set("crash", "recover", "verify")(args(0)), "mode must be crash, recover or verify")
    require(supportedCases.contains(args(1)), "unsupported crash case")
    val root = path(args(2), directory = true)
    val invocation = path(args(6), directory = true)
    val runs = root.resolve("runs")
    require(Files.isDirectory(runs) && invocation != runs && invocation.startsWith(runs),
      "invocation directory must already exist strictly beneath ownedCaseRoot/runs")
    val settings = Settings(args(0), args(1), root, args(3), path(args(4), directory = false),
      path(args(5), directory = false), invocation)
    new BankPersistenceIds(settings.namespace)
    MockTAClient.Configuration(settings.node, settings.worker, settings.root)
    (reportNames ++ Vector("worker.jsonl", "worker.stderr.log", ".bank-crash-main.claim")).foreach { name =>
      require(!Files.exists(invocation.resolve(name)), "fresh exclusive invocation files required")
    }
    // An invocation is leased, not reused. This also excludes competing publishers of
    // this main's reports; no report is moved with REPLACE_EXISTING.
    Files.createFile(invocation.resolve(".bank-crash-main.claim"))
    Vector("journal", "snapshots").foreach { name =>
      val store = root.resolve(name)
      noSymlinks(store)
      if (settings.crashing) {
        if (Files.exists(store)) {
          require(Files.isDirectory(store), "owned storage directory required")
          val entries = Files.list(store)
          try require(!entries.findAny().isPresent, "crash requires fresh case storage") finally entries.close()
        } else Files.createDirectory(store)
      } else require(Files.isDirectory(store), "recovery requires the existing case storage")
    }
    val ta = root.resolve("ta.jsonl")
    noSymlinks(ta)
    if (settings.crashing) require(!Files.exists(ta), "crash requires a new TA journal")
    else require(Files.isRegularFile(ta), "recovery requires the original TA journal")
    settings
  }

  private def storageConfiguration(s: Settings): Config = {
    // Deliberately do NOT use ConfigFactory.load(): -Dconfig.resource=service-unit.conf
    // and production application.conf must not choose this JVM's persistence backend.
    val serializers = ConfigFactory.parseResources("serialization.conf",
      ConfigParseOptions.defaults().setAllowMissing(false))
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
      !config.getBoolean("akka.persistence.journal.leveldb.native") &&
      config.getBoolean("akka.persistence.journal.leveldb.fsync"), "exclusive local durable configuration required")
    config
  }

  private def quote(s: String): String = mapper.writeValueAsString(s)
  private def sha(bytes: Array[Byte]): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).iterator.map(b => f"${b & 0xff}%02x").mkString
  private def obj(fields: (String, JsonNode)*): ObjectNode = {
    val o = mapper.createObjectNode()
    fields.foreach { case (key, value) => o.set[JsonNode](key, value) }
    o
  }
  private def array(values: Iterable[JsonNode]): ArrayNode = {
    val a = mapper.createArrayNode()
    values.foreach(v => a.add(v))
    a
  }
  /** Canonical observation of real domain values. Maps/sets are sorted, exact TA
    * strings remain strings, and no deployment configuration or token is passed here.
    */
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
  private def header(schema: String, s: Settings): ObjectNode = obj(
    "schemaVersion" -> json(schema), "mode" -> json(s.mode), "caseName" -> json(s.caseName),
    "pid" -> json(javaPid), "namespace" -> json(s.namespace))
  private def publish(s: Settings, name: String, report: JsonNode): Unit = {
    val target = s.invocation.resolve(name)
    val temporary = s.invocation.resolve("." + name + "." + javaPid + ".tmp")
    require(!Files.exists(target), "report overwrite refused")
    val channel = FileChannel.open(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
    try {
      val bytes = java.nio.ByteBuffer.wrap((mapper.writeValueAsString(report) + "\n").getBytes(UTF_8))
      while (bytes.hasRemaining) channel.write(bytes)
      channel.force(true)
    } finally channel.close()
    require(!Files.exists(target), "report overwrite refused")
    // Failure to support atomic publication is a failure, not a partial ready/barrier.
    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE)
  }

  private final case class Facts(original: BankCashOriginal, refund: Option[BankRefundOriginal],
      ta: Option[BankTaEffectRequest]) {
    def payment: BankPaymentOriginal = original.payment
    def paymentTx: String = PaymentHost.operationIdentity(cashInput(payment))
    def refundTx: Option[String] = refund.map(r => RefundHost.operationIdentity(refundInput(r)))
  }
  private def cashInput(p: BankPaymentOriginal): Cash.State = Cash.State(Cash.Inputs(
    p.operationId, p.operationId, p.investorAccountId, p.fundOrderId, p.fundCollectionAccountId, p.amount, p.fundCode))
  private def refundInput(r: BankRefundOriginal): Refund.State = Refund.State(Refund.Inputs(
    r.fundOrderId, r.paymentTxId, r.investorAccountId, r.fundCollectionAccountId, r.amount, r.refundOperationId))

  private def eventIdentity(event: Any): JsonNode = event match {
    case e: PaymentHost.Associated => obj("operation" -> json(e.operation),
      "original" -> json(PaymentHost.originalInput(Cash.codec.decode(e.original.toByteArray))), "argsSha256" -> json(sha(e.args.toByteArray)))
    case e: RefundHost.Associated => obj("operation" -> json(e.operation),
      "original" -> json(RefundHost.originalInput(Refund.codec.decode(e.original.toByteArray))), "argsSha256" -> json(sha(e.args.toByteArray)))
    case e: PaymentHost.IdentityObserved => json(e.identity)
    case e: RefundHost.IdentityObserved => json(e.identity)
    case e: PaymentHost.ResultIntent => obj("kind" -> json(e.kind))
    case e: RefundHost.ResultIntent => obj("kind" -> json(e.kind))
    case e: PaymentHost.DeliveryAcknowledged => obj("kind" -> json(e.kind))
    case e: RefundHost.DeliveryAcknowledged => obj("kind" -> json(e.kind))
    case e: TaHost.Intent => obj("operation" -> json(e.operation),
      "request" -> json(TaHost.request(Ta.codec.decode(e.original.toByteArray))), "originalSha256" -> json(sha(e.original.toByteArray)))
    case e: TaHost.ObservationStored => if (e.value.isEmpty) json(null) else
      json(DomainConverters.decodeBankTaEffectObservationPB(BankTaEffectObservationPB.parseFrom(e.value.toByteArray)))
    case e: PersistentMonarch.RunStarted => obj("runId" -> json(e.runId),
      "stageCursors" -> json(e.stageCursors), "initialSnapshotSha256" -> json(sha(e.initialSnapshot)))
    case e: PersistentMonarch.StageDone => obj("cursor" -> json(e.cursor), "timestamp" -> json(e.timestamp),
      "metadata" -> json(e.metadata), "snapshotSha256" -> json(sha(e.snapshot)))
    case e: PersistentMonarch.RunFailedEvt => obj("cursor" -> json(e.cursor), "reason" -> json(e.reason))
    case e: StrictEvent.Started => obj("transaction" -> json(e.identity), "argsSha256" -> json(sha(e.argsBytes.toByteArray)),
      "participants" -> json(e.participants))
    case e: StrictEvent.IntentPersisted => json(e.intent)
    case e: StrictEvent.EvidenceRecorded => obj("ordinal" -> json(e.ordinal), "operation" -> json(e.evidence.identity),
      "evidenceType" -> json(e.evidence.getClass.getName), "receiptSha256" -> json(e.evidence match {
        case Evidence.Confirmed(_, bytes) => Some(sha(bytes.toByteArray))
        case _ => None
      }))
    case _ => json(null) // actual event type, PID, sequence and full serializer bytes remain in every row
  }
  private final case class Recorded(row: BankJournalEnvelope, serializerId: Int, manifest: String,
      bytes: Array[Byte], pb: Option[Array[Byte]]) {
    def description: ObjectNode = obj("persistenceId" -> json(row.persistenceId),
      "sequenceNr" -> json(row.sequenceNr), "eventType" -> json(row.event.getClass.getName),
      "eventIdentity" -> eventIdentity(row.event),
      "serializerId" -> json(serializerId), "manifest" -> json(manifest), "byteCount" -> json(bytes.length),
      "serializedSha256" -> json(sha(bytes)), "pbSha256" -> json(pb.map(sha)))
  }
  private def vectorHash(rows: Vector[Recorded], pbOnly: Boolean): String = {
    val buffer = new ByteArrayOutputStream()
    val out = new DataOutputStream(buffer)
    def framed(bytes: Array[Byte]): Unit = { out.writeInt(bytes.length); out.write(bytes) }
    rows.filter(r => !pbOnly || r.pb.nonEmpty).foreach { r =>
      framed(r.row.persistenceId.getBytes(UTF_8)); out.writeLong(r.row.sequenceNr)
      out.writeInt(r.serializerId); framed(r.manifest.getBytes(UTF_8))
      framed(if (pbOnly) r.pb.get else r.bytes)
    }
    out.flush()
    sha(buffer.toByteArray)
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
        "serializedSha256" -> json(vectorHash(events, pbOnly = false)),
        "pbSha256" -> json(vectorHash(events, pbOnly = true)), "events" -> array(events.map(_.description))) }))
  }
  private final case class LedgerFact(kind: String, tx: String, resource: AccountId, amount: Money, pid: String)
  private def ledgerFact(pid: String, event: Any): Option[LedgerFact] = event match {
    case p: CreditBalanceReserveFundsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceReserveFundsConfirmedPB(p)
      Some(LedgerFact("reserve", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceRecordIncomingCreditsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceRecordIncomingCreditsConfirmedPB(p)
      Some(LedgerFact("recordIncoming", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceDeductFundsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(p)
      Some(LedgerFact("deduct", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceCommitIncomingCreditsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(p)
      Some(LedgerFact("commitIncoming", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceReleaseReservedFundsConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceReleaseReservedFundsConfirmedPB(p)
      Some(LedgerFact("release", e.txid.value, e.resource, e.amount, pid))
    case p: CreditBalanceCancelIncomingCreditConfirmedPB =>
      val e = DomainConverters.decodeCreditBalanceCancelIncomingCreditConfirmedPB(p)
      Some(LedgerFact("cancelIncoming", e.txid.value, e.resource, e.amount, pid))
    case _ => None
  }

  private final case class ObservedState(order: FundOrderState, investor: CreditBalanceState,
      collection: CreditBalanceState, payment: Option[StrictState], refund: Option[StrictState]) {
    def report: ObjectNode = obj("order" -> json(order), "investor" -> json(investor), "collection" -> json(collection),
      "paymentSaga" -> saga(payment), "refundSaga" -> saga(refund),
      "orderStatePbSha256" -> json(sha(DomainConverters.encodeFundOrderStatePB(order).toByteArray)),
      "investorStatePbSha256" -> json(sha(DomainConverters.encodeCreditBalanceStatePB(investor).toByteArray)),
      "collectionStatePbSha256" -> json(sha(DomainConverters.encodeCreditBalanceStatePB(collection).toByteArray)))
  }
  private def saga(s: Option[StrictState]): JsonNode = s.map { value => obj(
    "status" -> json(value.status.toString), "terminal" -> json(value.terminal),
    "identity" -> json(value.identity), "argsBytesSha256" -> json(sha(value.argsBytes.toByteArray)))
  }.getOrElse(json(null))

  private final class Harness(val settings: Settings, val workDeadline: Deadline)(implicit val system: ActorSystem[Nothing]) {
    implicit private val ec: ExecutionContext = system.executionContext
    implicit private val materializer: Materializer = SystemMaterializer(system).materializer
    implicit private val timeout: Timeout = Timeout(3.seconds)
    val ids = new BankPersistenceIds(settings.namespace)
    val investor = AccountId("investor")
    val collection = AccountId("collection")
    private val request = BankCashSubmit("crash-request", "fund", MoneyWire("10000", "CNY"))
    private val config = BankDemoConfiguration("bank-crash-authority-v1", "http://127.0.0.1:18081", Vector(
      BankDemoPrincipal("alice", investor, Set("customer"), "crash-synthetic-token", "crash-synthetic-csrf")),
      Vector(BankFund("fund", collection)), Vector(
        BankSeed(investor, "CNY", Money(BigDecimal("1000.00"), "CNY")),
        BankSeed(collection, "CNY", Money(BigDecimal("0.00"), "CNY"))))
    private val admission = new BankTrustedAdmission(config)
    private val transactions = ConcurrentHashMap.newKeySet[String]()
    private val cashGraph = new AtomicReference[Option[BankCashRuntime]](None)
    private val refundGraph = new AtomicReference[Option[BankRefundRuntime]](None)
    private val orderCalls = new AtomicInteger(0)
    private val requestBlocked = Promise[Unit]()
    private val stoppedOrderForward = Promise[BankActorHandle[FundOrderAggregate.Request]]()
    private val refundBlocked = Promise[BankRefundOriginal]()
    private val stoppedRefundForward = Promise[BankRefundRuntime]()
    private val hiddenReads = new AtomicInteger(0)
    private val blockedSends = new AtomicInteger(0)
    private val withheldAcks = new AtomicInteger(0)
    private val swallowedReplies = new ConcurrentLinkedQueue[JsonNode]()
    private val taRequest = new AtomicReference[Option[BankTaEffectRequest]](None)
    private val taAssemblyBlocked = Promise[BankTaRuntime]()
    private val taExecuteBlocked = Promise[BankTaEffectObservation]()
    private val taQueryBlocked = Promise[Option[BankTaEffectObservation]]()
    private val completedTaExecute = new AtomicReference[Option[BankTaEffectObservation]](None)
    // Only the crash delivery-ACK cases own these generated graphs. BankRuntime still
    // owns their real accounts/order; it must NEVER ensure the same cash/refund graph.
    private val crashCashRuns = mutable.Map.empty[OperationId, Future[BankCashRuntime]]
    private val crashRefundRuns = mutable.Map.empty[OperationId, Future[BankRefundRuntime]]
    private val extraActors = mutable.ArrayBuffer.empty[ActorRef[_]]
    private val extraPersistenceIds = mutable.Set.empty[String]
    private val orderProxies = mutable.Map.empty[ActorRef[FundOrderAggregate.Request], ActorRef[FundOrderAggregate.Request]]
    private val originalOrderRef = new AtomicReference[Option[ActorRef[FundOrderAggregate.Request]]](None)
    private var sourceOriginal: BankCashOriginal = null
    private var readQuery: LeveldbReadJournal = null
    private var raw: BankPersistenceJournal = null
    private var client: MockTAClient = null
    private var runtime: BankRuntime = null
    private var directory: BankRuntimeDirectory = null
    private var journal: BankJournal = null
    private var cash: BankCashRequests = null
    private var ta: BankTaRefundApplication = null
    private var sip: BankSipApplication = null
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
      var last: Throwable = null
      var done = false
      while (!done && workDeadline.hasTimeLeft()) {
        try { body; done = true } catch { case NonFatal(error) => last = error }
        if (!done) Thread.sleep(100L)
      }
      if (!done) throw new IllegalStateException("deadline waiting for " + label, last)
    }
    private def initializeJournal(): Unit = {
      // This dependency is optional in Akka. Fail before any bank submission if the
      // parent's frozen classpath lacks the Java LevelDB implementation.
      Class.forName("org.iq80.leveldb.impl.Iq80DBFactory")
      readQuery = PersistenceQuery(system.toClassic).readJournalFor[LeveldbReadJournal](LeveldbReadJournal.Identifier)
      raw = new BankPersistenceJournal(ids.namespace, readQuery, () => readQuery.currentPersistenceIds())
      journal = new BankJournal {
        val namespace: String = ids.namespace
        def persistenceIds(): Source[String, NotUsed] = raw.persistenceIds()
        def events(pid: String, after: Long): Source[BankJournalEnvelope, NotUsed] = raw.events(pid, after)
        def currentEvents(pid: String, after: Long): Future[Vector[BankJournalEnvelope]] = raw.currentEvents(pid, after).map { rows =>
          // Match BOTH the exact original graph tx and its debit/credit PID. In
          // particular a refund fault can never intercept the earlier payment.
          val tx = if (settings.refundCase) refundGraph.get().map(_.transactionId) else cashGraph.get().map(_.transactionId)
          val debit = if (settings.refundCase) collection else investor
          val credit = if (settings.refundCase) investor else collection
          val fault = settings.crashing && settings.phaseCase && tx.exists { transaction => rows.exists { row =>
            ledgerFact(pid, row.event).exists { fact =>
              fact.tx == transaction && fact.amount == Money(BigDecimal("100.00"), "CNY") &&
                (settings.phase match {
                  case "prepare" => fact.kind == "reserve" && fact.resource == debit && pid == ids.account(debit)
                  case "collection-commit" if settings.refundCase => fact.kind == "deduct" && fact.resource == debit && pid == ids.account(debit)
                  case "investor-commit" if !settings.refundCase => fact.kind == "deduct" && fact.resource == debit && pid == ids.account(debit)
                  case "investor-commit" if settings.refundCase => fact.kind == "commitIncoming" && fact.resource == credit && pid == ids.account(credit)
                  case "collection-commit" if !settings.refundCase => fact.kind == "commitIncoming" && fact.resource == credit && pid == ids.account(credit)
                  case _ => false
                })
            }
          }}
          if (fault) {
            hiddenReads.incrementAndGet()
            throw new java.io.IOException("P31 receipt withheld after exact original durable ledger phase")
          }
          rows
        }
        def close(): Unit = raw.close()
      }
    }
    private def initializeWorker(): Unit = {
      client = new MockTAClient(MockTAClient.Configuration(settings.node, settings.worker, settings.root),
        settings.root.resolve("ta.jsonl"), settings.invocation.resolve("worker.jsonl"),
        settings.invocation.resolve("worker.stderr.log"))
      val readinessId = "bank-p31-worker-readiness"
      val response = await(client.query(readinessId))
      require(response.path("requestId").asText() == readinessId && response.path("status").asText() == "unknown",
        "real worker journal readiness acknowledgement required")
      val starts = workerLog().filter(_.path("kind").asText() == "worker-started")
      require(starts.size == 1 && starts.head.path("pid").isIntegralNumber && starts.head.path("pid").asLong() > 0L,
        "exact worker-started PID required")
      nodePid = starts.head.path("pid").asLong()
    }
    private val scenarioForOrder: FundOrderId => String = id => {
      require(sourceOriginal != null && id == sourceOriginal.payment.fundOrderId, "scenario cannot select a different order")
      settings.scenario
    }
    private val reconcileAuthorizer = new ReconcileAuthorizer {
      def authorize(identity: TransactionIdentity, token: String): Either[String, String] =
        if (identity != null && token == machineToken && transactions.contains(identity.transactionId))
          Right("bank-p31-owned-machine") else Left("no authority for an unregistered original transaction")
    }
    private def taInput(request: BankTaEffectRequest): Ta.State =
      Ta.State(Ta.Inputs(request.taRequestId, request.fundOrderId, request.paymentTxId))
    private def retainTa(request: BankTaEffectRequest): Unit = synchronized {
      require(request.fundOrderId == sourceOriginal.payment.fundOrderId &&
        request.paymentTxId.value == PaymentHost.operationIdentity(cashInput(sourceOriginal.payment)), "foreign TA original")
      taRequest.get().foreach(prior => require(prior == request, "TA retry changed the original"))
      taRequest.set(Some(request))
    }
    private def matchesTa(id: FundOrderId, payment: TxId, request: TaRequestId): Boolean =
      taRequest.get().contains(BankTaEffectRequest(request, id, payment))
    private def matchesRefundDelivery(command: FundOrderProtocol.RecordFundRefundSucceeded): Boolean =
      refundGraph.get().exists(graph => command.refundOperationId == graph.original.refundOperationId &&
        command.refundTxId.value == graph.transactionId)
    private def checkedTaOperation(operation: BankTaEffectOperation): Unit = {
      retainTa(operation.request)
      require(operation.operation == TaHost.operationIdentity(taInput(operation.request)), "fault changed TA operation identity")
    }
    private def extraSpawn[C](pid: String, behavior: Behavior[C]): BankActorHandle[C] = synchronized {
      require(settings.crashing && settings.deliveryAckCase && !runtimeClosed && ids.owns(pid) &&
        !extraPersistenceIds(pid), "exclusive crash graph writer required")
      val ref = system.systemActorOf(behavior, "bank-" + sha(pid.getBytes(UTF_8)))
      extraPersistenceIds += pid
      extraActors += ref
      BankActorHandle(pid, ref)
    }
    /** One nonpersistent order proxy shared by directory.order and the real Installed.
      * Every retry stays held. GetState and unrelated commands/replies remain real.
      * The relay receives the real aggregate reply BEFORE a binding can observe it;
      * discovering a PB after the completion callback escaped is not this fault.
      */
    private def orderProxy(real: ActorRef[FundOrderAggregate.Request]): ActorRef[FundOrderAggregate.Request] = synchronized {
      if (!settings.crashing || !settings.newCase || !originalOrderRef.get().contains(real)) real
      else orderProxies.getOrElseUpdate(real, {
        val ref = system.systemActorOf(Behaviors.setup[FundOrderAggregate.Request] { context =>
          Behaviors.receiveMessage {
            case execute @ FundOrderAggregate.Execute(command, replyTo) =>
              val (blockForward, blockAck) = command match {
                case c: FundOrderProtocol.RecordFundTAAccepted if settings.caseName == "ta-submitted-before-bank-accept" &&
                    matchesTa(c.fundOrderId, c.paymentTxId, c.taRequestId) => (true, false)
                case c: FundOrderProtocol.RecordFundTAConfirmed if settings.confirmedCase &&
                    matchesTa(c.fundOrderId, c.paymentTxId, c.taRequestId) => (true, false)
                case c: FundOrderProtocol.RequestFundPurchaseRefund if settings.caseName == "ta-rejected-after-ingest-before-ack" &&
                    c.fundOrderId == sourceOriginal.payment.fundOrderId &&
                    c.paymentTxId.value == PaymentHost.operationIdentity(cashInput(sourceOriginal.payment)) => (true, false)
                case c: FundOrderProtocol.RecordFundTARejected if settings.caseName == "ta-rejected-after-ingest-before-ack" &&
                    matchesTa(c.fundOrderId, c.paymentTxId, c.taRequestId) => (false, true)
                case c: FundOrderProtocol.RecordFundCashPaymentSucceeded if settings.caseName == "payment-succeeded-before-delivery-ack" &&
                    c.txid.value == PaymentHost.operationIdentity(cashInput(sourceOriginal.payment)) => (false, true)
                case c: FundOrderProtocol.RecordFundRefundSucceeded if settings.caseName == "refund-succeeded-before-delivery-ack" &&
                    matchesRefundDelivery(c) => (false, true)
                case _ => (false, false)
              }
              if (blockForward) blockedSends.incrementAndGet()
              else if (blockAck) {
                val relay = context.spawnAnonymous(Behaviors.receiveMessage[FundOrderAggregate.Reply] {
                  case accepted @ FundOrderAggregate.Accepted(events) =>
                    // Empty idempotent replies are also swallowed, but are NOT evidence
                    // that the original nonempty persist-and-ACK boundary was intercepted.
                    if (events.nonEmpty) {
                      val matches = events.forall { event => (command, event) match {
                        case (c: FundOrderProtocol.RecordFundTARejected, e: FundOrderProtocol.FundTARejected) =>
                          e.fundOrderId == c.fundOrderId && e.paymentTxId == c.paymentTxId && e.taRequestId == c.taRequestId &&
                            e.receiptId == c.receiptId && e.receiptBody == c.receiptBody && e.reason == c.reason
                        case (c: FundOrderProtocol.RecordFundCashPaymentSucceeded, e: FundOrderProtocol.FundCashPaymentSucceeded) =>
                          e.txid == c.txid && e.kind == "succeeded"
                        case (c: FundOrderProtocol.RecordFundRefundSucceeded, e: FundOrderProtocol.FundRefundSucceeded) =>
                          e.refundTxId == c.refundTxId && e.refundOperationId == c.refundOperationId &&
                            e.receiptId == c.receiptId && e.receiptBody == c.receiptBody && e.kind == "succeeded"
                        case _ => false
                      }}
                      require(matches, "real nonempty ACK did not match the intercepted original command")
                      swallowedReplies.add(obj("command" -> json(command), "reply" -> json(accepted),
                        "eventTypes" -> json(events.map(_.getClass.getName))))
                      withheldAcks.incrementAndGet()
                    }
                    Behaviors.stopped
                  case other => replyTo ! other; Behaviors.stopped
                })
                real ! FundOrderAggregate.Execute(command, relay)
              } else real ! execute
              Behaviors.same
            case other => real ! other; Behaviors.same
          }
        }, "bank-p31-order-proxy-" + orderProxies.size)
        extraActors += ref
        ref
      })
    }
    private def decoratedTaBindings(real: ActorRef[FundOrderAggregate.Request]): TaHost.Installed = {
      val installed = BankTaEffectBindings.forOrders(client, scenarioForOrder)(system)(orderProxy(real))
      if (!settings.crashing || !settings.taCase) installed
      else TaHost.install(TaHost.Bindings(
        TaHost.Implementation("bankwealth.BankTaEffectExecute", "bank-v1-1", (operation: BankTaEffectOperation) => {
          checkedTaOperation(operation)
          if (settings.caseName == "ta-intent-before-submit") {
            blockedSends.incrementAndGet()
            taExecuteBlocked.future // Intent is durable, but the real delegate has NOT run.
          } else if (settings.caseName == "ta-accepted-before-effect-reply") {
            installed.execute(operation).flatMap { actual =>
              require(actual.operation == operation.operation && actual.request == operation.request &&
                actual.status == "confirmed" && actual.result.contains(BankTaEffectResult(operation.request.taRequestId)) &&
                actual.evidence.nonEmpty, "actual Installed.execute completion required")
              completedTaExecute.set(Some(actual))
              blockedSends.incrementAndGet()
              taExecuteBlocked.future // actual bank acceptance completed; withhold ONLY its effect reply
            }
          } else installed.execute(operation)
        }),
        TaHost.Implementation("bankwealth.BankTaEffectQuery", "bank-v1-1", (operation: BankTaEffectOperation) => {
          checkedTaOperation(operation)
          if (Set("ta-intent-before-submit", "ta-accepted-before-effect-reply")(settings.caseName)) {
            blockedSends.incrementAndGet(); taQueryBlocked.future // no query bypass of a held effect reply
          } else installed.query(operation)
        }),
        TaHost.Implementation("bankwealth.BankTaEffectReconcilePort", "bank-v1-1",
          (input: BankTaEffectReconcile) => installed.reconcile(input))))
    }
    private def crashCash(original: BankPaymentOriginal): Future[BankCashRuntime] = synchronized {
      require(settings.crashing && settings.caseName == "payment-succeeded-before-delivery-ack")
      crashCashRuns.getOrElseUpdate(original.operationId, (for {
        investorHandle <- runtime.account(original.investorAccountId)
        collectionHandle <- runtime.account(original.fundCollectionAccountId)
        destination <- runtime.order(original.fundOrderId)
        state <- destination.ref.ask[FundOrderState](FundOrderAggregate.GetState)
        _ = require(state.id == original.fundOrderId && state.status != "new" && state.operationId == original.operationId &&
          state.investorAccountId == original.investorAccountId && state.fundCollectionAccountId == original.fundCollectionAccountId &&
          state.amount == original.amount && state.fundCode == original.fundCode, "cash graph requires retained complete original settlement")
      } yield {
        // Exact BankRuntime assembly, ports, PIDs and authorizer; no second ensureCash.
        var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
        val bindings = new BankPaymentBindings(original, investorHandle.ref, investorHandle.persistenceId,
          collectionHandle.ref, collectionHandle.persistenceId, orderProxy(destination.ref), destination.persistenceId,
          journal.readPb(_), () => coordinator)
        val saga = extraSpawn(ids.paymentSaga(original.operationId), PaymentDefinition.coordinator(ids.paymentSaga(original.operationId),
          PaymentDefinition.fromTechnical(bindings.installed), reconcileAuthorizer))
        coordinator = saga.ref
        val host = extraSpawn(ids.paymentHost(original.operationId), PaymentHost(ids.paymentHost(original.operationId), saga.ref, bindings.installed))
        val parent = extraSpawn(ids.paymentRun(original.operationId), Cash.behavior(ids.paymentRun(original.operationId),
          Cash.install(new Cash.PureStages {}, host.ref), new RunObserver[Cash.State] {}))
        BankCashRuntime(original, bindings.operationId, saga, host, parent)
      }).map { graph => require(graph.original == original, "same cash identity has conflicting body"); graph })
    }
    private def crashRefund(original: BankRefundOriginal): Future[BankRefundRuntime] = synchronized {
      require(settings.crashing && settings.caseName == "refund-succeeded-before-delivery-ack")
      crashRefundRuns.getOrElseUpdate(original.refundOperationId, (for {
        investorHandle <- runtime.account(original.investorAccountId)
        collectionHandle <- runtime.account(original.fundCollectionAccountId)
        destination <- runtime.order(original.fundOrderId)
        state <- destination.ref.ask[FundOrderState](FundOrderAggregate.GetState)
        _ = require(state.id == original.fundOrderId && state.selectedPaymentTxId == original.paymentTxId &&
          state.refundOperationId == original.refundOperationId && state.investorAccountId == original.investorAccountId &&
          state.fundCollectionAccountId == original.fundCollectionAccountId && state.amount == original.amount,
          "refund graph requires retained original refund intent")
      } yield {
        // Exact BankRuntime assembly, ports, PIDs and authorizer; no second ensureRefund.
        var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
        val bindings = new BankRefundBindings(original, investorHandle.ref, investorHandle.persistenceId,
          collectionHandle.ref, collectionHandle.persistenceId, orderProxy(destination.ref), destination.persistenceId,
          journal.readPb(_), () => coordinator)
        val saga = extraSpawn(ids.refundSaga(original.refundOperationId), RefundDefinition.coordinator(ids.refundSaga(original.refundOperationId),
          RefundDefinition.fromTechnical(bindings.installed), reconcileAuthorizer))
        coordinator = saga.ref
        val host = extraSpawn(ids.refundHost(original.refundOperationId), RefundHost(ids.refundHost(original.refundOperationId), saga.ref, bindings.installed))
        val parent = extraSpawn(ids.refundRun(original.refundOperationId), Refund.behavior(ids.refundRun(original.refundOperationId),
          Refund.install(new Refund.PureStages {}, host.ref), new RunObserver[Refund.State] {}))
        BankRefundRuntime(original, bindings.operationId, saga, host, parent)
      }).map { graph => require(graph.original == original, "same refund identity has conflicting body"); graph })
    }
    private def initializeRuntime(): Unit = {
      runtime = new BankRuntime(ids.namespace, journal, reconcileAuthorizer, decoratedTaBindings)
      directory = new BankRuntimeDirectory {
        def account(id: AccountId): Future[BankActorHandle[CreditBalanceAggregate.Request]] = runtime.account(id)
        def plan(id: PlanId): Future[BankActorHandle[SipPlanAggregate.Request]] = runtime.plan(id)
        def order(id: FundOrderId): Future[BankActorHandle[FundOrderAggregate.Request]] = {
          if (settings.crashing && settings.caseName == "request-before-start" && orderCalls.incrementAndGet() == 2) {
            require(id == sourceOriginal.payment.fundOrderId, "second normal cash order forward must retain original identity")
            requestBlocked.trySuccess(())
            stoppedOrderForward.future // before delegate; source has already been acknowledged
          } else runtime.order(id).map { h =>
            if (id == sourceOriginal.payment.fundOrderId) {
              originalOrderRef.get().foreach(ref => require(ref == h.ref, "original order acquired a second writer"))
              originalOrderRef.set(Some(h.ref))
            }
            h.copy(ref = orderProxy(h.ref))
          }
        }
        def ensureCash(original: BankPaymentOriginal): Future[BankCashRuntime] = {
          val installed = if (settings.crashing && settings.caseName == "payment-succeeded-before-delivery-ack")
            crashCash(original) else runtime.ensureCash(original)
          installed.map { graph =>
          require(graph.original == original && graph.transactionId == PaymentHost.operationIdentity(cashInput(original)), "actual payment graph identity mismatch")
          transactions.add(graph.transactionId)
          cashGraph.set(Some(graph))
          graph
          }
        }
        def ensureRefund(original: BankRefundOriginal): Future[BankRefundRuntime] = {
          if (settings.crashing && settings.caseName == "refund-before-assembly") {
            refundBlocked.future.value.foreach { value => require(value.get == original, "blocked refund original changed") }
            refundBlocked.trySuccess(original)
            stoppedRefundForward.future // no graph, host, coordinator or parent is fabricated
          } else {
            val installed = if (settings.crashing && settings.caseName == "refund-succeeded-before-delivery-ack")
              crashRefund(original) else runtime.ensureRefund(original)
            installed.map { graph =>
            require(graph.original == original && graph.transactionId == RefundHost.operationIdentity(refundInput(original)) &&
              graph.transactionId != original.paymentTxId.value, "actual independent refund graph identity mismatch")
            // Register BEFORE returning ensureRefund to the application's StartRun.
            // A fresh parent has no recovery work that can race this receipt mask.
            transactions.add(graph.transactionId)
            refundGraph.set(Some(graph))
            graph
            }
          }
        }
        def ensureTa(request: BankTaEffectRequest): Future[BankTaRuntime] = {
          retainTa(request)
          if (settings.crashing && settings.caseName == "ta-register-before-assembly") {
            blockedSends.incrementAndGet()
            taAssemblyBlocked.future // durable registration exists; real runtime delegate has NOT run
          } else runtime.ensureTa(request)
        }
        def ensureSipDispatch(o: SipOccurrence): Future[BankSipDispatchRuntime] = runtime.ensureSipDispatch(o)
        def close(): Unit = closeRuntime()
      }
      cash = new BankCashRequests(directory, config, admission, journal)
      sip = new BankSipApplication(directory, journal, config, admission)
      recovery = new BankRecovery(directory, journal, config, cash, machineToken)
    }
    private def attachApplications(): Unit = {
      require(ta == null && loop == null, "applications already installed")
      // Installing after the crash submission's second order call is blocked prevents
      // TA discovery from consuming the intended normal-submit call counter.
      ta = new BankTaRefundApplication(directory, journal, client, scenarioForOrder, id => {
        require(id == sourceOriginal.payment.fundOrderId, "foreign terminal notification")
        Future.successful(()) // no SIP occurrence exists in this one-off cash case
      }, config, admission, 100.millis)
      loop = new BankRecoveryLoop(journal, cash, ta, sip, recovery)
    }
    private def ready(): Unit = publish(settings, "ready.json", header("bank-crash-ready/v1", settings))

    private def image(): JournalImage = {
      // LeveldbReadJournal.currentPersistenceIds is finite (not persistenceIds).
      // Query it directly as well as using the namespace-filtering production facade,
      // so a foreign writer in this supposedly exclusive case store is a hard failure.
      val pids = await(readQuery.currentPersistenceIds().runWith(Sink.seq)).toVector.distinct.sorted
      require(pids.forall(ids.owns), "foreign persistence ID in exclusive case journal")
      val serialization = SerializationExtension(system.toClassic)
      val streams = await(Future.traverse(pids) { pid => raw.currentEvents(pid, 0L).map { rows =>
        require(rows.zipWithIndex.forall { case (r, i) => r.persistenceId == pid && r.sequenceNr == i.toLong + 1L },
          "complete contiguous original journal required")
        pid -> rows.map { row =>
          val event = row.event.asInstanceOf[AnyRef]
          val serializer = serialization.findSerializerFor(event)
          val bytes = serialization.serialize(event).get // actual configured actor serializer, not toString/JSON
          Recorded(row, serializer.identifier, Serializers.manifestFor(serializer, event), bytes,
            row.event match { case p: GeneratedMessage => Some(p.toByteArray); case _ => None })
        }
      } })
      JournalImage(streams)
    }
    private def facts(image: JournalImage): Facts = {
      val sources = image.rows.collect { case r if r.row.event.isInstanceOf[FundOrderCashRequestSourceRecordedPB] =>
        val e = DomainConverters.decodeFundOrderCashRequestSourceRecordedPB(r.row.event.asInstanceOf[FundOrderCashRequestSourceRecordedPB])
        require(e.source.contains(e.original), "source event must retain its complete original")
        require(r.row.persistenceId == ids.order(e.original.payment.fundOrderId), "cash source PID mismatch")
        e.original
      }
      require(sources.size == 1, "exactly one durable original cash source required")
      val original = sources.head
      admission.validateCash(original)
      require(original.principalId == "alice" && original.clientRequestId == "crash-request" &&
        original.request == request && original.payment.investorAccountId == investor &&
        original.payment.fundCollectionAccountId == collection, "stored original differs from this synthetic case")
      val refunds = image.rows.collect { case r if r.row.event.isInstanceOf[FundOrderFundPurchaseRefundRequestedPB] =>
        val e = DomainConverters.decodeFundOrderFundPurchaseRefundRequestedPB(r.row.event.asInstanceOf[FundOrderFundPurchaseRefundRequestedPB])
        require(r.row.persistenceId == ids.order(original.payment.fundOrderId), "refund intent PID mismatch")
        BankRefundOriginal(e.fundOrderId, e.paymentTxId, e.investorAccountId, e.fundCollectionAccountId, e.amount, e.refundOperationId)
      }
      require(refunds.size <= 1, "duplicate durable refund intents")
      val registrations = image.rows.collect { case r if r.row.event.isInstanceOf[FundOrderFundTASubmissionRegisteredPB] =>
        val e = DomainConverters.decodeFundOrderFundTASubmissionRegisteredPB(r.row.event.asInstanceOf[FundOrderFundTASubmissionRegisteredPB])
        require(r.row.persistenceId == ids.order(original.payment.fundOrderId), "TA registration PID mismatch")
        BankTaEffectRequest(e.taRequestId, e.fundOrderId, e.paymentTxId)
      }
      require(registrations.size <= 1, "duplicate durable TA registrations")
      val result = Facts(original, refunds.headOption, registrations.headOption)
      result.refund.foreach(r => require(settings.refundCase && r.fundOrderId == result.payment.fundOrderId &&
        r.paymentTxId.value == result.paymentTx && r.investorAccountId == investor &&
        r.fundCollectionAccountId == collection && r.amount == result.payment.amount && r.refundOperationId.value.nonEmpty,
        "retained refund is not the independent reverse of the original payment"))
      result.ta.foreach(t => require(t.fundOrderId == result.payment.fundOrderId && t.paymentTxId.value == result.paymentTx &&
        t.taRequestId.value.nonEmpty, "TA identity is not bound to the original payment"))
      result
    }
    private def observed(): ObservedState = {
      def account(id: AccountId): CreditBalanceState = await(await(runtime.account(id)).ref.ask[CreditBalanceState](CreditBalanceAggregate.GetState))
      def status(handle: BankActorHandle[StrictSagaCoordinator.Command]): StrictState =
        await(handle.ref.ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus)) match {
          case StrictSagaCoordinator.Status(s) => s
          case _ => throw new IllegalStateException("real coordinator did not return status")
        }
      ObservedState(await(await(runtime.order(sourceOriginal.payment.fundOrderId)).ref.ask[FundOrderState](FundOrderAggregate.GetState)),
        account(investor), account(collection), cashGraph.get().map(g => status(g.coordinator)),
        refundGraph.get().map(g => status(g.coordinator)))
    }
    private def checkSeeds(i: JournalImage): Unit = config.seeds.foreach { seed =>
      val originals = i.events(ids.account(seed.accountId)).collect { case p: CreditBalanceAccountInitializedPB =>
        DomainConverters.decodeCreditBalanceAccountInitializedPB(p)
      }
      require(originals.size == 1 && originals.head.resource == seed.accountId && originals.head.currency == seed.currency &&
        originals.head.amount == seed.amount, "one matching real account initialization required")
    }
    private def checkSettlement(i: JournalImage, f: Facts, expected: Int): Unit = {
      val rows = i.events(ids.order(f.payment.fundOrderId)).collect { case p: FundOrderFundPurchaseSettlementRequestedPB =>
        DomainConverters.decodeFundOrderFundPurchaseSettlementRequestedPB(p)
      }
      require(rows.size == expected, "settlement event count mismatch")
      rows.foreach(e => require(BankPaymentOriginal(e.operationId, e.fundOrderId, e.investorAccountId,
        e.fundCollectionAccountId, e.fundCode, e.amount) == f.payment, "settlement changed the original request"))
    }
    private def checkParent[S](i: JournalImage, pid: String, run: String, input: S,
        decode: Array[Byte] => S, cursor: String, starts: Int, done: Int): Unit = {
      val originals = i.events(pid).collect { case e: PersistentMonarch.RunStarted => e }
      require(originals.size == starts && i.count[PersistentMonarch.StageDone](pid) == done &&
        i.count[PersistentMonarch.RunFailedEvt](pid) == 0, "durable parent start/checkpoint count mismatch")
      originals.foreach(e => require(e.runId == run && e.stageCursors == Vector(cursor) && decode(e.initialSnapshot) == input,
        "durable parent inputs/identity changed"))
    }
    private def checkPaymentParent(i: JournalImage, f: Facts, starts: Int, done: Int): Unit =
      checkParent(i, ids.paymentRun(f.payment.operationId), f.payment.operationId.value, cashInput(f.payment),
        Cash.codec.decode, "pay-cash-purchase#0", starts, done)
    private def checkRefundParent(i: JournalImage, f: Facts, starts: Int, done: Int): Unit = {
      val r = f.refund.getOrElse(throw new IllegalStateException("original durable refund intent required"))
      checkParent(i, ids.refundRun(r.refundOperationId), r.refundOperationId.value, refundInput(r),
        Refund.codec.decode, "return-principal#0", starts, done)
    }
    private def ledger(i: JournalImage): Vector[LedgerFact] = i.rows.flatMap(r => ledgerFact(r.row.persistenceId, r.row.event))
    private def checkLedger(i: JournalImage, f: Facts, tx: String, debit: AccountId, credit: AccountId,
        reserve: Int, incoming: Int, deduct: Int, commit: Int): Unit = {
      val events = ledger(i).filter(_.tx == tx)
      val expected = Map("reserve" -> reserve, "recordIncoming" -> incoming, "deduct" -> deduct,
        "commitIncoming" -> commit, "release" -> 0, "cancelIncoming" -> 0)
      expected.foreach { case (kind, count) => require(events.count(_.kind == kind) == count, "exact financial phase count mismatch: " + kind) }
      events.foreach { e =>
        val account = if (Set("reserve", "deduct", "release")(e.kind)) debit else credit
        require(e.resource == account && e.pid == ids.account(account) && e.amount == f.payment.amount,
          "financial event has a substituted resource/amount/PID")
      }
    }
    private def checkKnownEvents(i: JournalImage, f: Facts): Unit = {
      val known = Set(ids.account(investor), ids.account(collection), ids.order(f.payment.fundOrderId),
        ids.paymentSaga(f.payment.operationId), ids.paymentHost(f.payment.operationId), ids.paymentRun(f.payment.operationId)) ++
        f.refund.toVector.flatMap(r => Vector(ids.refundSaga(r.refundOperationId), ids.refundHost(r.refundOperationId), ids.refundRun(r.refundOperationId))) ++
        f.ta.toVector.flatMap(t => Vector(ids.taHost(t.taRequestId), ids.taRun(t.taRequestId)))
      require(i.streams.forall(s => known(s._1)), "unexpected durable graph/PID in case namespace")
      require(ledger(i).forall(e => e.tx == f.paymentTx || f.refundTx.contains(e.tx)), "unrelated financial transaction in case journal")
      Vector(investor, collection).foreach { account => i.events(ids.account(account)).foreach {
        case _: CreditBalanceAccountInitializedPB => ()
        case e if ledgerFact(ids.account(account), e).nonEmpty => ()
        case _ => throw new IllegalStateException("unexpected account durable event")
      }}
    }
    private def checkTaHost(i: JournalImage, f: Facts, intents: Int, observations: Int): Unit = {
      val request = f.ta.getOrElse(throw new IllegalStateException("original TA registration required"))
      val input = taInput(request)
      val events = i.events(ids.taHost(request.taRequestId))
      val originals = events.collect { case e: TaHost.Intent => e }
      val receipts = events.collect { case e: TaHost.ObservationStored => e }
      val retried = settings.caseName == "ta-intent-before-submit" && observations == 1
      val retries = events.collect { case e: TaHost.RetryAuthorized => e }
      require(originals.size == intents && receipts.size == observations + (if (retried) 1 else 0) && retries.size == (if (retried) 1 else 0),
        "exact original TA host intent/observation/retry counts required")
      require(events.size == intents + receipts.size + retries.size, "unexpected TA host technical event")
      if (retried) {
        require(events.map(_.getClass) == Vector(classOf[TaHost.Intent], classOf[TaHost.ObservationStored],
          classOf[TaHost.RetryAuthorized], classOf[TaHost.ObservationStored]), "authorized retry must follow durable absence")
        val absence = DomainConverters.decodeBankTaEffectObservationPB(BankTaEffectObservationPB.parseFrom(receipts.head.value.toByteArray))
        require(absence.operation == TaHost.operationIdentity(input) && absence.request == request && absence.status == "absent" &&
          absence.result.isEmpty && BankTaEffectBindings.authoritativeAbsence(mapper.readTree(absence.evidence), request.taRequestId.value) &&
          retries.head.authorization == BankTaEffectBindings.RecoveryAuthorization && retries.head.evidence == receipts.head.value,
          "retry lacks exact original authoritative durable absence")
      }
      originals.foreach(e => require(e.operation == TaHost.operationIdentity(input) && Ta.codec.decode(e.original.toByteArray) == input,
        "TA host persisted a substituted original operation/input"))
      receipts.drop(if (retried) 1 else 0).foreach { e =>
        require(!e.value.isEmpty, "terminal TA observation must contain the actual result")
        val actual = DomainConverters.decodeBankTaEffectObservationPB(BankTaEffectObservationPB.parseFrom(e.value.toByteArray))
        require(actual.operation == TaHost.operationIdentity(input) && actual.request == request && actual.status == "confirmed" &&
          actual.result.contains(BankTaEffectResult(request.taRequestId)) && actual.evidence.nonEmpty,
          "TA host observation does not prove the original finite effect")
        val external = mapper.readTree(actual.evidence)
        require(external.path("requestId").asText() == request.taRequestId.value && external.path("status").asText() == "accepted" &&
          external.path("request").path("orderId").asText() == f.payment.fundOrderId.value &&
          external.path("request").path("paymentTxId").asText() == f.paymentTx &&
          external.path("canonicalReceipts").isArray && external.path("canonicalReceipts").size() == 1,
          "finite TA effect observation must retain real tick-zero acceptance, not terminal investment success")
      }
    }
    private def checkTaParent(i: JournalImage, f: Facts, starts: Int, done: Int): Unit = {
      val request = f.ta.getOrElse(throw new IllegalStateException("original TA registration required"))
      checkParent(i, ids.taRun(request.taRequestId), request.taRequestId.value, taInput(request),
        Ta.codec.decode, "submit-ta#0", starts, done)
    }
    private def checkDelivery(i: JournalImage, f: Facts, paymentAck: Int, refundAck: Option[Int]): Unit = {
      val paymentPid = ids.paymentHost(f.payment.operationId)
      val paymentResults = i.events(paymentPid).collect { case e: PaymentHost.ResultIntent => e.kind }
      val paymentAcks = i.events(paymentPid).collect { case e: PaymentHost.DeliveryAcknowledged => e.kind }
      require(paymentResults == Vector("succeeded") && paymentAcks == Vector.fill(paymentAck)("succeeded"),
        "payment result intent/delivery ACK prefix mismatch")
      refundAck.foreach { expected =>
        val original = f.refund.getOrElse(throw new IllegalStateException("refund delivery without original intent"))
        val events = i.events(ids.refundHost(original.refundOperationId))
        require(events.collect { case e: RefundHost.ResultIntent => e.kind } == Vector("succeeded") &&
          events.collect { case e: RefundHost.DeliveryAcknowledged => e.kind } == Vector.fill(expected)("succeeded"),
          "refund result intent/delivery ACK prefix mismatch")
      }
    }
    private def checkNewPrefix(i: JournalImage, f: Facts): Unit = {
      val pid = ids.order(f.payment.fundOrderId)
      checkSettlement(i, f, 1)
      checkLedger(i, f, f.paymentTx, investor, collection, 1, 1, 1, 1)
      require(i.count[FundOrderReserveFundSubscriptionConfirmedPB](pid) == 1 &&
        i.count[FundOrderFundSubscriptionPaymentConfirmedPB](pid) == 1 &&
        i.count[FundOrderFundCashPaymentSucceededPB](pid) == 1, "new crash prefix must retain exactly one actual successful payment")
      val paymentAck = settings.caseName != "payment-succeeded-before-delivery-ack"
      checkPaymentParent(i, f, 1, if (paymentAck) 1 else 0)
      checkDelivery(i, f, if (paymentAck) 1 else 0,
        if (settings.caseName == "refund-succeeded-before-delivery-ack") Some(0) else None)
      if (!paymentAck) {
        require(f.ta.isEmpty && f.refund.isEmpty && i.count[FundOrderFundTASubmissionRegisteredPB](pid) == 0,
          "payment ACK barrier must not start TA discovery")
      } else {
        require(f.ta.nonEmpty && i.count[FundOrderFundTASubmissionRegisteredPB](pid) == 1, "one real TA registration required")
        val unassembled = settings.caseName == "ta-register-before-assembly"
        val completed = settings.confirmedCase || settings.caseName == "ta-rejected-after-ingest-before-ack" || settings.deliveryAckCase
        checkTaParent(i, f, if (unassembled) 0 else 1, if (completed) 1 else 0)
        checkTaHost(i, f, if (unassembled) 0 else 1, if (completed) 1 else 0)
        val accepted = Set("ta-accepted-before-effect-reply", "ta-confirmed-before-ingest",
          "ta-rejected-after-ingest-before-ack", "refund-succeeded-before-delivery-ack")(settings.caseName)
        require(i.count[FundOrderFundTAAcceptedPB](pid) == (if (accepted) 1 else 0), "exact bank TA acceptance prefix mismatch")
      }
      require(i.count[FundOrderFundTASharesConfirmedPB](pid) == 0 && i.count[FundOrderFundTAUnknownPB](pid) == 0,
        "TA prefix ingested confirmation or unknown instead of the designated boundary")
      val rejected = settings.refundCase
      val refundStarted = settings.caseName == "refund-succeeded-before-delivery-ack"
      require(i.count[FundOrderFundTARejectedPB](pid) == (if (rejected) 1 else 0) &&
        i.count[FundOrderFundPurchaseRefundRequestedPB](pid) == (if (refundStarted) 1 else 0) &&
        i.count[FundOrderFundRefundSucceededPB](pid) == (if (refundStarted) 1 else 0), "exact rejection/refund prefix mismatch")
      if (refundStarted) {
        require(f.refund.nonEmpty, "refund ACK barrier lost its independent original")
        checkRefundParent(i, f, 1, 0)
        checkLedger(i, f, f.refundTx.get, collection, investor, 1, 1, 1, 1)
      } else require(f.refund.isEmpty, "TA barrier must not retain a refund intent/graph")
    }
    private def checkPrefix(i: JournalImage, f: Facts): Unit = {
      checkSeeds(i); checkKnownEvents(i, f)
      val orderPid = ids.order(f.payment.fundOrderId)
      require(i.count[FundOrderCashRequestSourceRecordedPB](orderPid) == 1, "one original source required")
      if (settings.newCase) checkNewPrefix(i, f)
      else if (settings.caseName == "request-before-start") {
        checkSettlement(i, f, 0); checkPaymentParent(i, f, 0, 0)
        checkLedger(i, f, f.paymentTx, investor, collection, 0, 0, 0, 0)
        require(f.refund.isEmpty && f.ta.isEmpty && i.count[FundOrderFundCashPaymentSucceededPB](orderPid) == 0,
          "request barrier advanced into payment/TA/refund")
      } else if (settings.refundCase) {
        checkSettlement(i, f, 1); checkPaymentParent(i, f, 1, 1)
        checkLedger(i, f, f.paymentTx, investor, collection, 1, 1, 1, 1)
        require(f.refund.nonEmpty && f.ta.nonEmpty && i.count[FundOrderFundCashPaymentSucceededPB](orderPid) == 1 &&
          i.count[FundOrderFundTARejectedPB](orderPid) == 1 && i.count[FundOrderFundPurchaseRefundRequestedPB](orderPid) == 1 &&
          i.count[FundOrderFundRefundSucceededPB](orderPid) == 0, "refund barrier lacks original paid/rejected intent")
        val r = f.refund.get
        if (settings.caseName == "refund-before-assembly") {
          checkRefundParent(i, f, 0, 0)
          checkLedger(i, f, f.refundTx.get, collection, investor, 0, 0, 0, 0)
          require(i.events(ids.refundHost(r.refundOperationId)).isEmpty && i.events(ids.refundSaga(r.refundOperationId)).isEmpty,
            "before-assembly barrier already assembled a durable refund graph")
        } else {
          checkRefundParent(i, f, 1, 0)
          checkLedger(i, f, f.refundTx.get, collection, investor, 1,
            if (settings.phase == "prepare") 0 else 1,
            if (settings.phase == "prepare") 0 else 1,
            if (settings.phase == "investor-commit") 1 else 0)
        }
      } else {
        checkSettlement(i, f, 1); checkPaymentParent(i, f, 1, 0)
        checkLedger(i, f, f.paymentTx, investor, collection, 1,
          if (settings.phase == "prepare") 0 else 1,
          if (settings.phase == "prepare") 0 else 1,
          if (settings.phase == "collection-commit") 1 else 0)
        require(f.refund.isEmpty && f.ta.isEmpty && i.count[FundOrderFundCashPaymentSucceededPB](orderPid) == 0,
          "payment phase barrier advanced into a business success/TA/refund")
      }
    }
    private def checkIdentities(i: JournalImage, f: Facts, s: ObservedState, terminal: Boolean): Unit = {
      def check(state: Option[StrictState], tx: String, hostPid: String, stored: Vector[TransactionIdentity]): Unit = {
        require(stored.distinct.size <= 1 && stored.forall(_.transactionId == tx), "retained host identity changed")
        state.foreach { actual =>
          require(actual.identity.exists(_.transactionId == tx), "coordinator changed the original transaction")
          stored.foreach(id => require(actual.identity.contains(id), "coordinator identity differs from original host journal"))
          if (terminal) require(actual.status == StrictStatus.Succeeded && actual.terminal, "original Saga is not successful")
        }
        if (terminal) require(state.nonEmpty && stored.nonEmpty, "terminal graph lacks actual coordinator/host identity")
      }
      val paymentIds = i.events(ids.paymentHost(f.payment.operationId)).collect { case e: PaymentHost.IdentityObserved => e.identity }
      check(s.payment, f.paymentTx, ids.paymentHost(f.payment.operationId), paymentIds)
      f.refund.foreach { r =>
        val refundIds = i.events(ids.refundHost(r.refundOperationId)).collect { case e: RefundHost.IdentityObserved => e.identity }
        check(s.refund, f.refundTx.get, ids.refundHost(r.refundOperationId), refundIds)
      }
    }
    private def checkPaidOrder(f: Facts, s: ObservedState): Unit =
      require(s.order.id == f.payment.fundOrderId && s.order.cashRequestSource.contains(f.original) &&
        s.order.cashRequestOriginals.values.toVector == Vector(f.original) && s.order.operationId == f.payment.operationId &&
        s.order.investorAccountId == investor && s.order.fundCollectionAccountId == collection &&
        s.order.fundCode == f.payment.fundCode && s.order.amount == f.payment.amount &&
        s.order.selectedPaymentTxId.value == f.paymentTx && s.order.cashPaymentFinalResults == Map(TxId(f.paymentTx) -> "succeeded"),
        "generated paid order differs from the original durable request")
    private def checkAccounts(f: Facts, s: ObservedState, refunded: Boolean): Unit = {
      def account(a: CreditBalanceState, id: AccountId, balance: String, outgoing: Map[TxId, Money], incoming: Map[TxId, Money]): Unit =
        require(a.id == id && a.initialized && a.accountBalance == Map("CNY" -> Money(BigDecimal(balance), "CNY")) &&
          a.reservedAmount.isEmpty && a.incomingCredits.isEmpty && a.compensatedOutgoing.isEmpty && a.compensatedIncoming.isEmpty &&
          a.committedOutgoing == outgoing && a.committedIncoming == incoming, "generated account effects/balance do not reconcile")
      val paid = Map(TxId(f.paymentTx) -> f.payment.amount)
      val returned = if (refunded) Map(TxId(f.refundTx.get) -> f.payment.amount) else Map.empty[TxId, Money]
      account(s.investor, investor, if (refunded) "1000.00" else "900.00", paid, returned)
      account(s.collection, collection, if (refunded) "0.00" else "100.00", returned, paid)
    }
    private def checkNewBarrierState(i: JournalImage, f: Facts, s: ObservedState): Unit = {
      checkPaidOrder(f, s)
      checkAccounts(f, s, refunded = settings.caseName == "refund-succeeded-before-delivery-ack")
      // All money is already committed, including at both missing-delivery-ACK windows.
      checkIdentities(i, f, s, terminal = true)
      val expectedTa = settings.caseName match {
        case "payment-succeeded-before-delivery-ack" => ""
        case "ta-register-before-assembly" | "ta-intent-before-submit" | "ta-submitted-before-bank-accept" => "submitted"
        case "ta-rejected-after-ingest-before-ack" | "refund-succeeded-before-delivery-ack" => "rejected"
        case _ => "accepted"
      }
      require(s.order.taStatus == expectedTa && s.order.taConfirmedShares.shares.value.isEmpty &&
        s.order.taConfirmedShares.nav.value.isEmpty, "barrier TA state passed the selected ingest boundary")
      f.ta.foreach(request => require(s.order.taRequestId == request.taRequestId, "barrier changed TA request identity"))
      if (settings.caseName == "refund-succeeded-before-delivery-ack") {
        require(s.order.refundOperationId == f.refund.get.refundOperationId && s.order.refundOutcome == "succeeded" &&
          s.order.refundFinalResults == Map(TxId(f.refundTx.get) -> "succeeded"), "real refund result/state missing at ACK barrier")
      } else require(s.order.refundOperationId.value.isEmpty && s.order.refundFinalResults.isEmpty,
        "TA/payment barrier advanced to refund state")
    }
    private def checkTerminal(i: JournalImage, f: Facts, s: ObservedState): Unit = {
      checkSeeds(i); checkKnownEvents(i, f); checkSettlement(i, f, 1)
      val pid = ids.order(f.payment.fundOrderId)
      require(i.count[FundOrderCashRequestSourceRecordedPB](pid) == 1 &&
        i.count[FundOrderReserveFundSubscriptionConfirmedPB](pid) == 1 &&
        i.count[FundOrderFundSubscriptionPaymentConfirmedPB](pid) == 1 &&
        i.count[FundOrderFundCashPaymentSucceededPB](pid) == 1, "payment business event vector is not exactly once")
      checkPaymentParent(i, f, 1, 1)
      checkLedger(i, f, f.paymentTx, investor, collection, 1, 1, 1, 1)
      checkPaidOrder(f, s)
      val registered = f.ta.getOrElse(throw new IllegalStateException("original TA registration required at result"))
      require(s.order.taRequestId == registered.taRequestId && i.count[FundOrderFundTASubmissionRegisteredPB](pid) == 1,
        "TA registration identity/count mismatch")
      checkParent(i, ids.taRun(registered.taRequestId), registered.taRequestId.value,
        Ta.State(Ta.Inputs(registered.taRequestId, registered.fundOrderId, registered.paymentTxId)),
        Ta.codec.decode, "submit-ta#0", 1, 1)
      if (settings.refundCase) {
        val r = f.refund.getOrElse(throw new IllegalStateException("original reverse refund required"))
        require(s.order.taStatus == "rejected" && s.order.refundOperationId == r.refundOperationId &&
          s.order.refundOutcome == "succeeded" && s.order.refundFinalResults == Map(TxId(f.refundTx.get) -> "succeeded") &&
          i.count[FundOrderFundTARejectedPB](pid) == 1 && i.count[FundOrderFundPurchaseRefundRequestedPB](pid) == 1 &&
          i.count[FundOrderFundRefundSucceededPB](pid) == 1, "original refund business event vector is not exactly once")
        checkRefundParent(i, f, 1, 1)
        checkLedger(i, f, f.refundTx.get, collection, investor, 1, 1, 1, 1)
      } else require(f.refund.isEmpty && s.order.taStatus == settings.terminalTaStatus && s.order.refundOperationId.value.isEmpty &&
        s.order.refundFinalResults.isEmpty && i.count[FundOrderFundTARejectedPB](pid) == 0 &&
        i.count[FundOrderFundPurchaseRefundRequestedPB](pid) == 0 && i.count[FundOrderFundRefundSucceededPB](pid) == 0,
        "accepted/confirmed payment must not become a rejection/refund")
      if (settings.confirmedCase) {
        val confirmations = i.events(pid).collect { case p: FundOrderFundTASharesConfirmedPB =>
          DomainConverters.decodeFundOrderFundTASharesConfirmedPB(p)
        }
        val exact = FundShare(f.payment.fundCode, TaExactText("80.0000"), TaExactText("1.2345"))
        require(confirmations.size == 1 && s.order.taConfirmedShares == exact, "real confirmation lost exact mock shares/NAV")
        confirmations.foreach(e => require(e.fundOrderId == f.payment.fundOrderId && e.paymentTxId.value == f.paymentTx &&
          e.taRequestId == registered.taRequestId && e.fundCode == f.payment.fundCode && e.currency == "CNY" &&
          e.shares == exact && e.taReference == s.order.taReference && s.order.taReceipts.get(e.receiptId).contains(e.receiptBody) &&
          s.order.taReceiptOutcomes.get(e.receiptId).contains("confirmed"), "bank confirmation changed the authoritative receipt"))
      } else require(s.order.taConfirmedShares.shares.value.isEmpty && i.count[FundOrderFundTASharesConfirmedPB](pid) == 0,
        "technical TA completion was promoted into investment success")
      checkAccounts(f, s, refunded = settings.refundCase)
      if (settings.newCase) {
        require(i.count[FundOrderFundTAAcceptedPB](pid) == 1 && i.count[FundOrderFundTAUnknownPB](pid) == 0,
          "terminal new-case TA acceptance/unknown event vector mismatch")
        checkTaHost(i, f, 1, 1)
        checkDelivery(i, f, 1, if (settings.refundCase) Some(1) else None)
      }
      checkIdentities(i, f, s, terminal = true)
    }
    private def counts(i: JournalImage, f: Facts): ObjectNode = {
      val pid = ids.order(f.payment.fundOrderId)
      def txCounts(tx: String): ObjectNode = obj(Vector("reserve", "recordIncoming", "deduct", "commitIncoming", "release", "cancelIncoming")
        .map(kind => kind -> json(ledger(i).count(e => e.tx == tx && e.kind == kind))): _*)
      def parent(pid: String): ObjectNode = obj("RunStarted" -> json(i.count[PersistentMonarch.RunStarted](pid)),
        "StageDone" -> json(i.count[PersistentMonarch.StageDone](pid)), "RunFailedEvt" -> json(i.count[PersistentMonarch.RunFailedEvt](pid)))
      obj("source" -> json(i.count[FundOrderCashRequestSourceRecordedPB](pid)),
        "settlement" -> json(i.count[FundOrderFundPurchaseSettlementRequestedPB](pid)),
        "paymentResult" -> json(i.count[FundOrderFundCashPaymentSucceededPB](pid)),
        "taRegistration" -> json(i.count[FundOrderFundTASubmissionRegisteredPB](pid)),
        "taAccepted" -> json(i.count[FundOrderFundTAAcceptedPB](pid)),
        "taConfirmed" -> json(i.count[FundOrderFundTASharesConfirmedPB](pid)),
        "taHostIntent" -> json(f.ta.map(t => i.count[TaHost.Intent](ids.taHost(t.taRequestId))).getOrElse(0)),
        "taHostObservations" -> json(f.ta.map(t => i.count[TaHost.ObservationStored](ids.taHost(t.taRequestId))).getOrElse(0)),
        "paymentDeliveryAcknowledged" -> json(i.count[PaymentHost.DeliveryAcknowledged](ids.paymentHost(f.payment.operationId))),
        "refundDeliveryAcknowledged" -> json(f.refund.map(r => i.count[RefundHost.DeliveryAcknowledged](ids.refundHost(r.refundOperationId))).getOrElse(0)),
        "taRejection" -> json(i.count[FundOrderFundTARejectedPB](pid)),
        "refundIntent" -> json(i.count[FundOrderFundPurchaseRefundRequestedPB](pid)),
        "refundResult" -> json(i.count[FundOrderFundRefundSucceededPB](pid)),
        "payment" -> txCounts(f.paymentTx), "refund" -> f.refundTx.map(txCounts).getOrElse(json(null)),
        "paymentParent" -> parent(ids.paymentRun(f.payment.operationId)),
        "refundParent" -> f.refund.map(r => parent(ids.refundRun(r.refundOperationId))).getOrElse(json(null)),
        "taParent" -> f.ta.map(t => parent(ids.taRun(t.taRequestId))).getOrElse(json(null)))
    }
    private def taJournal(): ObjectNode = {
      val file = settings.root.resolve("ta.jsonl")
      val bytes = Files.readAllBytes(file)
      require(bytes.nonEmpty && bytes.last == '\n'.toByte, "complete real TA JSONL journal required")
      val records = new String(bytes, UTF_8).split("\n").toVector.map(mapper.readTree)
      require(records.zipWithIndex.forall { case (r, index) => r.path("seq").asLong() == index.toLong + 1L }, "TA journal sequence gap")
      obj("byteCount" -> json(bytes.length), "sha256" -> json(sha(bytes)), "recordCount" -> json(records.size),
        "submissionCount" -> json(records.count(_.path("event").path("kind").asText() == "RequestSubmitted")),
        "advanceCount" -> json(records.count(_.path("event").path("kind").asText() == "ClockAdvanced")),
        "records" -> array(records))
    }
    private def prefixTaStatus: String = settings.caseName match {
      case "ta-register-before-assembly" | "ta-intent-before-submit" => "unknown"
      case "ta-confirmed-before-ingest" => "confirmed"
      case "ta-rejected-after-ingest-before-ack" | "refund-succeeded-before-delivery-ack" => "rejected"
      case _ => "accepted"
    }
    private def checkTa(f: Facts, expectedStatus: String = settings.terminalTaStatus): ObjectNode = {
      val t = f.ta.getOrElse(throw new IllegalStateException("TA registration required"))
      val response = await(client.query(t.taRequestId.value))
      val original = response.path("request")
      require(response.path("requestId").asText() == t.taRequestId.value && response.path("status").asText() == expectedStatus &&
        response.path("canonicalReceipts").isArray, "real TA original/status does not reconcile")
      val unknown = expectedStatus == "unknown"
      if (unknown) require(!original.isObject && response.path("canonicalReceipts").size() == 0,
        "unsubmitted TA prefix must have no real original/receipt")
      else require(original.path("requestId").asText() == t.taRequestId.value && original.path("orderId").asText() == f.payment.fundOrderId.value &&
        original.path("paymentTxId").asText() == f.paymentTx && original.path("investorAccountId").asText() == investor.value &&
        original.path("fundCollectionAccountId").asText() == collection.value && original.path("fundCode").asText() == "fund" &&
        original.path("amount").path("minorUnits").asText() == "10000" && original.path("amount").path("currency").asText() == "CNY" &&
        original.path("scenario").asText() == settings.scenario, "real TA retained financial original/scenario differs")
      if (settings.newCase) {
        val terminal = Set("confirmed", "rejected")(expectedStatus)
        require(response.path("businessTick").asLong(-1L) == (if (terminal) 1L else 0L) &&
          response.path("canonicalReceipts").size() == (if (unknown) 0 else if (terminal) 2 else 1),
          "exact external TA tick/receipt prefix mismatch")
        response.path("canonicalReceipts").elements().asScala.foreach { receipt =>
          require(receipt.path("requestId").asText() == t.taRequestId.value && receipt.path("orderId").asText() == f.payment.fundOrderId.value &&
            receipt.path("paymentTxId").asText() == f.paymentTx && receipt.path("investorAccountId").asText() == investor.value &&
            receipt.path("fundCollectionAccountId").asText() == collection.value && receipt.path("fundCode").asText() == "fund" &&
            receipt.path("amount") == original.path("amount") && receipt.path("receiptId").asText().nonEmpty &&
            receipt.path("taReference").asText().nonEmpty, "real TA receipt changed original identity/amount")
        }
        if (expectedStatus == "confirmed") {
          val confirmation = response.path("canonicalReceipts").elements().asScala.filter(_.path("outcome").asText() == "confirmed").toVector
          require(confirmation.size == 1 && confirmation.head.path("shares").path("fundCode").asText() == "fund" &&
            confirmation.head.path("shares").path("shares").asText() == "80.0000" &&
            confirmation.head.path("shares").path("nav").asText() == "1.2345", "trusted mock confirmation fixture differs")
        }
      }
      val durable = taJournal()
      require(durable.path("submissionCount").asInt() == (if (unknown) 0 else 1), "TA must retain exactly the original submission prefix")
      if (settings.newCase) require(durable.path("advanceCount").asInt() ==
        (if (Set("confirmed", "rejected")(expectedStatus)) 1 else 0), "only crash may have advanced the real external clock once")
      obj("query" -> response, "journal" -> durable)
    }
    private def checkBankTaReceipts(f: Facts, s: ObservedState, external: JsonNode): Unit = {
      val receipts = external.path("query").path("canonicalReceipts").elements().asScala.toVector
      val expected = receipts.map(r => r.path("receiptId").asText() -> mapper.writeValueAsString(r)).toMap
      val outcomes = receipts.map(r => r.path("receiptId").asText() -> r.path("outcome").asText()).toMap
      require(s.order.taReceipts == expected && s.order.taReceiptOutcomes == outcomes &&
        receipts.forall(r => r.path("requestId").asText() == f.ta.get.taRequestId.value && r.path("taReference").asText() == s.order.taReference),
        "generated bank receipts differ from complete authoritative TA receipt bodies")
    }
    private def identities(f: Facts, s: ObservedState): ObjectNode = obj("operationId" -> json(f.payment.operationId.value),
      "fundOrderId" -> json(f.payment.fundOrderId.value), "paymentTxId" -> json(f.paymentTx),
      "refundOriginal" -> json(f.refund), "refundTxId" -> json(f.refundTx), "taOriginal" -> json(f.ta),
      "paymentTransactionIdentity" -> json(s.payment.flatMap(_.identity)), "refundTransactionIdentity" -> json(s.refund.flatMap(_.identity)))
    private def financial(i: JournalImage, f: Facts, s: ObservedState, external: JsonNode): ObjectNode = obj(
      "original" -> json(f.original), "identities" -> identities(f, s), "eventCounts" -> counts(i, f),
      "order" -> json(s.order), "investor" -> json(s.investor), "collection" -> json(s.collection),
      "durablePbVector" -> i.pbVector, "allPbEventsSha256" -> json(i.pbHash), "ta" -> external)
    private def evidence(i: JournalImage, f: Facts, s: ObservedState, external: JsonNode): ObjectNode = obj(
      "original" -> json(f.original), "identities" -> identities(f, s), "eventCounts" -> counts(i, f),
      "state" -> s.report, "journal" -> i.report, "financial" -> financial(i, f, s, external),
      "processes" -> obj("javaPid" -> json(javaPid), "nodePid" -> json(nodePid), "nodePidSource" -> json("worker.jsonl:worker-started")),
      "fault" -> obj("forwardBlocked" -> json(requestBlocked.isCompleted || refundBlocked.isCompleted ||
        blockedSends.get() > 0 || withheldAcks.get() > 0),
        "hiddenReceiptReads" -> json(hiddenReads.get()), "blockedSends" -> json(blockedSends.get()),
        "withheldAcks" -> json(withheldAcks.get()), "actualWithheldReplies" -> array(swallowedReplies.iterator().asScala.toVector),
        "completedTaExecute" -> json(completedTaExecute.get()), "enabled" -> json(settings.crashing)),
      "storage" -> obj("provider" -> json("local"), "journal" -> json("akka.persistence.journal.leveldb"),
        "native" -> json(false), "fsync" -> json(true), "snapshotStore" -> json("akka.persistence.snapshot-store.local")))

    private def preservedPrefix(before: JsonNode, after: JournalImage, technicalOnly: Boolean): Vector[Recorded] = {
      val prior = before.path("streams").elements().asScala.toVector
      val extras = Vector.newBuilder[Recorded]
      prior.foreach { stream =>
        val pid = stream.path("persistenceId").asText()
        val old = stream.path("events").elements().asScala.toVector
        val now = after.streams.find(_._1 == pid).map(_._2).getOrElse(Vector.empty)
        require(now.size >= old.size && now.take(old.size).map(_.description) == old,
          "serialized durable original prefix changed: " + pid)
        extras ++= now.drop(old.size)
      }
      val priorPids = prior.map(_.path("persistenceId").asText()).toSet
      extras ++= after.streams.filterNot(s => priorPids(s._1)).flatMap(_._2)
      val added = extras.result()
      if (technicalOnly) added.foreach { r =>
        val name = r.row.event.getClass.getName
        val allowed = Vector("net.imadz.infra.saga.strict.", "net.imadz.monarch.persistence.PersistentMonarch$",
          "example.bankwealth.application.bank_payment_hostHost$", "example.bankwealth.application.bank_refund_hostHost$",
          "example.bankwealth.application.bank_ta_effectEffectHost$").exists(name.startsWith)
        require(r.pb.isEmpty && allowed && !r.row.event.isInstanceOf[PersistentMonarch.RunStarted] &&
          !r.row.event.isInstanceOf[PersistentMonarch.StageDone] && !r.row.event.isInstanceOf[PersistentMonarch.RunFailedEvt],
          "verify appended a financial fact or duplicate parent checkpoint")
      }
      added
    }
    private def recoveredReport(): JsonNode = {
      val files = Files.walk(settings.root.resolve("runs"))
      val candidates = try files.iterator().asScala.filter(p => Files.isRegularFile(p) && p.getFileName.toString == "result.json")
        .map { p => noSymlinks(p); p -> mapper.readTree(Files.readAllBytes(p)) }.filter { case (_, r) =>
          r.path("schemaVersion").asText() == "bank-crash-result/v1" && r.path("mode").asText() == "recover" &&
            r.path("caseName").asText() == settings.caseName && r.path("namespace").asText() == settings.namespace &&
            r.path("passed").isBoolean && r.path("passed").asBoolean()
        }.toVector finally files.close()
      require(candidates.size == 1, "verify needs exactly one successful recover result in this case's runs directory")
      val (file, report) = candidates.head
      val closed = file.getParent.resolve("closed.json")
      noSymlinks(closed)
      require(Files.isRegularFile(closed), "verify requires recover's normal cleanup receipt")
      val receipt = mapper.readTree(Files.readAllBytes(closed))
      require(receipt.path("schemaVersion").asText() == "bank-crash-closed/v1" &&
        receipt.path("pid").asLong() == report.path("pid").asLong() && receipt.path("namespace").asText() == settings.namespace &&
        receipt.path("caseName").asText() == settings.caseName, "recover cleanup receipt identity mismatch")
      report
    }

    def run(): ObjectNode = {
      initializeJournal()
      val initial = image() // read before installing any auto-resuming bank actors/applications
      val previous = if (settings.mode == "verify") Some(recoveredReport()) else None
      if (settings.crashing) {
        require(initial.rows.isEmpty && initial.streams.isEmpty, "crash requires a truly empty local journal")
        sourceOriginal = admission.cash(Principal("alice", Set("customer")), request) match {
          case Right(original) => original
          case Left(_) => throw new IllegalStateException("trusted synthetic admission refused")
        }
      } else {
        val retained = facts(initial)
        sourceOriginal = retained.original
        if (settings.mode == "recover") checkPrefix(initial, retained)
        else {
          require(initial.pbHash == previous.get.path("evidence").path("journal").path("allPbEventsSha256").asText(),
            "verify's original PB event vector differs from recover")
          preservedPrefix(previous.get.path("evidence").path("journal"), initial, technicalOnly = true)
        }
      }
      initializeWorker()
      if (settings.mode == "recover" && settings.newCase) {
        val retained = facts(initial)
        if (retained.ta.nonEmpty) checkTa(retained, prefixTaStatus)
        else require(taJournal().path("submissionCount").asInt() == 0 && taJournal().path("advanceCount").asInt() == 0,
          "payment ACK prefix already submitted or advanced TA")
      }
      initializeRuntime()
      if (settings.crashing) crash()
      else {
        attachApplications()
        // No calls to cash.submit, TA submit/reconcile, refund request or ensure* in
        // this recovery branch. Only the real loop/discovery reattaches stored facts.
        await(loop.start())
        ready()
        // ta-intent-before-submit intentionally uses this SAME success oracle.
        // The current query-only production recovery may time out; do not fake a
        // retry, submit, absent receipt or checkpoint to turn that diagnostic green.
        eventually("automatic financial completion and parent checkpoints") {
          val current = image()
          checkTerminal(current, facts(current), observed())
        }
        closeDrivers()
        val state = observed()
        closeRuntime() // stop every bank writer before freezing the final raw journal vector
        val finalImage = image()
        val finalFacts = facts(finalImage)
        require(finalFacts.original == sourceOriginal, "automatic recovery changed the original request")
        checkTerminal(finalImage, finalFacts, state)
        val external = checkTa(finalFacts)
        if (settings.newCase) checkBankTaReceipts(finalFacts, state, external)
        val additions = preservedPrefix(initial.report, finalImage, technicalOnly = settings.mode == "verify")
        val report = header("bank-crash-result/v1", settings)
        val proof = evidence(finalImage, finalFacts, state, external)
        proof.set[JsonNode]("initialJournal", initial.report)
        proof.set[JsonNode]("recovery", obj("driver" -> json("BankRecoveryLoop"), "customerResubmissions" -> json(0),
          "pendingPersistenceIds" -> json(loop.pendingPersistenceIds), "preservedOriginalSerializedPrefix" -> json(true)))
        val comparison = obj("financialPolicy" -> json("exact complete original, domain state, PB sequence/bytes vector and TA journal"),
          "technicalPolicy" -> json("immutable serialized prefix; only known nonfinancial runtime appends may be ignored, never RunStarted/StageDone"),
          "appendedSinceInvocationStart" -> array(additions.map(_.description)))
        previous.foreach { prior =>
          require(proof.path("financial") == prior.path("evidence").path("financial"),
            "third JVM financial original/state/serialized event vector differs from recover")
          val added = preservedPrefix(prior.path("evidence").path("journal"), finalImage, technicalOnly = true)
          if (settings.newCase) require(added.isEmpty &&
            finalImage.allHash == prior.path("evidence").path("journal").path("allDurableEventsSerializedSha256").asText(),
            "third JVM must retain ALL journal bytes without technical events, money effects or TA resubmission")
          comparison.put("financialEqualsRecover", true)
          comparison.put("allDurableSerializedEventsEqualRecover",
            finalImage.allHash == prior.path("evidence").path("journal").path("allDurableEventsSerializedSha256").asText())
          comparison.set[JsonNode]("allowedTechnicalAppendsSinceRecover", array(added.map(_.description)))
        }
        proof.set[JsonNode]("comparison", comparison)
        report.set[JsonNode]("evidence", proof)
        // The caller adds passed/publishes only after ALL cleanup, including the worker
        // wait and ActorSystem termination, has succeeded.
        report
      }
    }
    private def prepareNewCrash(): Unit = {
      if (settings.caseName == "payment-succeeded-before-delivery-ack") {
        // Do not install TA discovery in this JVM: the original successful payment
        // still lacks its host ACK and parent checkpoint. Successor installs it.
        ready()
      } else {
        eventually("original completed payment before TA boundary") {
          val i = image(); val f = facts(i)
          checkPaymentParent(i, f, 1, 1)
          checkLedger(i, f, f.paymentTx, investor, collection, 1, 1, 1, 1)
          require(observed().order.cashPaymentFinalResults.get(TxId(f.paymentTx)).contains("succeeded"), "original payment not successful")
        }
        attachApplications(); ready()
        if (settings.refundCase || settings.confirmedCase) {
          eventually("real finite TA acceptance/checkpoint before terminal tick") {
            val i = image(); val f = facts(i)
            require(f.ta.nonEmpty && observed().order.taStatus == "accepted", "real TA accepted receipt missing")
            checkTaParent(i, f, 1, 1)
            checkTaHost(i, f, 1, 1)
            checkTa(f, "accepted")
          }
          val clock = await(client.advance(1L)) // crash ONLY; successor merely queries/ingests retained receipts
          require(clock.path("businessTick").asLong() == 1L && clock.path("canonicalReceipts").isArray &&
            clock.path("canonicalReceipts").size() == 1 &&
            clock.path("canonicalReceipts").get(0).path("outcome").asText() == settings.terminalTaStatus,
            "TA terminal decision must be the actual trusted tick-one receipt")
        }
      }
    }
    private def checkNewFault(f: Facts): Unit = {
      require(hiddenReads.get() == 0 && (blockedSends.get() > 0 || withheldAcks.get() > 0),
        "new-case fault must intercept a real forward/reply, not a hidden journal receipt")
      if (settings.deliveryAckCase || settings.caseName == "ta-rejected-after-ingest-before-ack")
        require(withheldAcks.get() > 0 && swallowedReplies.size() == withheldAcks.get(),
          "ACK barrier requires the actual original nonempty Accepted received and swallowed by the proxy")
      if (settings.caseName == "ta-accepted-before-effect-reply") {
        val original = f.ta.get
        val actual = completedTaExecute.get().getOrElse(throw new IllegalStateException("real Installed.execute did not complete"))
        require(actual.request == original && actual.operation == TaHost.operationIdentity(taInput(original)),
          "held effect reply differs from the real original execution")
      }
    }
    private def crash(): Nothing = {
      val seeds = new BankSeedAuthority(journal)
      config.seeds.foreach(seed => await(seeds.ensure(seed, await(directory.account(seed.accountId)))))
      checkSeeds(image()) // original PB initialization, not a guessed opening balance
      val submission = cash.submit(Principal("alice", Set("customer")), request)
      if (settings.caseName == "request-before-start") {
        await(requestBlocked.future)
        require(!submission.isCompleted, "normal submit must be held at its second order forward")
        attachApplications(); ready()
      } else {
        require(await(submission).isRight, "normal cash submission failed before selected barrier")
        if (settings.newCase) prepareNewCrash()
        else {
        if (settings.refundCase) eventually("original payment before TA") {
          val i = image(); val f = facts(i)
          checkPaymentParent(i, f, 1, 1)
          checkLedger(i, f, f.paymentTx, investor, collection, 1, 1, 1, 1)
          require(observed().order.cashPaymentFinalResults.get(TxId(f.paymentTx)).contains("succeeded"), "original payment not successful")
        }
        attachApplications(); ready()
        if (settings.refundCase) {
          eventually("real accepted TA submission before tick one") {
            val i = image(); val f = facts(i)
            require(f.ta.nonEmpty && observed().order.taStatus == "accepted", "real TA accepted receipt missing")
            require(taJournal().path("submissionCount").asInt() == 1, "one real TA submission required")
            val response = await(client.query(f.ta.get.taRequestId.value))
            require(response.path("status").asText() == "accepted" && response.path("businessTick").asLong() == 0L,
              "trusted rejected scenario must first be accepted at tick zero")
          }
          val clock = await(client.advance(1L)) // only crash advances the real external simulator
          require(clock.path("businessTick").asLong() == 1L, "TA rejection must be the real tick-one decision")
          if (settings.caseName == "refund-before-assembly") await(refundBlocked.future)
        }
        }
      }
      eventually("selected durable crash barrier") {
        val i = image(); val f = facts(i); val state = observed()
        checkPrefix(i, f)
        require(state.order.cashRequestSource.contains(sourceOriginal), "generated actor did not retain source")
        checkIdentities(i, f, state, terminal = false)
        if (settings.newCase) {
          checkNewBarrierState(i, f, state)
          checkNewFault(f)
          if (f.ta.nonEmpty) checkTa(f, prefixTaStatus)
        }
        if (settings.phaseCase) {
          val strict = if (settings.refundCase) state.refund else state.payment
          require(hiddenReads.get() > 0 && strict.exists(s => s.status == StrictStatus.RecoveryRequired && !s.terminal),
            "exact durable receipt loss must leave the actual coordinator RecoveryRequired")
        }
      }
      val frozen = image()
      val original = facts(frozen)
      val state = observed()
      checkPrefix(frozen, original)
      if (settings.newCase) { checkNewBarrierState(frozen, original, state); checkNewFault(original) }
      val external = if (original.ta.nonEmpty) checkTa(original,
        if (settings.newCase) prefixTaStatus else settings.terminalTaStatus) else obj("journal" -> taJournal())
      if (settings.newCase && original.ta.isEmpty) require(external.path("journal").path("submissionCount").asInt() == 0 &&
        external.path("journal").path("advanceCount").asInt() == 0, "payment ACK barrier already advanced TA")
      val barrier = header("bank-crash-barrier/v1", settings)
      val proof = evidence(frozen, original, state, external)
      proof.set[JsonNode]("barrierCondition", json(settings.caseName))
      proof.set[JsonNode]("loopStarted", json(false))
      barrier.set[JsonNode]("evidence", proof)
      publish(settings, "barrier.json", barrier)
      // The parent owns the kill. Never self-SIGKILL and never convert a missing
      // parent kill into a successful exit or a closed.json receipt.
      while (workDeadline.hasTimeLeft()) Thread.sleep(workDeadline.timeLeft.toMillis.min(250L).max(1L))
      throw new TimeoutException("crash barrier published but parent did not terminate this JVM")
    }
    private def workerLog(): Vector[JsonNode] = Files.readAllLines(settings.invocation.resolve("worker.jsonl"), UTF_8)
      .asScala.toVector.map(mapper.readTree)
    def workerClosed(): Unit = {
      val exits = workerLog().filter(_.path("kind").asText() == "worker-exited")
      require(exits.size == 1 && exits.head.path("pid").asLong() == nodePid &&
        exits.head.path("waited").asBoolean() && exits.head.path("exitCode").asInt(-1) == 0,
        "normal worker cleanup must record the original PID, wait and zero exit")
    }
    private def closeDrivers(): Unit = if (!driversClosed) {
      driversClosed = true
      cleanup(Vector(() => if (loop != null) loop.close(), () => if (ta != null) ta.close(), () => if (sip != null) sip.close()))
    }
    private def closeRuntime(): Unit = if (!runtimeClosed && runtime != null) {
      runtimeClosed = true
      cleanup(Vector(() => {
        // Parents/hosts/coordinators created here stop before runtime's order/accounts;
        // proxies are tracked too. Real generated writers, never a second PID owner.
        val refs = synchronized { val value = extraActors.reverseIterator.toVector; extraActors.clear(); value }
        val termination = refs.map(ref => akka.pattern.gracefulStop(ref.toClassic, 10.seconds, akka.actor.PoisonPill))
        Await.result(Future.sequence(termination), 15.seconds)
      }, () => runtime.close()))
    }
    def close(): Unit = cleanup(Vector(() => closeDrivers(), () => closeRuntime(),
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
      def newThread(r: Runnable): Thread = { val t = new Thread(r, "bank-p31-deadline"); t.setDaemon(true); t }
    })
    // A last-resort NONZERO bound also covers a stuck close in a frozen dependency.
    // Normal control flow always executes the ordered cleanup below; there is no
    // System.exit(0), shutdown hook that disguises failure, or self-SIGKILL.
    guard.schedule(new Runnable { def run(): Unit = {
      System.err.println("BankCrashRecoveryMain exceeded its 110-second total deadline")
      System.exit(124)
    } }, 110L, TimeUnit.SECONDS)
    var settings: Settings = null
    var system: ActorSystem[Nothing] = null
    var harness: Harness = null
    var result: ObjectNode = null
    var failure: Throwable = null
    def attempt(body: => Unit): Unit = try body catch { case error: Throwable =>
      if (failure == null) failure = error else failure.addSuppressed(error)
    }
    try {
      settings = parse(args)
      val elapsed = (System.nanoTime() - started).nanos
      val remaining = (if (settings.crashing) 65.seconds else 60.seconds) - elapsed
      require(remaining > Duration.Zero, "initialization exhausted the work deadline")
      val workDeadline = remaining.fromNow // include configuration and ActorSystem initialization in the 60s recovery budget
      system = ActorSystem[Nothing](Behaviors.empty[Nothing], "bank-p31-" + settings.namespace, storageConfiguration(settings))
      harness = new Harness(settings, workDeadline)(system)
      result = harness.run()
    } catch { case error: Throwable => failure = error }
    finally {
      // Application loops/subscriptions first, all generated writers next, read journal
      // and owned worker next, and the ActorSystem LAST. Attempt every close on failure.
      attempt { if (harness != null) harness.close() }
      attempt {
        if (system != null) { system.terminate(); Await.result(system.whenTerminated, 15.seconds) }
      }
    }
    if (failure == null) attempt {
      require(result != null && settings.mode != "crash", "only recovered/verified invocations may complete normally")
      harness.workerClosed()
      val closed = header("bank-crash-closed/v1", settings)
      closed.put("nodePid", harness.nodePid)
      closed.put("workerWaited", true)
      closed.put("actorSystemTerminated", true)
      publish(settings, "closed.json", closed)
      // Publish passed LAST: even failure to publish the cleanup receipt must not
      // leave a successful result behind. Consumers also require normal JVM exit.
      result.put("passed", true)
      publish(settings, "result.json", result)
    }
    guard.shutdownNow()
    if (failure != null) {
      // Only class/stack/error evidence; this main never prints a Config or authority
      // object, worker command environment, database settings, tokens or CSRF values.
      failure.printStackTrace(System.err)
      System.exit(1)
    }
  }
}
