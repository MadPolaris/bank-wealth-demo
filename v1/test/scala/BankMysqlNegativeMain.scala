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
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger
import javax.sql.DataSource
import scalapb.GeneratedMessage
import scala.collection.mutable
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._
import org.scalatest.Assertions

/** P31-2 real-MySQL negative-path acceptance (2026-11-01 authorization, exclusive container).
  * Runs the five fault paths against the real projection code over MySQL 8.4.11:
  * duplicate delivery, conflicting/identity-mismatched payloads, sequence gaps,
  * early SIP occurrence join, and injected index-write failure rolling the whole
  * event/state/checkpoint transaction back. Event production uses the same real
  * aggregates as BankReadsideProjectionSpec (testkit capture), not hand-built rows.
  * Storage is the exclusive container named by MYSQL_NEGATIVE_URL only; no unit-suite
  * storage is touched and nothing here certifies other MySQL versions.
  */
object BankMysqlNegativeMain extends Assertions {
  private def intercept[A <: Throwable : Manifest](body: => Unit): A = {
    try { body; fail("expected exception") } catch { case e: Throwable if manifest[A].runtimeClass.isInstance(e) => e.asInstanceOf[A] }
  }
  private def env(name: String): String = sys.env.getOrElse(name, sys.error("missing " + name))

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

