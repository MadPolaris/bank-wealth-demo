package example.bankwealth.service

import akka.actor.typed.ActorSystem
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.{BankBalanceComputations, StableOrderIdentity, StableSipIdentity}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.integration._
import example.bankwealth.readside.{BankReadside, BankReadsideSchema}
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService.Principal
import java.io.PrintWriter
import java.lang.reflect.{InvocationHandler, InvocationTargetException, Method, Proxy}
import java.sql.{Connection, DriverManager, SQLException}
import java.util.{Base64, UUID}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths, StandardOpenOption}
import java.sql.Types
import play.api.libs.json._
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger
import javax.sql.DataSource
import scalapb.GeneratedMessage
import scala.collection.mutable
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._
import org.scalatest.Assertions

/** The caller owns the loopback MySQL endpoint and credential file. Every scenario
  * retains its independent schema, including on failure; no existing data is cleared.
  */
object BankMysqlNegativeMain extends Assertions {
  private def intercept[A <: Throwable : Manifest](body: => Unit): A = {
    try { body; fail("expected exception") } catch { case e: Throwable if manifest[A].runtimeClass.isInstance(e) => e.asInstanceOf[A] }
  }

  final class SimpleMysqlDataSource(url: String, user: String, password: String) extends DataSource {
    def getConnection: Connection = DriverManager.getConnection(url, user, password)
    def getConnection(u: String, p: String): Connection = DriverManager.getConnection(url, u, p)
    def getLogWriter: PrintWriter = null
    def setLogWriter(w: PrintWriter): Unit = ()
    def getLoginTimeout: Int = 0
    def setLoginTimeout(s: Int): Unit = ()
    def getParentLogger: Logger = Logger.getLogger("bank-mysql-negative")
    def unwrap[T](k: Class[T]): T = throw new SQLException("not a wrapper")
    def isWrapperFor(k: Class[_]): Boolean = false
  }

  final class FaultableDataSource(delegate: DataSource) extends DataSource {
    @volatile var failOnSql: Option[String] = None
    val hits = new AtomicInteger
    private def observe(connection: Connection): Connection =
      Proxy.newProxyInstance(classOf[Connection].getClassLoader, Array[Class[_]](classOf[Connection]), new InvocationHandler {
        def invoke(proxy: Any, method: Method, args: Array[AnyRef]): AnyRef = {
          val values = Option(args).getOrElse(Array.empty[AnyRef])
          if (method.getName == "prepareStatement" && values.headOption.exists {
              case sql: String => failOnSql.exists(sql.startsWith)
              case _ => false
            }) {
            failOnSql = None; hits.incrementAndGet()
            throw new SQLException("injected projection-index write failure")
          }
          try method.invoke(connection, values: _*)
          catch { case e: InvocationTargetException => throw e.getCause }
        }
      }).asInstanceOf[Connection]
    def getConnection: Connection = observe(delegate.getConnection)
    def getConnection(u: String, p: String): Connection = observe(delegate.getConnection(u, p))
    def getLogWriter: PrintWriter = delegate.getLogWriter
    def setLogWriter(w: PrintWriter): Unit = delegate.setLogWriter(w)
    def getLoginTimeout: Int = delegate.getLoginTimeout
    def setLoginTimeout(s: Int): Unit = delegate.setLoginTimeout(s)
    def getParentLogger: Logger = delegate.getParentLogger
    def unwrap[T](k: Class[T]): T = delegate.unwrap(k)
    def isWrapperFor(k: Class[_]): Boolean = delegate.isWrapperFor(k)
  }

