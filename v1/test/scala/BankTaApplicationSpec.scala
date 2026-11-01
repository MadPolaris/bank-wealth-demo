import akka.NotUsed
import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.PersistenceTestKitSnapshotPlugin
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.stream.{Materializer, SystemMaterializer}
import akka.stream.scaladsl.{Sink, Source}
import akka.util.Timeout
import com.typesafe.config.ConfigFactory
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash, bank_ta_effectEffectHost => TaHost}
import example.bankwealth.bindings.{BankTaBridge, BankTaEffectBindings, MockTAClient}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.integration._
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import example.bankwealth.ta.BankTaRefundApplication
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.PersistentMonarch
import org.scalatest.funsuite.AnyFunSuite
import java.nio.file.{Files, Path, Paths}
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger, AtomicReference}
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._

/** Shared only by the two owner-B suites. Every envelope comes from the real
  * persistence-testkit read journal; no hand-built order/Saga/Monarch events.
  * Main supplies bank.mock-ta.node, bank.mock-ta.worker and bank.mock-ta.owned-root.
  * The configured existing worker must accept journal + ownedRoot arguments.
  */
object BankTaApplicationFixture {
  def withHarness(scenario: String, loseTaReply: Boolean = false, hideRefundReceipt: Boolean = false)
      (body: Harness => Unit): Unit = {
    def configuredPath(key: String): Path = Paths.get(sys.props.getOrElse(key,
      throw new IllegalArgumentException("explicit test configuration required: " + key)))
    val configured = MockTAClient.Configuration(configuredPath("bank.mock-ta.node"),
      configuredPath("bank.mock-ta.worker"), configuredPath("bank.mock-ta.owned-root"))
    Files.createDirectories(configured.ownedRoot)
    val evidence = Files.createTempDirectory(configured.ownedRoot, "owner-b-application-")
    val worker = configured.copy(ownedRoot = evidence)
    example.bankwealth.service.UnitConfigurationCheck.main(Array.empty)
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(PersistenceTestKitSnapshotPlugin.config)
      .withFallback(ConfigFactory.load()))
    var client: MockTAClient = null
    var harness: Harness = null
    try {
      client = new MockTAClient(worker, evidence.resolve("ta.jsonl"), evidence.resolve("worker.jsonl"), evidence.resolve("worker.stderr.log"))
      // Process creation is not worker readiness. A real query acknowledges that
      // the worker has opened/replayed its own journal without submitting anything.
      val readinessId = "owner-b-worker-readiness"
      val readiness = Await.result(client.query(readinessId), 10.seconds)
      require(readiness.path("requestId").asText() == readinessId && readiness.path("status").asText() == "unknown",
        "owned worker readiness query required")
      harness = new Harness(kit, client, scenario, loseTaReply, hideRefundReceipt)
      body(harness)
    } finally {
      try {
        if (harness != null) harness.close() else if (client != null) client.close()
      } finally kit.shutdownTestKit()
    }
  }

  final class Harness(val kit: ActorTestKit, var client: MockTAClient, scenario: String,
      loseTaReply: Boolean, hideRefundReceipt: Boolean) extends AutoCloseable {
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: ExecutionContext = system.executionContext
    implicit val materializer: Materializer = SystemMaterializer(system).materializer
    implicit val timeout: Timeout = Timeout(3.seconds)
    val storage = PersistenceTestKit(system)
    private val query = PersistenceQuery(system).readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
    private val assertions = kit.createTestProbe[Unit]()
    val ids = new BankPersistenceIds("ownerB_" + java.util.UUID.randomUUID().toString.replace("-", ""))
    val investor = AccountId("investor")
    val collection = AccountId("collection")
    val config = BankDemoConfiguration("demo-v1", "http://127.0.0.1:18081", Vector(
      BankDemoPrincipal("alice", investor, Set("customer"), "test-token", "test-csrf")),
      Vector(BankFund("FUND-中文-001", collection)), Vector(
        BankSeed(investor, "CNY", Money(BigDecimal("1000.00"), "CNY")),
        BankSeed(collection, "CNY", Money(BigDecimal("0.00"), "CNY"))))
    val admission = new BankTrustedAdmission(config)
    val original = BankCashOriginal("alice", "owner-b-request", config.version,
      BankCashSubmit("owner-b-request", "FUND-中文-001", MoneyWire("10000", "CNY")),
      BankPaymentOriginal(BankRequestIdentity.operation("alice", "owner-b-request"),
        BankRequestIdentity.order("alice", "owner-b-request"), investor, collection, "FUND-中文-001", Money(BigDecimal("100.00"), "CNY")))
    val payment = original.payment
    val selectedScenario = new AtomicReference[String](scenario)
    val loseEffectReply = new AtomicBoolean(loseTaReply)
    val hideRefundEvidence = new AtomicBoolean(hideRefundReceipt)
    val hiddenRefundReads = new AtomicInteger(0)
    val discoverOrders = new AtomicBoolean(false)
    val subscriptions = new AtomicInteger(0)
    val journalClosed = new AtomicBoolean(false)
    val terminalCalls = new ConcurrentLinkedQueue[FundOrderId]()
    @volatile var terminalDelivery: FundOrderId => Future[Unit] = _ => Future.successful(())
    val scenarioForOrder: FundOrderId => String = id => {
      require(id == payment.fundOrderId, "test scenario cannot select another order")
      selectedScenario.get()
    }
    val journal: BankJournal = new BankJournal {
      val namespace: String = ids.namespace
      def persistenceIds(): Source[String, NotUsed] =
        if (discoverOrders.get() && storage.persistedInStorage(ids.order(payment.fundOrderId)).nonEmpty)
          Source.single(ids.order(payment.fundOrderId)) else Source.empty[String]
      def currentEvents(pid: String, after: Long): Future[Vector[BankJournalEnvelope]] = {
        require(ids.owns(pid) && after >= 0L)
        query.currentEventsByPersistenceId(pid, after + 1L, Long.MaxValue).runWith(Sink.seq).map { rows =>
          val events = rows.map(e => BankJournalEnvelope(e.persistenceId, e.sequenceNr, e.event)).toVector
          if (pid == ids.account(collection) && hideRefundEvidence.get() &&
              events.exists(_.event.isInstanceOf[CreditBalanceReserveFundsConfirmedPB])) {
            hiddenRefundReads.incrementAndGet()
            throw new java.io.IOException("owned fault after durable refund prepare, before receipt delivery")
          }
          events
        }
      }
      def events(pid: String, after: Long): Source[BankJournalEnvelope, NotUsed] =
        Source.tick(Duration.Zero, 100.millis, ()).mapAsync(1)(_ => currentEvents(pid, after))
          .statefulMapConcat { () =>
            var seen = after
            rows => {
              val fresh = rows.filter(_.sequenceNr > seen)
              fresh.lastOption.foreach(e => seen = e.sequenceNr)
              fresh.toList
            }
          }.mapMaterializedValue(_ => NotUsed).watchTermination() { (_, done) =>
            subscriptions.incrementAndGet()
            done.onComplete(_ => subscriptions.decrementAndGet())
            NotUsed
          }
      def close(): Unit = { journalClosed.set(true); () }
    }
    private var cashGraph = Option.empty[BankCashRuntime]
    private var taGraph = Option.empty[BankTaRuntime]
    private var refundGraph = Option.empty[BankRefundRuntime]
    private var applications = Vector.empty[BankTaRefundApplication]
    private def createRuntime(): BankRuntime = {
      val base = BankTaEffectBindings.forOrders(client, scenarioForOrder)
      val bindings: ActorRef[FundOrderAggregate.Request] => TaHost.Installed = order => {
        val actual = base(order)
        TaHost.install(TaHost.Bindings(
          TaHost.Implementation("bankwealth.BankTaEffectExecute", "bank-v1-1", (op: BankTaEffectOperation) =>
            actual.execute(op).flatMap { result =>
              if (loseEffectReply.get()) Future.failed(new java.io.IOException("reply lost after durable TA submission"))
              else Future.successful(result)
            }),
          TaHost.Implementation("bankwealth.BankTaEffectQuery", "bank-v1-1", (op: BankTaEffectOperation) =>
            if (loseEffectReply.get()) Future.failed(new java.io.IOException("TA effect query transport unavailable")) else actual.query(op)),
          TaHost.Implementation("bankwealth.BankTaEffectReconcilePort", "bank-v1-1", (op: BankTaEffectReconcile) => actual.reconcile(op))
        ))
      }
      new BankRuntime(ids.namespace, journal, new ReconcileAuthorizer {
        def authorize(id: TransactionIdentity, token: String): Either[String, String] =
          if (token == "owned-b-refund-recovery" && refundGraph.exists(_.transactionId == id.transactionId))
            Right("owner-b-test-operator") else Left("cannot start or substitute a transaction")
      }, bindings)
    }
    var runtime: BankRuntime = createRuntime()
    def await[A](future: Future[A]): A = Await.result(future, 10.seconds)
    def eventually(body: => Unit): Unit = assertions.awaitAssert(body, 15.seconds, 100.millis)
    def order: BankActorHandle[FundOrderAggregate.Request] = await(runtime.order(payment.fundOrderId))
    def state: FundOrderState = await(order.ref.ask[FundOrderState](FundOrderAggregate.GetState))
    def send(command: FundOrderProtocol.Command): FundOrderAggregate.Reply =
      await(order.ref.ask[FundOrderAggregate.Reply](r => FundOrderAggregate.Execute(command, r)))
    def ledger(id: AccountId, command: CreditBalanceProtocol.Command): Unit = {
      val account = await(runtime.account(id))
      assert(await(account.ref.ask[CreditBalanceAggregate.Reply](r => CreditBalanceAggregate.Execute(command, r)))
        .isInstanceOf[CreditBalanceAggregate.Accepted])
    }
    def balance(id: AccountId): BigDecimal = {
      val account = await(runtime.account(id))
      await(account.ref.ask[CreditBalanceState](CreditBalanceAggregate.GetState)).accountBalance("CNY").amount
    }
    def recordOrder(): Unit = {
      admission.validateCash(original)
      assert(send(FundOrderProtocol.RecordCashRequestSource(original, Some(original))).isInstanceOf[FundOrderAggregate.Accepted])
      assert(send(FundOrderProtocol.RequestFundPurchaseSettlement(payment.operationId, payment.fundOrderId,
        investor, collection, payment.fundCode, payment.amount)).isInstanceOf[FundOrderAggregate.Accepted])
    }
    def pay(): Unit = {
      config.seeds.foreach(s => ledger(s.accountId, CreditBalanceProtocol.InitializeAccount(s.accountId, s.currency, s.amount)))
      recordOrder()
      val cash = await(runtime.ensureCash(payment))
      cashGraph = Some(cash)
      assert(await(cash.parent.ref.ask[PersistentMonarch.RunReply](r => PersistentMonarch.StartRun(
        payment.operationId.value, Cash.State(Cash.Inputs(payment.operationId, payment.operationId, investor,
          payment.fundOrderId, collection, payment.amount, payment.fundCode)), r))).isInstanceOf[PersistentMonarch.Accepted])
      eventually {
        assert(state.cashPaymentFinalResults.get(TxId(cash.transactionId)).contains("succeeded"))
        assert(state.selectedPaymentTxId == TxId(cash.transactionId))
        assert(storage.persistedInStorage(cash.parent.persistenceId).exists(_.isInstanceOf[PersistentMonarch.StageDone]))
      }
      assert(balance(investor) == BigDecimal("900.00") && balance(collection) == BigDecimal("100.00"))
    }
    def application(): BankTaRefundApplication = {
      val app = new BankTaRefundApplication(runtime, journal, client, scenarioForOrder, id => {
        terminalCalls.add(id)
        terminalDelivery(id)
      }, config, admission, 100.millis)
      applications :+= app
      app
    }
    def bridge: BankTaBridge = new BankTaBridge(order.ref, client)
    def taRuntime: BankTaRuntime = {
      val s = state
      val graph = await(runtime.ensureTa(BankTaEffectRequest(s.taRequestId, s.id, s.selectedPaymentTxId)))
      taGraph = Some(graph)
      graph
    }
    def refundOriginal: BankRefundOriginal = {
      val s = state
      BankRefundOriginal(s.id, s.selectedPaymentTxId, s.investorAccountId, s.fundCollectionAccountId, s.amount, s.refundOperationId)
    }
    def refundRuntime: BankRefundRuntime = {
      val graph = await(runtime.ensureRefund(refundOriginal))
      refundGraph = Some(graph)
      graph
    }
    def refundStatus: StrictState = await(refundRuntime.coordinator.ref.ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus)) match {
      case StrictSagaCoordinator.Status(s) => s
      case other => throw new IllegalStateException("unexpected status: " + other)
    }
    def eventCount[A](pid: String)(implicit tag: scala.reflect.ClassTag[A]): Int =
      storage.persistedInStorage(pid).count(event => tag.unapply(event).nonEmpty)
    def submissions: Int = Files.readAllLines(client.configuration.ownedRoot.resolve("ta.jsonl")).asScala
      .count(_.contains("\"kind\":\"RequestSubmitted\""))
    def accepted(app: BankTaRefundApplication): Unit = {
      assert(await(app.resumeExisting(payment.fundOrderId)) == Right(()))
      eventually(assert(state.taStatus == "accepted"))
      assert(state.taConfirmedShares.shares.value.isEmpty && terminalCalls.isEmpty)
    }
    def restartRuntime(): Unit = {
      applications.foreach(_.close())
      val refs = Vector[ActorRef[_]](order.ref, await(runtime.account(investor)).ref, await(runtime.account(collection)).ref) ++
        cashGraph.toVector.flatMap(g => Vector[ActorRef[_]](g.parent.ref, g.host.ref, g.coordinator.ref)) ++
        taGraph.toVector.flatMap(g => Vector[ActorRef[_]](g.parent.ref, g.host.ref)) ++
        refundGraph.toVector.flatMap(g => Vector[ActorRef[_]](g.parent.ref, g.host.ref, g.coordinator.ref))
      // BankRuntime uses systemActorOf, so these are not the testkit guardian's
      // children. Stop the actual actors and await termination before respawning.
      val termination = refs.distinct.reverse.map(ref =>
        akka.pattern.gracefulStop(ref.toClassic, 10.seconds, akka.actor.PoisonPill))
      assert(Await.result(Future.sequence(termination), 15.seconds).forall(stopped => stopped))
      runtime.close()
      cashGraph = None; taGraph = None; refundGraph = None
      runtime = createRuntime()
    }
    def reopenWorker(): Unit = {
      applications.foreach(_.close())
      val configuration = client.configuration
      client.close()
      val suffix = java.util.UUID.randomUUID().toString
      client = new MockTAClient(configuration, configuration.ownedRoot.resolve("ta.jsonl"),
        configuration.ownedRoot.resolve("worker-reopened-" + suffix + ".jsonl"),
        configuration.ownedRoot.resolve("worker-reopened-" + suffix + ".stderr.log"))
    }
    def close(): Unit = {
      applications.foreach(_.close())
      try runtime.close() finally client.close()
    }
  }
}