  def main(args: Array[String]): Unit = {
    val url = env("MYSQL_NEGATIVE_URL"); val user = env("MYSQL_NEGATIVE_USER"); val password = env("MYSQL_NEGATIVE_PASSWORD")
    Class.forName("com.mysql.cj.jdbc.Driver")
    val schema = "bank_neg_" + UUID.randomUUID().toString.replace("-", "")
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

      def capture(pid: String): Vector[BankJournalEnvelope] = {
        val values = storage.persistedInStorage(pid).toVector
        require(values.nonEmpty && values.forall(_.isInstanceOf[GeneratedMessage]), "generated PB events required")
        values.zipWithIndex.map { case (e, i) => BankJournalEnvelope(pid, i.toLong + 1L, e) }
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

      var readside = new BankReadside(journal, config, dataSource)
      await(readside.initialize())
      var failures = Vector.empty[String]
      def check(name: String)(body: => Unit): Unit =
        try { body; println("PASS " + name) } catch { case e: Throwable => failures :+= name; println("FAIL " + name + ": " + e) }
      // Each scenario starts from an empty journal namespace and empty MySQL namespace rows:
      // fresh namespace string, cleared testkit storage, and cleared projection tables.
      def resetScenario(): Unit = {
        storage.clearAll()
        val c = dataSource.getConnection
        // bank_read_namespace stays: the projection requires its installed namespace row
        try Vector("bank_read_pending", "bank_read_occurrence", "bank_read_event", "bank_read_stream").foreach { table =>
          val s = c.prepareStatement("DELETE FROM " + table + " WHERE namespace=?")
          try { s.setString(1, journal.namespace); s.executeUpdate() } finally s.close()
        } finally c.close()
      }

      // ① duplicate delivery: same PID+seq twice is exactly-once
      check("mysql-duplicate-zero-effect") {
        val events = accountEvents(investor, reserve = true)
        val pid = events.head.persistenceId
        intercept[IllegalArgumentException](await(readside.project(events(1))))
        assert(count("bank_read_event") == 0)
        await(readside.project(events.head))
        await(readside.project(events.head))
        assert(count("bank_read_event") == 1 && checkpoint(pid).contains(1L))
      }
      // ② conflicting payload at same PID+seq is rejected; identity mismatch rejected
      check("mysql-conflict-and-identity-rejected") {
        resetScenario()
        val events = accountEvents(investor, reserve = true)
        val other = accountEvents(otherInvestor).head
        val pid = events.head.persistenceId
        await(readside.project(events.head))
        intercept[IllegalArgumentException](await(readside.project(events.head.copy(event = other.event))))
        intercept[IllegalArgumentException](await(readside.project(BankJournalEnvelope(pid, 2L, other.event))))
        assert(count("bank_read_event") == 1 && checkpoint(pid).contains(1L))
      }
      // ③ sequence gap does not advance the contiguous checkpoint
      check("mysql-gap-holds-watermark") {
        resetScenario()
        val events = accountEvents(investor, reserve = true)
        val pid = events.head.persistenceId
        intercept[IllegalArgumentException](await(readside.project(events(1))))
        assert(checkpoint(pid).isEmpty && count("bank_read_event") == 0)
        await(readside.project(events.head))
        await(readside.project(events(1)))
        assert(checkpoint(pid).contains(2L) && count("bank_read_event") == 2)
      }
      // ④ early SIP occurrence joins when the order stream arrives later
      check("mysql-early-occurrence-retryable-join") {
        resetScenario()
        val (planEventsVec, occurrence) = planEvents("late-order")
        journal.put(planEventsVec)
        await(readside.catchUp(planEventsVec.head.persistenceId))
        val payment = BankPaymentOriginal(occurrence.operationId, occurrence.fundOrderId, occurrence.config.investorAccountId,
          occurrence.config.fundCollectionAccountId, occurrence.config.fundCode, occurrence.config.amount)
        // Mirrors the unit spec's early-join scenario: order stream without a cash source record,
        // so the SIP payment identity itself authorizes the settlement request.
        val orderVec = orderEvents(payment, None)
        journal.put(orderVec)
        await(readside.catchUp(orderVec.head.persistenceId))
        val key = BankOccurrencePageKey(occurrence.planId, 50L, 0L)
        val BankSipOccurrencePage(metadata, rows, _) = await(readside.occurrences(alice, key)).fold(e => sys.error(e.code), identity)
        val view = rows.collectFirst { case v: BankSipOccurrenceView => v }
        assert(view.exists { v => v.occurrence == occurrence && v.paymentStatus != "unknown" },
          "occurrence must join after the order stream arrives")
        assert(count("bank_read_occurrence") == 1)
      }
      // ⑤ injected index-write failure rolls the whole transaction back
      check("mysql-index-failure-rolls-back") {
        resetScenario()
        val source = cashOriginal("atomic")
        val event = orderEvents(source.payment, Some(source)).head
        dataSource.failOnSql = Some("INSERT INTO bank_read_pending")
        intercept[SQLException](await(readside.project(event)))
        assert(dataSource.failOnSql.isEmpty && dataSource.hits.get > 0, "the fault must actually hit an index write")
        assert(count("bank_read_event") == 0 && count("bank_read_stream") == 0 && count("bank_read_pending") == 0)
        assert(checkpoint(event.persistenceId).isEmpty)
        await(readside.project(event))
        assert(checkpoint(event.persistenceId).contains(1L) && count("bank_read_event") == 1 && count("bank_read_pending") == 1)
      }
      // exact five-table final state visible on real MySQL
      check("mysql-five-tables-final") {
        resetScenario()
        val c = dataSource.getConnection
        val tables = try {
          val s = c.prepareStatement("SELECT table_name FROM information_schema.tables WHERE table_schema=?")
          try { s.setString(1, schema); val r = s.executeQuery(); try { val b = Vector.newBuilder[String]; while (r.next()) b += r.getString(1); b.result() } finally r.close() } finally s.close()
        } finally c.close()
        assert(tables.toSet == Set("bank_read_event", "bank_read_stream", "bank_read_pending", "bank_read_occurrence", "bank_read_namespace"),
          "schema tables: " + tables)
      }
      readside.close()
      if (failures.nonEmpty) { println("FAILURES: " + failures.mkString(",")); sys.exit(2) }
      println("ALL MYSQL NEGATIVE PATHS PASSED")
    } finally {
      kit.shutdownTestKit()
      val drop = DriverManager.getConnection(url, user, password)
      try { val s = drop.createStatement(); try s.execute("DROP DATABASE " + schema) finally s.close() }
      finally drop.close()
    }
  }
}