  private final class Journal(val namespace: String) extends BankJournal {
    private val stored = mutable.Map.empty[String, Vector[BankJournalEnvelope]]
    def put(events: Vector[BankJournalEnvelope]): Unit = events.headOption.foreach { first =>
      require(events.forall(_.persistenceId == first.persistenceId))
      stored.put(first.persistenceId, events)
    }
    def persistenceIds(): akka.stream.scaladsl.Source[String, akka.NotUsed] =
      akka.stream.scaladsl.Source(stored.keys.toVector)
    def currentEvents(pid: String, after: Long): Future[Vector[BankJournalEnvelope]] =
      Future.successful(stored.getOrElse(pid, Vector.empty).filter(_.sequenceNr > after))
    def events(pid: String, after: Long): akka.stream.scaladsl.Source[BankJournalEnvelope, akka.NotUsed] =
      akka.stream.scaladsl.Source(stored.getOrElse(pid, Vector.empty).filter(_.sequenceNr > after))
    def close(): Unit = ()
  }

  private def save(root: Path, name: String, value: JsValue): Unit = {
    Files.write(root.resolve(name + ".json"), (Json.prettyPrint(value) + "\n").getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW)
    ()
  }
  def main(args: Array[String]): Unit = {
    require(args.length == 3, "expected owned output directory, loopback JDBC endpoint and credential file")
    val output = Paths.get(args(0)).toRealPath()
    require(output.toString == args(0) && Files.isDirectory(output))
    val url = args(1)
    require(url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]{1,5}"), "exclusive loopback endpoint required")
    val port = url.substring(url.lastIndexOf(':') + 1).toInt
    require(port > 0 && port <= 65535)
    val credential = Paths.get(args(2)).toRealPath()
    require(credential.startsWith(output.getParent), "credential must belong to the owned run")
    val password = new String(Files.readAllBytes(credential), StandardCharsets.UTF_8).trim
    require(password.nonEmpty)
    val scenarios = Vector("mysql-duplicate-zero-effect", "mysql-conflict-and-identity-rejected", "mysql-gap-holds-watermark",
      "mysql-early-occurrence-retryable-join", "mysql-index-failure-rolls-back")
    val outcomes = scenarios.map { scenario =>
      val directory = Files.createDirectory(output.resolve(scenario))
      val schema = "bank_neg_" + UUID.randomUUID().toString.replace("-", "")
      save(directory, "input", Json.obj("scenario" -> scenario, "schema" -> schema, "endpoint" -> url))
      try {
        runScenario(url, password, schema, scenario, directory)
        Json.obj("scenario" -> scenario, "status" -> "passed", "schema" -> schema)
      } catch {
        case scala.util.control.NonFatal(error) =>
          val value = Json.obj("scenario" -> scenario, "status" -> "failed", "schema" -> schema,
            "errorClass" -> error.getClass.getName, "frames" -> error.getStackTrace.take(8).map(_.toString).toVector)
          save(directory, "failure", value)
          value
      }
    }
    save(output, "result", Json.obj("scenarios" -> outcomes, "schemasRetained" -> true, "releaseAccepted" -> false))
    require(outcomes.forall(v => (v \ "status").as[String] == "passed"), "MySQL acceptance failed; see owned evidence")
  }