final class BankTaApplicationSpec extends AnyFunSuite {
  import BankTaApplicationFixture._

  test("TA-application-unpaid: generated order cannot register, submit, refund or deliver a terminal") {
    withHarness("confirmed") { h =>
      h.recordOrder()
      val app = h.application()
      val before = h.storage.persistedInStorage(h.ids.order(h.payment.fundOrderId)).size
      assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.state.taRequestId.value.isEmpty && h.state.refundOperationId.value.isEmpty && h.terminalCalls.isEmpty)
      assert(h.storage.persistedInStorage(h.ids.order(h.payment.fundOrderId)).size == before && h.submissions == 0)
      intercept[IllegalArgumentException](h.await(h.bridge.submit("confirmed")))
      assert(h.submissions == 0)
    }
  }

  test("TA-application-discovery: retained register-before-submit intent drives the original finite effect and exact terminal") {
    withHarness("duplicate-conflicting") { h =>
      h.pay()
      val registered = h.await(h.bridge.register())
      assert(h.submissions == 0)
      h.discoverOrders.set(true)
      h.application() // journal startup scan + continuing observations, not a callback-only driver
      h.eventually {
        assert(h.state.taStatus == "accepted")
        assert(h.eventCount[PersistentMonarch.StageDone](h.ids.taRun(registered.taRequestId)) == 1)
        assert(h.subscriptions.get() > 0)
      }
      assert(h.state.taRequestId == registered.taRequestId && h.submissions == 1 && h.terminalCalls.isEmpty)
      assert(h.state.taConfirmedShares.shares.value.isEmpty)
      h.await(h.client.advance(1L))
      h.eventually {
        assert(h.state.taStatus == "confirmed" && !h.terminalCalls.isEmpty)
        assert(h.state.taConfirmedShares.shares.value == "80.0000" && h.state.taConfirmedShares.nav.value == "1.2345")
      }
      val response = h.await(h.client.query(registered.taRequestId.value))
      val conflicting = response.get("receipts").get(2)
      val before = h.storage.persistedInStorage(h.ids.order(h.payment.fundOrderId)).size
      intercept[IllegalArgumentException](h.await(h.bridge.ingest(conflicting)))
      h.await(h.bridge.ingest(response.get("canonicalReceipts").get(1)))
      intercept[IllegalArgumentException](h.await(h.bridge.reconcile("rejected")))
      assert(h.storage.persistedInStorage(h.ids.order(h.payment.fundOrderId)).size == before)
      assert(h.eventCount[PersistentMonarch.RunStarted](h.ids.taRun(registered.taRequestId)) == 1 && h.submissions == 1)
      assert(h.state.refundOperationId.value.isEmpty && h.terminalCalls.asScala.forall(_ == h.payment.fundOrderId))
    }
  }

  test("TA-application-accepted-only: completed technical effect never becomes an investment success or refund") {
    withHarness("accepted") { h =>
      h.pay()
      val app = h.application()
      h.accepted(app)
      val graph = h.taRuntime
      h.eventually(assert(h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 1))
      h.await(h.client.advance(10L))
      assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.state.taStatus == "accepted" && h.state.taConfirmedShares.shares.value.isEmpty)
      assert(h.state.refundOperationId.value.isEmpty && h.terminalCalls.isEmpty && h.submissions == 1)
    }
  }

  test("TA-application-deferred-UNKNOWN: retained shares still reattach the uncheckpointed original effect after actor recovery") {
    withHarness("confirmed", loseTaReply = true) { h =>
      h.pay()
      val app = h.application()
      h.accepted(app)
      val graph = h.taRuntime
      assert(h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 0)
      assert(h.eventCount[PersistentMonarch.RunFailedEvt](graph.parent.persistenceId) == 0 && h.submissions == 1)
      h.await(h.client.advance(1L))
      h.eventually {
        assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
        assert(h.state.taStatus == "confirmed" && h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 0)
      }
      val retainedRequest = h.state.taRequestId
      h.restartRuntime()
      h.loseEffectReply.set(false)
      val recovered = h.application()
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      h.eventually(assert(h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 1))
      assert(h.state.taRequestId == retainedRequest && h.submissions == 1)
      assert(h.eventCount[PersistentMonarch.RunStarted](graph.parent.persistenceId) == 1)
      assert(h.state.refundOperationId.value.isEmpty && h.balance(h.investor) == BigDecimal("900.00"))
    }
  }

  test("TA-application-delayed: actual worker journal reopen and generated actor recovery retain the same submission") {
    withHarness("delayed") { h =>
      h.pay()
      val app = h.application()
      h.accepted(app)
      val graph = h.taRuntime
      h.eventually(assert(h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 1))
      val requestId = h.state.taRequestId
      h.reopenWorker()
      h.restartRuntime()
      val recovered = h.application()
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.state.taStatus == "accepted" && h.terminalCalls.isEmpty)
      h.await(h.client.advance(3L))
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.state.taStatus == "confirmed" && h.state.taRequestId == requestId && h.submissions == 1)
      assert(h.eventCount[PersistentMonarch.RunStarted](graph.parent.persistenceId) == 1)
      val exitLogs = Files.readAllLines(h.client.configuration.ownedRoot.resolve("worker.jsonl")).asScala
      assert(exitLogs.exists(_.contains("\"kind\":\"worker-exited\"")))
    }
  }

  test("TA-application-close: cancel owned subscriptions and pending delivery without closing shared resources") {
    withHarness("confirmed") { h =>
      h.pay()
      h.discoverOrders.set(true)
      val app = h.application()
      h.accepted(app)
      h.eventually(assert(h.subscriptions.get() > 0))
      val gate = Promise[Unit]()
      h.terminalDelivery = _ => gate.future
      h.await(h.client.advance(1L))
      val pending = app.resumeExisting(h.payment.fundOrderId)
      h.eventually(assert(!h.terminalCalls.isEmpty))
      assert(!pending.isCompleted)
      app.close(); app.close()
      assert(h.await(pending) == Left(Unavailable))
      assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Left(Unavailable))
      gate.success(())
      h.eventually(assert(h.subscriptions.get() == 0))
      assert(!h.journalClosed.get())
      assert(h.await(h.client.query(h.state.taRequestId.value)).path("status").asText() == "confirmed")
    }
  }
}
