package example.bankwealth.service

import akka.NotUsed
import akka.actor.typed.ActorSystem
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.stream.{Materializer, SystemMaterializer}
import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.{BankBalanceComputations, StableOrderIdentity, StableSipIdentity}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.integration._
import example.bankwealth.readside.{BankReadside, BankReadsideSchema}
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import java.io.PrintWriter
import java.lang.reflect.{InvocationHandler, InvocationTargetException, Method, Proxy}
import java.sql.{Connection, SQLException}
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger
import javax.sql.DataSource
import org.h2.jdbcx.JdbcDataSource
import org.scalatest.funsuite.AnyFunSuite
import play.api.http.FileMimeTypes
import play.api.i18n.{Langs, MessagesApi}
import play.api.libs.json._
import play.api.libs.streams.Accumulator
import play.api.libs.typedmap.TypedMap
import play.api.mvc._
import play.api.mvc.request.{RemoteConnection, RequestTarget}
import scalapb.GeneratedMessage
import scala.collection.mutable
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._

/** Shared fixtures for the three Owner A suites, housed in an already-owned test file.
  * All persistence is local testkit; H2 is a uniquely named, embedded in-memory database.
  * No start(), remoting, HTTP listener, worker, subprocess, or external database is used.
  */
private[bankwealth] object BankOwnerATestSupport {
  def await[A](value: Future[A]): A = Await.result(value, 8.seconds)
  def success[A](value: Outcome[A]): A = value match {
    case Right(result) => result
    case Left(error) => throw new AssertionError("unexpected outcome: " + error.code)
  }
  def disposition(value: BankReadMetadata): String = value match { case BankReadMetadata(_, state, _) => state }
  def watermarks(value: BankReadMetadata): Vector[BankProjectionWatermark] = value match { case BankReadMetadata(_, _, marks) => marks }

  final class Journal(val namespace: String) extends BankJournal {
    private val stored = mutable.Map.empty[String, Vector[BankJournalEnvelope]]
    val reads = new AtomicInteger
    var closed = false
    def put(events: Vector[BankJournalEnvelope]): Unit = events.headOption.foreach { first =>
      require(events.forall(_.persistenceId == first.persistenceId))
      stored.put(first.persistenceId, events)
    }
    def persistenceIds(): Source[String, NotUsed] = Source(stored.keys.toVector)
    def currentEvents(pid: String, after: Long): Future[Vector[BankJournalEnvelope]] = {
      reads.incrementAndGet()
      Future.successful(stored.getOrElse(pid, Vector.empty).filter(_.sequenceNr > after))
    }
    def events(pid: String, after: Long): Source[BankJournalEnvelope, NotUsed] =
      Source(stored.getOrElse(pid, Vector.empty).filter(_.sequenceNr > after))
    def close(): Unit = { closed = true }
  }

  final class ObservedDataSource(delegate: DataSource) extends DataSource {
    val connections = new AtomicInteger
    @volatile var failOnSql: Option[String] = None
    private def observe(connection: Connection): Connection = {
      connections.incrementAndGet()
      Proxy.newProxyInstance(classOf[Connection].getClassLoader, Array[Class[_]](classOf[Connection]), new InvocationHandler {
        def invoke(proxy: Any, method: Method, args: Array[AnyRef]): AnyRef = {
          val values = Option(args).getOrElse(Array.empty[AnyRef])
          if (method.getName == "prepareStatement" && values.headOption.exists {
              case sql: String => failOnSql.exists(sql.startsWith)
              case _ => false
            }) {
            failOnSql = None
            throw new SQLException("injected projection-index write failure")
          }
          try method.invoke(connection, values: _*)
          catch { case error: InvocationTargetException => throw error.getCause }
        }
      }).asInstanceOf[Connection]
    }
    def getConnection: Connection = observe(delegate.getConnection)
    def getConnection(username: String, password: String): Connection = observe(delegate.getConnection(username, password))
    def getLogWriter: PrintWriter = delegate.getLogWriter
    def setLogWriter(writer: PrintWriter): Unit = delegate.setLogWriter(writer)
    def getLoginTimeout: Int = delegate.getLoginTimeout
    def setLoginTimeout(seconds: Int): Unit = delegate.setLoginTimeout(seconds)
    def getParentLogger: Logger = delegate.getParentLogger
    def unwrap[T](kind: Class[T]): T = delegate.unwrap(kind)
    def isWrapperFor(kind: Class[_]): Boolean = delegate.isWrapperFor(kind)
  }

  final class Fixture {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: ExecutionContext = system.executionContext
    implicit val materializer: Materializer = SystemMaterializer(system).materializer
    val investor = AccountId("alice-account")
    val otherInvestor = AccountId("bob-account")
    val collection = AccountId("fund-collection")
    val operatorAccount = AccountId("operator-account")
    val config = BankDemoConfiguration("owner-a-config-v1", "http://127.0.0.1:18081", Vector(
      BankDemoPrincipal("alice", investor, Set("customer"), "alice-token", "alice-csrf"),
      BankDemoPrincipal("bob", otherInvestor, Set("customer"), "bob-token", "bob-csrf"),
      BankDemoPrincipal("operator", operatorAccount, Set("operator"), "operator-token", "operator-csrf")),
      Vector(BankFund("fund", collection)), Vector(investor, otherInvestor, collection, operatorAccount)
        .map(id => BankSeed(id, "CNY", Money(BigDecimal("1000.00"), "CNY"))))
    val alice = Principal("alice", Set("customer"))
    val bob = Principal("bob", Set("customer"))
    val operator = Principal("operator", Set("operator"))
    val authority = new BankDemoAuthority(config)
    val journal = new Journal("ownera" + UUID.randomUUID().toString.replace("-", ""))
    val ids = new BankPersistenceIds(journal.namespace)
    private val h2 = new JdbcDataSource
    h2.setURL("jdbc:h2:mem:bank_a_" + UUID.randomUUID().toString.replace("-", "") +
      ";MODE=MySQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE")
    h2.setUser("sa")
    h2.setPassword("")
    val dataSource = new ObservedDataSource(h2)
    var readside = new BankReadside(journal, config, dataSource)
    private val storage = PersistenceTestKit(system)

    def initialize(): Unit = await(readside.initialize())
    private def capture(pid: String): Vector[BankJournalEnvelope] = {
      val values = storage.persistedInStorage(pid).toVector
      require(values.nonEmpty && values.forall(_.isInstanceOf[GeneratedMessage]), "generated PB events required")
      values.zipWithIndex.map { case (event, index) => BankJournalEnvelope(pid, index.toLong + 1L, event) }
    }
    def accountEvents(account: AccountId, balance: String = "1000.00", reserve: Boolean = false,
        persistenceId: Option[String] = None): Vector[BankJournalEnvelope] = {
      val pid = persistenceId.getOrElse(ids.account(account))
      val actor = kit.spawn(CreditBalanceAggregate(pid, CreditBalanceState.empty.copy(id = account), BankBalanceComputations))
      val replies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
      def send(command: CreditBalanceProtocol.Command): Unit = {
        actor ! CreditBalanceAggregate.Execute(command, replies.ref)
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
    def orderEvents(payment: BankPaymentOriginal, source: Option[BankCashOriginal] = None,
        requestPayment: Boolean = true): Vector[BankJournalEnvelope] = {
      val pid = ids.order(payment.fundOrderId)
      val actor = kit.spawn(FundOrderAggregate(pid, FundOrderState.empty.copy(id = payment.fundOrderId), StableOrderIdentity,
        new FundOrderAggregate.ExternalAuthority {
          def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false
        }))
      val replies = kit.createTestProbe[FundOrderAggregate.Reply]()
      def send(command: FundOrderProtocol.Command): Unit = {
        actor ! FundOrderAggregate.Execute(command, replies.ref)
        require(replies.receiveMessage().isInstanceOf[FundOrderAggregate.Accepted])
      }
      source.foreach(value => send(FundOrderProtocol.RecordCashRequestSource(value, Some(value))))
      if (requestPayment) send(FundOrderProtocol.RequestFundPurchaseSettlement(payment.operationId, payment.fundOrderId,
        payment.investorAccountId, payment.fundCollectionAccountId, payment.fundCode, payment.amount))
      capture(pid)
    }
    def planEvents(key: String, owner: String = "alice", trigger: Boolean = false): (Vector[BankJournalEnvelope], Option[SipOccurrence]) = {
      val account = if (owner == "alice") investor else otherInvestor
      val intent = BankSipCreateIntent(owner, key, config.version,
        BankSipCreate(key, "fund", MoneyWire("10000", "CNY"), 0L, Vector(10L, 20L)), BankRequestIdentity.plan(owner, key),
        SipRevisionConfig(RevisionId("initial"), 0L, account, collection, "fund", Money(BigDecimal("100.00"), "CNY")))
      val pid = ids.plan(intent.planId)
      val actor = kit.spawn(SipPlanAggregate(pid, SipPlanState.empty.copy(id = intent.planId), StableSipIdentity))
      val replies = kit.createTestProbe[SipPlanAggregate.Reply]()
      def send(command: SipPlanProtocol.Command): Unit = {
        actor ! SipPlanAggregate.Execute(command, replies.ref)
        require(replies.receiveMessage().isInstanceOf[SipPlanAggregate.Accepted])
      }
      send(SipPlanProtocol.RecordSipCreateIntent(intent, Some(intent)))
      send(SipPlanProtocol.CreateSipPlan(intent.planId, intent.config))
      send(SipPlanProtocol.AppendSipDueSlot(0L, 10L))
      send(SipPlanProtocol.AppendSipDueSlot(1L, 20L))
      send(SipPlanProtocol.SealSipSchedule())
      val occurrence = if (trigger) {
        send(SipPlanProtocol.AdvanceSipClock(10L))
        send(SipPlanProtocol.ObserveSipDueSlot(0L, 10L))
        send(SipPlanProtocol.TriggerSipInstallment(0L, 10L, intent.config.revision, intent.config))
        val states = kit.createTestProbe[SipPlanState]()
        actor ! SipPlanAggregate.GetState(states.ref)
        Some(states.receiveMessage().occurrences(10L))
      } else None
      capture(pid) -> occurrence
    }
    def catchUp(events: Vector[BankJournalEnvelope]): Unit = {
      journal.put(events)
      await(readside.catchUp(events.head.persistenceId))
    }
    def count(table: String): Long = {
      require(Set("bank_read_event", "bank_read_stream", "bank_read_pending", "bank_read_occurrence")(table))
      sql("SELECT COUNT(*) FROM " + table + " WHERE namespace=?")(_.getLong(1)).head
    }
    def checkpoint(pid: String): Option[Long] = sql("SELECT last_sequence FROM bank_read_stream WHERE namespace=? AND persistence_id=?", pid)(_.getLong(1)).headOption
    def sql[A](text: String, parameters: String*)(read: java.sql.ResultSet => A): Vector[A] = {
      val connection = dataSource.getConnection
      try {
        val statement = connection.prepareStatement(text)
        try {
          (journal.namespace +: parameters).zipWithIndex.foreach { case (value, index) => statement.setString(index + 1, value) }
          val result = statement.executeQuery()
          try { val values = Vector.newBuilder[A]; while (result.next()) values += read(result); values.result() }
          finally result.close()
        } finally statement.close()
      } finally connection.close()
    }
    def reopen(clearDerived: Boolean = false): Unit = {
      readside.close()
      if (clearDerived) {
        val connection = dataSource.getConnection
        try Vector("bank_read_pending", "bank_read_occurrence", "bank_read_event", "bank_read_stream").foreach { table =>
          val statement = connection.prepareStatement("DELETE FROM " + table + " WHERE namespace=?")
          try { statement.setString(1, journal.namespace); statement.executeUpdate() } finally statement.close()
        } finally connection.close()
      }
      readside = new BankReadside(journal, config, dataSource)
      initialize()
    }
    def close(): Unit = {
      try { readside.close(); journal.close() }
      finally {
        try {
          val connection = h2.getConnection
          try { val statement = connection.createStatement(); try statement.execute("SHUTDOWN") finally statement.close() }
          finally connection.close()
        } finally kit.shutdownTestKit()
      }
    }
  }

  def withFixture[A](run: Fixture => A): A = {
    val fixture = new Fixture
    try { fixture.initialize(); run(fixture) } finally fixture.close()
  }

  // Invoke Actions with already-parsed Play requests. These core Play fixtures need no
  // play-test dependency and intentionally do not claim to test the HTTP/body-parser stack.
  def request(method: String = "GET", path: String = "/bank/accounts/me",
      query: Map[String, Seq[String]] = Map.empty, headers: Seq[(String, String)] = Vector.empty,
      body: AnyContent = AnyContentAsEmpty): Request[AnyContent] = {
    val requestHeaders = Headers(headers: _*)
    val requestTarget = RequestTarget(path, path, query)
    val requestMethod = method
    val header = new RequestHeader {
      val connection: RemoteConnection = RemoteConnection("127.0.0.1", false, None)
      val method: String = requestMethod
      val target: RequestTarget = requestTarget
      val version: String = "HTTP/1.1"
      val headers: Headers = requestHeaders
      val attrs: TypedMap = TypedMap.empty
    }
    Request(header, body)
  }

  def components(implicit ec: ExecutionContext): ControllerComponents = new ControllerComponents {
    private val bodyParser = new BodyParser[AnyContent] {
      def apply(header: RequestHeader): Accumulator[ByteString, Either[Result, AnyContent]] = Accumulator.done(Right(AnyContentAsEmpty))
    }
    val actionBuilder: ActionBuilder[Request, AnyContent] = new ActionBuilder[Request, AnyContent] {
      def parser: BodyParser[AnyContent] = bodyParser
      protected def executionContext: ExecutionContext = ec
      def invokeBlock[A](request: Request[A], block: Request[A] => Future[Result]): Future[Result] = block(request)
    }
    def parsers: PlayBodyParsers = throw new UnsupportedOperationException("body parsing is outside these action unit tests")
    def messagesApi: MessagesApi = throw new UnsupportedOperationException("no messages used")
    def langs: Langs = throw new UnsupportedOperationException("no language negotiation used")
    def fileMimeTypes: FileMimeTypes = throw new UnsupportedOperationException("no assets used")
    implicit val executionContext: ExecutionContext = ec
  }

  final class Queries extends BankReadQueries {
    val calls = mutable.ArrayBuffer.empty[(String, Principal, Any)]
    private val metadata = BankReadMetadata(BankReadsideSchema.version, "unknown", Vector.empty)
    var accountResponse = BankAccountResponse(metadata, None)
    var cashResponse = BankCashRequestResponse(metadata, None)
    var orderResponse = BankOrderResponse(metadata, None)
    var planPage = BankSipPlanPage(metadata, Vector.empty, None)
    var planResponse = BankSipPlanResponse(metadata, None)
    var occurrencePage = BankSipOccurrencePage(metadata, Vector.empty, None)
    var pendingResponse = BankPendingResponse(metadata, Vector.empty, None)
    private def respond[I, O](name: String, p: Principal, key: I, output: O): Future[Outcome[O]] = {
      calls += ((name, p, key)); Future.successful(Right(output))
    }
    def accountMe(p: Principal, key: BankAccountKey): Future[Outcome[BankAccountResponse]] = respond("account", p, key, accountResponse)
    def cashOriginal(p: Principal, key: BankCashRequestKey): Future[Outcome[BankCashRequestResponse]] = respond("cash", p, key, cashResponse)
    def order(p: Principal, key: BankOrderKey): Future[Outcome[BankOrderResponse]] = respond("order", p, key, orderResponse)
    def plans(p: Principal, key: BankPlanPageKey): Future[Outcome[BankSipPlanPage]] = respond("plans", p, key, planPage)
    def plan(p: Principal, key: BankPlanKey): Future[Outcome[BankSipPlanResponse]] = respond("plan", p, key, planResponse)
    def occurrences(p: Principal, key: BankOccurrencePageKey): Future[Outcome[BankSipOccurrencePage]] = respond("occurrences", p, key, occurrencePage)
    def pending(p: Principal, key: BankPendingPageKey): Future[Outcome[BankPendingResponse]] = respond("pending", p, key, pendingResponse)
  }

  final class Services extends BankCashRequestService with BankSipApplicationService with BankRecoveryService {
    val calls = mutable.ArrayBuffer.empty[(String, Principal, Any)]
    private def reject[I, O](name: String, p: Principal, input: I): Future[Outcome[O]] = {
      calls += ((name, p, input)); Future.successful(Left(Unavailable))
    }
    def submit(p: Principal, value: BankCashSubmit): Future[Outcome[BankCashAcknowledgement]] = reject("submit", p, value)
    def getOriginal(p: Principal, value: String): Future[Outcome[BankCashOriginal]] = reject("original", p, value)
    def submitOccurrence(value: SipOccurrence): Future[Outcome[BankPaymentOriginal]] = reject("dispatch", null, value)
    def create(p: Principal, value: BankSipCreate): Future[Outcome[BankSipAcknowledgement]] = reject("create", p, value)
    def revise(p: Principal, value: BankSipRevisionInput): Future[Outcome[BankSipAcknowledgement]] = reject("revise", p, value)
    def pause(p: Principal, value: BankPlanKey): Future[Outcome[BankSipAcknowledgement]] = reject("pause", p, value)
    def resume(p: Principal, value: BankPlanKey): Future[Outcome[BankSipAcknowledgement]] = reject("resume", p, value)
    def tick(p: Principal, value: BankTick): Future[Outcome[BankTickAcknowledgement]] = reject("tick", p, value)
    def recoverExisting(value: PlanId): Future[Outcome[Unit]] = reject("recover", null, value)
    def recordTerminal(value: SipOccurrence): Future[Outcome[Unit]] = reject("terminal", null, value)
    def reconcileExisting(p: Principal, value: BankOperationKey): Future[Outcome[BankRecoveryAcknowledgement]] = reject("reconcile", p, value)
    def close(): Unit = ()
  }
}

final class BankReadsideProjectionSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  import BankOwnerATestSupport._

  test("real account PBs, reserved balances and exact payload bytes survive reopen and a clean projection rebuild") {
    BankOwnerATestSupport.withFixture { f =>
      val events = f.accountEvents(f.investor, reserve = true)
      f.catchUp(events)
      val original = success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version))))
      original match {
        case BankAccountResponse(metadata, Some(BankAccountView(id, initialized, available, reserved))) =>
          assert(id == f.investor && initialized)
          assert(available == MoneyWire("90000", "CNY") && reserved == MoneyWire("10000", "CNY"))
          assert(disposition(metadata) == "caught-up")
          assert(watermarks(metadata) == Vector(BankProjectionWatermark(events.head.persistenceId, events.size.toLong, Some(events.size.toLong), "caught-up")))
        case _ => fail("projected account missing")
      }
      val persisted = f.sql("SELECT payload FROM bank_read_event WHERE namespace=? ORDER BY sequence_nr")(_.getBytes(1).toVector)
      assert(persisted == events.map(_.event.asInstanceOf[GeneratedMessage].toByteArray.toVector))
      f.reopen()
      assert(!f.journal.closed, "closing a projection must not close the shared journal")
      events.foreach(event => await(f.readside.project(event)))
      assert(f.count("bank_read_event") == events.size)
      assert(success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version)))) == original)
      f.reopen(clearDerived = true)
      assert(f.count("bank_read_event") == 0)
      f.catchUp(events)
      assert(success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version)))) == original)
    }
  }

  test("gaps, conflicting duplicates and account event identity failures cannot advance the contiguous checkpoint") {
    BankOwnerATestSupport.withFixture { f =>
      val events = f.accountEvents(f.investor, reserve = true)
      val other = f.accountEvents(f.otherInvestor).head
      val pid = events.head.persistenceId
      intercept[IllegalArgumentException](await(f.readside.project(events(1))))
      assert(f.checkpoint(pid).isEmpty && f.count("bank_read_event") == 0)
      await(f.readside.project(events.head))
      await(f.readside.project(events.head))
      assert(f.count("bank_read_event") == 1 && f.checkpoint(pid).contains(1L))
      intercept[IllegalArgumentException](await(f.readside.project(events.head.copy(event = other.event))))
      val identityFailure = intercept[IllegalArgumentException](await(f.readside.project(BankJournalEnvelope(pid, 2L, other.event))))
      assert(identityFailure.getMessage.contains("account event identity mismatch"))
      assert(f.count("bank_read_event") == 1 && f.checkpoint(pid).contains(1L))
      await(f.readside.project(events(1)))
      assert(f.count("bank_read_event") == 2 && f.checkpoint(pid).contains(2L))
    }
  }

  test("an index-write failure rolls back the event, state, ownership, pending index and checkpoint together") {
    BankOwnerATestSupport.withFixture { f =>
      val source = f.cashOriginal("atomic")
      val event = f.orderEvents(source.payment, Some(source), requestPayment = false).head
      f.dataSource.failOnSql = Some("INSERT INTO bank_read_pending")
      intercept[SQLException](await(f.readside.project(event)))
      assert(f.dataSource.failOnSql.isEmpty, "the fault must actually hit an index write")
      assert(f.count("bank_read_event") == 0 && f.count("bank_read_stream") == 0 && f.count("bank_read_pending") == 0)
      assert(f.checkpoint(event.persistenceId).isEmpty)
      await(f.readside.project(event))
      assert(f.checkpoint(event.persistenceId).contains(1L) && f.count("bank_read_event") == 1)
      val BankCashRequestResponse(_, view) = success(await(f.readside.cashOriginal(f.alice, BankCashRequestKey(source.clientRequestId))))
      assert(view.exists { case BankCashRequestView(original, _, _, _) => original == source })
      assert(f.count("bank_read_pending") == 1)
    }
  }

  test("a live delivery invalidates the sampled frontier and an absent unsampled stream stays unknown") {
    BankOwnerATestSupport.withFixture { f =>
      val events = f.accountEvents(f.investor, reserve = true)
      val pid = events.head.persistenceId
      f.catchUp(events.take(1))
      await(f.readside.project(events(1)))
      val BankAccountResponse(metadata, _) = success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version))))
      assert(disposition(metadata) == "unknown")
      assert(watermarks(metadata) == Vector(BankProjectionWatermark(pid, 2L, None, "unknown")))
      f.catchUp(events)
      val BankAccountResponse(current, _) = success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version))))
      assert(disposition(current) == "caught-up")
      val BankOrderResponse(missing, value) = success(await(f.readside.order(f.alice, BankOrderKey(FundOrderId("not-yet-discovered")))))
      assert(value.isEmpty && disposition(missing) == "unknown" && watermarks(missing).isEmpty)
    }
  }

  test("an early SIP occurrence is retryably joined when its actual order PID arrives later") {
    BankOwnerATestSupport.withFixture { f =>
      val (events, occurrenceValue) = f.planEvents("late-order", trigger = true)
      val occurrence = occurrenceValue.get
      f.catchUp(events)
      val key = BankOccurrencePageKey(occurrence.planId, 50L, 0L)
      val BankSipOccurrencePage(early, before, _) = success(await(f.readside.occurrences(f.alice, key)))
      assert(disposition(early) == "unknown" && before.size == 1)
      val BankSipOccurrenceView(beforeOccurrence, _, _, paymentBefore, taBefore, refundBefore, _) = before.head
      assert(beforeOccurrence == occurrence && paymentBefore == "unknown" && taBefore == "unknown" && refundBefore == "unknown")
      val payment = BankPaymentOriginal(occurrence.operationId, occurrence.fundOrderId, occurrence.config.investorAccountId,
        occurrence.config.fundCollectionAccountId, occurrence.config.fundCode, occurrence.config.amount)
      f.catchUp(f.orderEvents(payment))
      val BankSipOccurrencePage(joined, after, _) = success(await(f.readside.occurrences(f.alice, key)))
      val BankSipOccurrenceView(afterOccurrence, _, _, paymentAfter, taAfter, refundAfter, terminal) = after.head
      assert(afterOccurrence == occurrence && paymentAfter != "unknown")
      assert(taAfter == "not-submitted" && refundAfter == "not-required" && terminal.isEmpty)
      assert(disposition(joined) == "caught-up" && watermarks(joined).size == 2)
      assert(f.count("bank_read_occurrence") == 1)
      val BankSipPlanPage(index, plans, _) = success(await(f.readside.plans(f.alice, BankPlanPageKey(50L, 0L))))
      assert(plans.size == 1 && disposition(index) == "unknown", "no bounded discovery frontier means no whole-index caught-up claim")
    }
  }

  test("foreign namespace delivery is rejected before JDBC and two namespaces share no checkpoints or balances") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val system: ActorSystem[_] = f.system
      implicit val ec: ExecutionContext = f.ec
      val foreignJournal = new Journal("othera" + UUID.randomUUID().toString.replace("-", ""))
      val foreignIds = new BankPersistenceIds(foreignJournal.namespace)
      val foreignEvents = f.accountEvents(f.investor, "700.00", persistenceId = Some(foreignIds.account(f.investor)))
      val before = f.dataSource.connections.get()
      intercept[IllegalArgumentException](f.readside.project(foreignEvents.head))
      assert(f.dataSource.connections.get() == before)
      val foreign = new BankReadside(foreignJournal, f.config, f.dataSource)
      try {
        await(foreign.initialize())
        foreignJournal.put(foreignEvents)
        await(foreign.catchUp(foreignEvents.head.persistenceId))
        f.catchUp(f.accountEvents(f.investor))
        val BankAccountResponse(_, Some(BankAccountView(_, _, mine, _))) = success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version))))
        val BankAccountResponse(_, Some(BankAccountView(_, _, theirs, _))) = success(await(foreign.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version))))
        assert(mine == MoneyWire("100000", "CNY") && theirs == MoneyWire("70000", "CNY"))
        assert(f.count("bank_read_event") == 1 && f.checkpoint(foreignEvents.head.persistenceId).isEmpty)
      } finally { foreign.close(); foreignJournal.close() }
    }
  }
}