  private def runScenario(url: String, password: String, schema: String, scenario: String, output: Path): Unit = {
    val user = "root"
    Class.forName("com.mysql.cj.jdbc.Driver")
    val setup = DriverManager.getConnection(url, user, password)
    try { val s = setup.createStatement(); try s.execute("CREATE DATABASE " + schema) finally s.close() }
    finally setup.close()
    val mysql = new SimpleMysqlDataSource(url + "/" + schema + "?useSSL=false&allowPublicKeyRetrieval=true", user, password)
    val dataSource = new FaultableDataSource(mysql)

    // defaultReference, not load(): the app's service.conf requires ${PLAY_SECRET} and this
    // harness must not read the production service configuration.
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.defaultReference()))
    try {
      implicit val system: ActorSystem[_] = kit.system
      implicit val ec: ExecutionContext = system.executionContext
      val investor = AccountId("alice-account"); val otherInvestor = AccountId("bob-account")
      val collection = AccountId("fund-collection"); val operatorAccount = AccountId("operator-account")
      val config = BankDemoConfiguration("mysql-negative-v1", "http://127.0.0.1:18081", Vector(
        BankDemoPrincipal("alice", investor, Set("customer"), "alice-token", "alice-csrf"),
        BankDemoPrincipal("bob", otherInvestor, Set("customer"), "bob-token", "bob-csrf"),
        BankDemoPrincipal("operator", operatorAccount, Set("operator"), "operator-token", "operator-csrf")),
        Vector(BankFund("fund", collection)), Vector(investor, otherInvestor, collection, operatorAccount)
          .map(id => BankSeed(id, "CNY", Money(BigDecimal("1000.00"), "CNY"))))
      val alice = Principal("alice", Set("customer"))
      val journal = new Journal("neg" + UUID.randomUUID().toString.replace("-", ""))
      val ids = new BankPersistenceIds(journal.namespace)
      val storage = PersistenceTestKit(system)

      def await[A](v: Future[A]): A = Await.result(v, 20.seconds)
      def sql[A](text: String, parameters: String*)(read: java.sql.ResultSet => A): Vector[A] = {
        val c = dataSource.getConnection
        try {
          val s = c.prepareStatement(text)
          try {
            (journal.namespace +: parameters).zipWithIndex.foreach { case (v, i) => s.setString(i + 1, v) }
            val r = s.executeQuery()
            try { val b = Vector.newBuilder[A]; while (r.next()) b += read(r); b.result() } finally r.close()
          } finally s.close()
        } finally c.close()
      }
      def count(table: String): Long =
        sql("SELECT COUNT(*) FROM " + table + " WHERE namespace=?")(_.getLong(1)).head
      def checkpoint(pid: String): Option[Long] =
        sql("SELECT last_sequence FROM bank_read_stream WHERE namespace=? AND persistence_id=?", pid)(_.getLong(1)).headOption

      val journalEvidence = mutable.LinkedHashMap.empty[String, Vector[BankJournalEnvelope]]
      def capture(pid: String): Vector[BankJournalEnvelope] = {
        val values = storage.persistedInStorage(pid).toVector
        require(values.nonEmpty && values.forall(_.isInstanceOf[GeneratedMessage]), "generated PB events required")
        val events = values.zipWithIndex.map { case (e, i) => BankJournalEnvelope(pid, i.toLong + 1L, e) }
        journalEvidence.put(pid, events)
        events
      }
      def accountEvents(account: AccountId, balance: String = "1000.00", reserve: Boolean = false): Vector[BankJournalEnvelope] = {
        val pid = ids.account(account)
        val actor = kit.spawn(CreditBalanceAggregate(pid, CreditBalanceState.empty.copy(id = account), BankBalanceComputations))
        val replies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
        def send(c: CreditBalanceProtocol.Command): Unit = {
          actor ! CreditBalanceAggregate.Execute(c, replies.ref)
          require(replies.receiveMessage().isInstanceOf[CreditBalanceAggregate.Accepted])
        }
        send(CreditBalanceProtocol.InitializeAccount(account, "CNY", Money(BigDecimal(balance), "CNY")))
        if (reserve) send(CreditBalanceProtocol.ReserveFunds(TxId("reserved"), account, Money(BigDecimal("100.00"), "CNY")))
        capture(pid)
      }
      def cashOriginal(key: String, owner: String = "alice"): BankCashOriginal = {
        val account = if (owner == "alice") investor else otherInvestor
        BankCashOriginal(owner, key, config.version, BankCashSubmit(key, "fund", MoneyWire("10000", "CNY")),
          BankPaymentOriginal(BankRequestIdentity.operation(owner, key), BankRequestIdentity.order(owner, key),
            account, collection, "fund", Money(BigDecimal("100.00"), "CNY")))
      }
      def orderEvents(payment: BankPaymentOriginal, source: Option[BankCashOriginal]): Vector[BankJournalEnvelope] = {
        val pid = ids.order(payment.fundOrderId)
        val actor = kit.spawn(FundOrderAggregate(pid, FundOrderState.empty.copy(id = payment.fundOrderId), StableOrderIdentity,
          new FundOrderAggregate.ExternalAuthority {
            def authorize(p: String, a: String, i: Vector[String]): Boolean = false
          }))
        val replies = kit.createTestProbe[FundOrderAggregate.Reply]()
        def send(c: FundOrderProtocol.Command): Unit = {
          actor ! FundOrderAggregate.Execute(c, replies.ref)
          require(replies.receiveMessage().isInstanceOf[FundOrderAggregate.Accepted])
        }
        source.foreach(v => send(FundOrderProtocol.RecordCashRequestSource(v, Some(v))))
        send(FundOrderProtocol.RequestFundPurchaseSettlement(payment.operationId, payment.fundOrderId,
          payment.investorAccountId, payment.fundCollectionAccountId, payment.fundCode, payment.amount))
        capture(pid)
      }
      def planEvents(key: String): (Vector[BankJournalEnvelope], SipOccurrence) = {
        val intent = BankSipCreateIntent("alice", key, config.version,
          BankSipCreate(key, "fund", MoneyWire("10000", "CNY"), 0L, Vector(10L, 20L)), BankRequestIdentity.plan("alice", key),
          SipRevisionConfig(RevisionId("initial"), 0L, investor, collection, "fund", Money(BigDecimal("100.00"), "CNY")))
        val pid = ids.plan(intent.planId)
        val actor = kit.spawn(SipPlanAggregate(pid, SipPlanState.empty.copy(id = intent.planId), StableSipIdentity))
        val replies = kit.createTestProbe[SipPlanAggregate.Reply]()
        def send(c: SipPlanProtocol.Command): Unit = {
          actor ! SipPlanAggregate.Execute(c, replies.ref)
          require(replies.receiveMessage().isInstanceOf[SipPlanAggregate.Accepted])
        }
        send(SipPlanProtocol.RecordSipCreateIntent(intent, Some(intent)))
        send(SipPlanProtocol.CreateSipPlan(intent.planId, intent.config))
        send(SipPlanProtocol.AppendSipDueSlot(0L, 10L))
        send(SipPlanProtocol.AppendSipDueSlot(1L, 20L))
        send(SipPlanProtocol.SealSipSchedule())
        send(SipPlanProtocol.AdvanceSipClock(10L))
        send(SipPlanProtocol.ObserveSipDueSlot(0L, 10L))
        send(SipPlanProtocol.TriggerSipInstallment(0L, 10L, intent.config.revision, intent.config))
        val states = kit.createTestProbe[SipPlanState]()
        actor ! SipPlanAggregate.GetState(states.ref)
        capture(pid) -> states.receiveMessage().occurrences(10L)
      }

      val readside = new BankReadside(journal, config, dataSource)
      val tables = Vector(
        ("bank_read_namespace", Vector("namespace", "schema_version"), "namespace"),
        ("bank_read_stream", Vector("namespace", "pid_key", "persistence_id", "kind", "resource_id", "owner_account", "owner_principal", "last_sequence", "observed_sequence", "state_payload"), "namespace,pid_key"),
        ("bank_read_event", Vector("namespace", "pid_key", "sequence_nr", "payload_type", "payload_manifest", "payload"), "namespace,pid_key,sequence_nr"),
        ("bank_read_occurrence", Vector("namespace", "plan_key", "due_slot", "occurrence_key", "order_key", "owner_account", "occurrence_payload"), "namespace,plan_key,due_slot"),
        ("bank_read_pending", Vector("namespace", "operation_key", "flow", "operation_id", "order_id", "plan_id", "occurrence_id", "source_pid", "phase", "status", "recoverable"), "namespace,operation_key,flow"))
      def snapshot(name: String): JsObject = {
        val c = dataSource.getConnection
        c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
        c.setAutoCommit(false)
        val result = try JsObject(tables.map { case (table, columns, keys) =>
          val s = c.prepareStatement("SELECT " + columns.mkString(",") + " FROM " + table + " WHERE namespace=? ORDER BY " + keys)
          try {
            s.setString(1, journal.namespace)
            val r = s.executeQuery()
            try {
              val meta = r.getMetaData
              val rows = Vector.newBuilder[JsObject]
              while (r.next()) rows += JsObject((1 to meta.getColumnCount).map { i =>
                val value: JsValue = if (r.getObject(i) == null) JsNull else meta.getColumnType(i) match {
                  case Types.BINARY | Types.VARBINARY | Types.LONGVARBINARY | Types.BLOB => Json.obj("base64" -> Base64.getEncoder.encodeToString(r.getBytes(i)))
                  case _ => JsString(r.getString(i))
                }
                meta.getColumnLabel(i) -> value
              })
              table -> JsArray(rows.result())
            } finally r.close()
          } finally s.close()
        }) finally { try c.rollback() finally c.close() }
        save(output, name, result)
        result
      }
      def replay(events: Vector[BankJournalEnvelope]): Unit = {
        journal.put(events)
        await(readside.catchUp(events.head.persistenceId))
      }
      def exactEvents(events: Vector[BankJournalEnvelope]): Unit = {
        val bytes = sql("SELECT payload FROM bank_read_event WHERE namespace=? ORDER BY sequence_nr")(_.getBytes(1).toVector)
        assert(bytes == events.map(_.event.asInstanceOf[GeneratedMessage].toByteArray.toVector))
      }
      try {
        await(readside.initialize())
        snapshot("initial")
        scenario match {
          case "mysql-duplicate-zero-effect" =>
            val events = accountEvents(investor, reserve = true)
            replay(events)
            val before = snapshot("before")
            events.foreach(e => await(readside.project(e)))
            assert(snapshot("after") == before)
            exactEvents(events)
            assert(checkpoint(events.head.persistenceId).contains(2L))
            val BankAccountResponse(_, value) = await(readside.accountMe(alice, BankAccountKey(BankReadsideSchema.version))).fold(e => sys.error(e.code), identity)
            assert(value.contains(BankAccountView(investor, true, MoneyWire("90000", "CNY"), MoneyWire("10000", "CNY"))))
          case "mysql-conflict-and-identity-rejected" =>
            val events = accountEvents(investor, reserve = true)
            val other = accountEvents(otherInvestor).head
            await(readside.project(events.head))
            val before = snapshot("before")
            val conflict = intercept[IllegalArgumentException](await(readside.project(events.head.copy(event = other.event))))
            assert(conflict.getMessage.contains("conflicting journal sequence/payload"))
            assert(snapshot("after-conflict") == before)
            val mismatch = intercept[IllegalArgumentException](await(readside.project(BankJournalEnvelope(events.head.persistenceId, 2L, other.event))))
            assert(mismatch.getMessage.contains("account event identity mismatch"))
            assert(snapshot("after-identity") == before)
            await(readside.project(events(1)))
            assert(checkpoint(events.head.persistenceId).contains(2L))
            exactEvents(events)
          case "mysql-gap-holds-watermark" =>
            val events = accountEvents(investor, reserve = true)
            val before = snapshot("before")
            val gap = intercept[IllegalArgumentException](await(readside.project(events(1))))
            assert(gap.getMessage.contains("noncontiguous journal sequence"))
            assert(snapshot("after-gap") == before)
            assert(checkpoint(events.head.persistenceId).isEmpty)
            replay(events)
            exactEvents(events)
            assert(checkpoint(events.head.persistenceId).contains(2L))
          case "mysql-early-occurrence-retryable-join" =>
            val (events, occurrence) = planEvents("late-order")
            replay(events)
            val key = BankOccurrencePageKey(occurrence.planId, 50L, 0L)
            val BankSipOccurrencePage(beforeMeta, beforeRows, _) = await(readside.occurrences(alice, key)).fold(e => sys.error(e.code), identity)
            val BankReadMetadata(_, beforeStatus, _) = beforeMeta
            assert(beforeStatus == "unknown" && beforeRows.size == 1)
            val BankSipOccurrenceView(beforeOccurrence, slot, progress, paymentBefore, taBefore, refundBefore, terminalBefore) = beforeRows.head
            assert(beforeOccurrence == occurrence && paymentBefore == "unknown" && taBefore == "unknown" && refundBefore == "unknown" && terminalBefore.isEmpty)
            snapshot("before-order")
            val payment = BankPaymentOriginal(occurrence.operationId, occurrence.fundOrderId, occurrence.config.investorAccountId,
              occurrence.config.fundCollectionAccountId, occurrence.config.fundCode, occurrence.config.amount)
            replay(orderEvents(payment, None))
            val BankSipOccurrencePage(afterMeta, afterRows, _) = await(readside.occurrences(alice, key)).fold(e => sys.error(e.code), identity)
            val BankReadMetadata(_, afterStatus, marks) = afterMeta
            assert(afterStatus == "caught-up")
            assert(marks == journalEvidence.toVector.map { case (pid, persisted) =>
              BankProjectionWatermark(pid, persisted.last.sequenceNr, Some(persisted.last.sequenceNr), "caught-up")
            }.sortBy(_.persistenceId))
            assert(afterRows.size == 1)
            val BankSipOccurrenceView(afterOccurrence, afterSlot, afterProgress, paymentAfter, taAfter, refundAfter, terminalAfter) = afterRows.head
            assert(afterOccurrence == occurrence && afterSlot == slot && afterProgress == progress)
            assert(paymentAfter == "payment-requested" && taAfter == "not-submitted" && refundAfter == "not-required" && terminalAfter.isEmpty)
            assert(count("bank_read_occurrence") == 1)
            val after = snapshot("after-order")
            journalEvidence.values.foreach(_.foreach(e => await(readside.project(e))))
            assert(snapshot("after-duplicates") == after)
          case "mysql-index-failure-rolls-back" =>
            val source = cashOriginal("atomic")
            val event = orderEvents(source.payment, Some(source)).head
            val before = snapshot("before")
            dataSource.failOnSql = Some("INSERT INTO bank_read_pending")
            val failure = intercept[SQLException](await(readside.project(event)))
            assert(failure.getMessage == "injected projection-index write failure")
            assert(dataSource.failOnSql.isEmpty && dataSource.hits.get == 1)
            assert(snapshot("after-failure") == before)
            assert(checkpoint(event.persistenceId).isEmpty)
            await(readside.project(event))
            assert(checkpoint(event.persistenceId).contains(1L) && count("bank_read_pending") == 1)
            exactEvents(Vector(event))
            val BankCashRequestResponse(_, value) = await(readside.cashOriginal(alice, BankCashRequestKey(source.clientRequestId))).fold(e => sys.error(e.code), identity)
            assert(value.exists { case BankCashRequestView(original, _, _, _) => original == source })
          case _ => throw new IllegalArgumentException("unknown scenario")
        }
        snapshot("final")
      } finally {
        try save(output, "journal", JsObject(journalEvidence.toVector.map { case (pid, events) => pid -> JsArray(events.map { e =>
          val pb = e.event.asInstanceOf[GeneratedMessage]
          Json.obj("sequence" -> e.sequenceNr, "type" -> pb.getClass.getName, "base64" -> Base64.getEncoder.encodeToString(pb.toByteArray))
        }) })) finally {
          readside.close()
          journal.close()
        }
      }
    } finally {
      kit.shutdownTestKit()
      save(output, "closed", Json.obj("actorSystemTerminated" -> true, "schemaRetained" -> schema))
    }
  }
}
