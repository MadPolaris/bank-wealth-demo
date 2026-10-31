import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.actor.typed.scaladsl.AskPattern._
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.util.Timeout
import com.typesafe.config.ConfigFactory
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash, bank_payment_hostDefinition => Payment,
  bank_payment_hostHost => PaymentHost, bank_sip_dispatch_v1Execution => Dispatch, bank_sip_dispatchEffectHost => DispatchHost}
import example.bankwealth.bindings._
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.integration._
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import example.bankwealth.service.UnitConfigurationCheck
import example.bankwealth.sip.BankSipApplication
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.{DurableRunObserver, PersistentMonarch}
import org.scalatest.funsuite.AnyFunSuite
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._

// Test-only construction inside the generated principal's package visibility boundary.
package example.bankwealth.service {
  object BankSipTestPrincipal {
    def apply(id: String, roles: Set[String]): BankServiceService.Principal = BankServiceService.Principal(id, roles)
  }
}

/** All durable facts live in the actual generated actors and serialized testkit journal.
  * Maps here cache actor handles, never domain state. No TA worker, DB, or server is used.
  */
final class BankSipApplicationHarness(available: String = "1000.00") extends AutoCloseable {
  UnitConfigurationCheck.main(Array.empty)
  val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
    .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
  implicit val system: ActorSystem[_] = kit.system
  implicit val ec: ExecutionContext = system.executionContext
  implicit val timeout: Timeout = Timeout(3.seconds)
  val storage = PersistenceTestKit(system)
  val ids = new BankPersistenceIds("sipapplication")
  val investorId = AccountId("alice-account")
  val collectionId = AccountId("fund-collection")
  val bobId = AccountId("bob-account")
  val operatorId = AccountId("operator-account")
  val config = BankDemoConfiguration("demo-v1", "http://127.0.0.1:18081", Vector(
    BankDemoPrincipal("alice", investorId, Set("customer"), "alice-token", "alice-csrf"),
    BankDemoPrincipal("bob", bobId, Set("customer"), "bob-token", "bob-csrf"),
    BankDemoPrincipal("operator", operatorId, Set("operator"), "operator-token", "operator-csrf")),
    Vector(BankFund("fund", collectionId)), Vector(investorId, collectionId, bobId, operatorId).map { id =>
      BankSeed(id, "CNY", Money(BigDecimal(if (id == investorId) available else "0.00"), "CNY"))
    })
  val admission = new BankTrustedAdmission(config)
  val alice = example.bankwealth.service.BankSipTestPrincipal("alice", Set("customer"))
  val bob = example.bankwealth.service.BankSipTestPrincipal("bob", Set("customer"))
  val operator = example.bankwealth.service.BankSipTestPrincipal("operator", Set("operator"))
  val query = PersistenceQuery(system).readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
  val journal = new BankPersistenceJournal(ids.namespace, query, () => query.currentPersistenceIds(None, Long.MaxValue))
  def await[A](f: Future[A]): A = Await.result(f, 15.seconds)
  def request(key: String = "plan", due: Vector[Long] = Vector(10L, 20L)): BankSipCreate =
    BankSipCreate(key, "fund", MoneyWire("10000", "CNY"), 0L, due)
  def intent(request: BankSipCreate): BankSipCreateIntent = admission.sip(alice, request).toOption.get
  def planId(key: String = "plan"): PlanId = BankRequestIdentity.plan("alice", key)

  private var accounts = Map.empty[AccountId, BankActorHandle[CreditBalanceAggregate.Request]]
  private var plans = Map.empty[PlanId, BankActorHandle[SipPlanAggregate.Request]]
  private var orders = Map.empty[FundOrderId, BankActorHandle[FundOrderAggregate.Request]]
  private var cash = Map.empty[OperationId, BankCashRuntime]
  private var dispatches = Map.empty[OccurrenceId, BankSipDispatchRuntime]
  @volatile var failDispatch = false
  @volatile var failDispatchFor = Set.empty[OccurrenceId]
  @volatile var planLookups = 0
  @volatile var dispatchAttempts = Vector.empty[OccurrenceId]
  val cashFinished = kit.createTestProbe[(OperationId, String)]()
  val dispatchFinished = kit.createTestProbe[OccurrenceId]()

  val directory: BankRuntimeDirectory = new BankRuntimeDirectory {
    def account(id: AccountId): Future[BankActorHandle[CreditBalanceAggregate.Request]] = Future.successful(BankSipApplicationHarness.this.synchronized {
      accounts.getOrElse(id, {
        val h = BankActorHandle(ids.account(id), kit.spawn(CreditBalanceAggregate(ids.account(id), CreditBalanceState.empty.copy(id = id), BankBalanceComputations)))
        accounts += id -> h; h
      })
    })
    def plan(id: PlanId): Future[BankActorHandle[SipPlanAggregate.Request]] = Future.successful(BankSipApplicationHarness.this.synchronized {
      planLookups += 1
      plans.getOrElse(id, {
        val h = BankActorHandle(ids.plan(id), kit.spawn(SipPlanAggregate(ids.plan(id), SipPlanState.empty.copy(id = id), StableSipIdentity)))
        plans += id -> h; h
      })
    })
    def order(id: FundOrderId): Future[BankActorHandle[FundOrderAggregate.Request]] = Future.successful(BankSipApplicationHarness.this.synchronized {
      orders.getOrElse(id, {
        val h = BankActorHandle(ids.order(id), kit.spawn(FundOrderAggregate(ids.order(id), FundOrderState.empty.copy(id = id), StableOrderIdentity,
          new FundOrderAggregate.ExternalAuthority { def authorize(producer: String, token: String, identity: Vector[String]): Boolean = false })))
        orders += id -> h; h
      })
    })
    def ensureCash(original: BankPaymentOriginal): Future[BankCashRuntime] = for {
      investor <- account(original.investorAccountId)
      collection <- account(original.fundCollectionAccountId)
      orderHandle <- order(original.fundOrderId)
    } yield BankSipApplicationHarness.this.synchronized {
      cash.getOrElse(original.operationId, {
        @volatile var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
        val binding = new BankPaymentBindings(original, investor.ref, investor.persistenceId, collection.ref, collection.persistenceId,
          orderHandle.ref, orderHandle.persistenceId, pid => journal.readPb(pid), () => coordinator)
        coordinator = kit.spawn(Payment.coordinator(ids.paymentSaga(original.operationId), Payment.fromTechnical(binding.installed),
          new ReconcileAuthorizer { def authorize(identity: TransactionIdentity, token: String): Either[String, String] = Left("not authorized") }))
        val host = kit.spawn(PaymentHost(ids.paymentHost(original.operationId), coordinator, binding.installed))
        val parent = kit.spawn(Cash.behavior(ids.paymentRun(original.operationId), Cash.install(new Cash.PureStages {}, host), new DurableRunObserver[Cash.State] {
          override def onCompleted(id: String): Unit = cashFinished.ref ! (original.operationId -> "completed")
          override def onFailed(id: String, cursor: String, reason: String): Unit = cashFinished.ref ! (original.operationId -> "failed")
        }))
        val runtime = BankCashRuntime(original, binding.operationId, BankActorHandle(ids.paymentSaga(original.operationId), coordinator),
          BankActorHandle(ids.paymentHost(original.operationId), host), BankActorHandle(ids.paymentRun(original.operationId), parent))
        cash += original.operationId -> runtime; runtime
      })
    }
    def ensureSipDispatch(o: SipOccurrence): Future[BankSipDispatchRuntime] = {
      BankSipApplicationHarness.this.synchronized { dispatchAttempts :+= o.occurrenceId }
      if (failDispatch || failDispatchFor(o.occurrenceId)) Future.failed(new java.io.IOException("injected gap after occurrence persist, before dispatch graph"))
      else for {
        planHandle <- plan(o.planId)
        orderHandle <- order(o.fundOrderId)
        cashRuntime <- ensureCash(BankPaymentOriginal(o.operationId, o.fundOrderId, o.config.investorAccountId,
          o.config.fundCollectionAccountId, o.config.fundCode, o.config.amount))
      } yield BankSipApplicationHarness.this.synchronized {
        dispatches.getOrElse(o.occurrenceId, {
          val binding = new BankSipDispatchBindings(planHandle.ref, planHandle.persistenceId, orderHandle.ref,
            cashRuntime.parent.ref, cashRuntime.parent.persistenceId, pid => journal.readAll(pid))
          val host = kit.spawn(DispatchHost(ids.sipHost(o.occurrenceId), binding.installed))
          val parent = kit.spawn(Dispatch.behavior(ids.sipRun(o.occurrenceId), Dispatch.install(new Dispatch.PureStages {}, host), new DurableRunObserver[Dispatch.State] {
            override def onCompleted(id: String): Unit = dispatchFinished.ref ! o.occurrenceId
          }))
          val runtime = BankSipDispatchRuntime(o, BankActorHandle(ids.sipHost(o.occurrenceId), host), BankActorHandle(ids.sipRun(o.occurrenceId), parent))
          dispatches += o.occurrenceId -> runtime; runtime
        })
      }
    }
    def ensureTa(request: BankTaEffectRequest): Future[BankTaRuntime] = Future.failed(new UnsupportedOperationException("not used by SIP-only fixture"))
    def ensureRefund(original: BankRefundOriginal): Future[BankRefundRuntime] = Future.failed(new UnsupportedOperationException("not used by SIP-only fixture"))
    def close(): Unit = ()
  }
  // Initialize through generated commands, never initial.copy(balance = ...) or a fake ledger.
  config.seeds.foreach { seed =>
    val h = await(directory.account(seed.accountId))
    assert(await(h.ref.ask[CreditBalanceAggregate.Reply](r => CreditBalanceAggregate.Execute(
      CreditBalanceProtocol.InitializeAccount(seed.accountId, seed.currency, seed.amount), r))).isInstanceOf[CreditBalanceAggregate.Accepted])
  }
  var app = new BankSipApplication(directory, journal, config, admission)
  def planState(id: PlanId = planId()): SipPlanState = await(await(directory.plan(id)).ref.ask[SipPlanState](SipPlanAggregate.GetState))
  def orderState(o: SipOccurrence): FundOrderState = await(await(directory.order(o.fundOrderId)).ref.ask[FundOrderState](FundOrderAggregate.GetState))
  def command(id: PlanId, c: SipPlanProtocol.Command): SipPlanAggregate.Reply =
    await(await(directory.plan(id)).ref.ask[SipPlanAggregate.Reply](r => SipPlanAggregate.Execute(c, r)))
  def accept(id: PlanId, c: SipPlanProtocol.Command): Unit = assert(command(id, c).isInstanceOf[SipPlanAggregate.Accepted])
  def orderReply(o: SipOccurrence, c: FundOrderProtocol.Command): FundOrderAggregate.Reply =
    await(await(directory.order(o.fundOrderId)).ref.ask[FundOrderAggregate.Reply](r => FundOrderAggregate.Execute(c, r)))
  def orderCommand(o: SipOccurrence, c: FundOrderProtocol.Command): Unit =
    assert(orderReply(o, c).isInstanceOf[FundOrderAggregate.Accepted])
  def persisted(pid: String): Vector[Any] = storage.persistedInStorage(pid).toVector
  def balance(id: AccountId): Money = await(await(directory.account(id)).ref.ask[CreditBalanceState](CreditBalanceAggregate.GetState)).accountBalance("CNY")
  def restartApplication(): Unit = { app.close(); app = new BankSipApplication(directory, journal, config, admission) }
  def restartPlan(id: PlanId): Unit = synchronized { plans.get(id).foreach(h => kit.stop(h.ref)); plans -= id }
  def restartExecutionGraph(): Unit = synchronized {
    dispatches.values.foreach(r => { kit.stop(r.parent.ref); kit.stop(r.host.ref) }); dispatches = Map.empty
    cash.values.foreach(r => { kit.stop(r.parent.ref); kit.stop(r.host.ref); kit.stop(r.coordinator.ref) }); cash = Map.empty
    orders.values.foreach(h => kit.stop(h.ref)); orders = Map.empty
  }
  def paymentTx(o: SipOccurrence): TxId = TxId(PaymentHost.operationIdentity(Cash.State(Cash.Inputs(o.operationId, o.operationId,
    o.config.investorAccountId, o.fundOrderId, o.config.fundCollectionAccountId, o.config.amount, o.config.fundCode))))
  def finishCash(count: Int, expected: String = "completed"): Unit = (0 until count).foreach(_ => assert(cashFinished.receiveMessage(15.seconds)._2 == expected))
  def finishDispatch(count: Int): Unit = (0 until count).foreach(_ => dispatchFinished.receiveMessage(15.seconds))
  def close(): Unit = { app.close(); journal.close(); kit.shutdownTestKit() }
}

final class BankSipApplicationSpec extends AnyFunSuite {
  private def withHarness(test: BankSipApplicationHarness => Unit): Unit = {
    val h = new BankSipApplicationHarness; try test(h) finally h.close()
  }
  test("create records full trusted intent before create, ordered append and seal; conflicting replay fails closed") { withHarness { h =>
    val request = h.request()
    assert(h.await(h.app.create(h.alice, request)) == Right(BankSipAcknowledgement(h.planId(), "accepted")))
    val events = h.persisted(h.ids.plan(h.planId()))
    assert(events.head.isInstanceOf[SipPlanSipCreateIntentRecordedPB])
    assert(events(1).isInstanceOf[SipPlanSipPlanCreatedPB])
    assert(events.collect { case p: SipPlanSipDueSlotAppendedPB => p.f0 -> p.f1 } == Vector(0L -> 10L, 1L -> 20L))
    assert(events.last.isInstanceOf[SipPlanSipScheduleSealedPB])
    assert(h.planState().createIntent.contains(h.intent(request)))
    assert(h.dispatchAttempts.isEmpty && h.balance(h.investorId).amount == BigDecimal("1000.00"))
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.create(h.alice, request)).isRight)
    assert(h.persisted(h.ids.plan(h.planId())) == events)
    assert(h.await(h.app.create(h.alice, request.copy(amount = MoneyWire("20000", "CNY")))) == Left(RequestConflict))
    assert(h.await(h.app.create(h.alice, request.copy(dueSlots = Vector(10L, 30L)))) == Left(RequestConflict))
    assert(h.persisted(h.ids.plan(h.planId())) == events)
  } }
  test("invalid complete schedules and exact wire amounts create no plan or dispatch") { withHarness { h =>
    val invalid = Vector(Vector.empty[Long], Vector(20L, 10L), Vector(10L, 10L), Vector(-1L, 10L), (0L to 1024L).toVector)
    val before = h.planLookups
    invalid.foreach(slots => assert(h.await(h.app.create(h.alice, h.request(due = slots))) == Left(InvalidRequest)))
    assert(h.await(h.app.create(h.alice, h.request().copy(effectiveSlot = 11L))) == Left(InvalidRequest))
    Vector("0", "-1", "1.5", "not-money").foreach(amount =>
      assert(h.await(h.app.create(h.alice, h.request().copy(amount = MoneyWire(amount, "CNY")))) == Left(InvalidRequest)))
    assert(h.planLookups == before && h.dispatchAttempts.isEmpty)
  } }
  test("principal ownership is checked from trusted journal before any plan actor lookup; tick is operator-only") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request())).isRight)
    val before = h.planLookups
    assert(h.await(h.app.pause(h.bob, BankPlanKey(h.planId()))) == Left(NotAuthorized))
    assert(h.await(h.app.resume(h.bob, BankPlanKey(h.planId()))) == Left(NotAuthorized))
    assert(h.await(h.app.revise(h.bob, BankSipRevisionInput(h.planId(), BankSipRevise(RevisionId("r2"), 30L, "fund", MoneyWire("20000", "CNY"))))) == Left(NotAuthorized))
    assert(h.await(h.app.tick(h.alice, BankTick(40L))) == Left(NotAuthorized))
    assert(h.planLookups == before)
    assert(h.await(h.app.pause(h.alice, BankPlanKey(PlanId("missing")))) == Left(MissingResource))
    assert(h.planLookups == before)
  } }
  test("due occurrences and real cash dispatch advance without waiting for preceding TA terminal; ticks are durable monotone") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request())).isRight)
    assert(h.await(h.app.tick(h.operator, BankTick(20L))) == Right(BankTickAcknowledgement(20L, 1L)))
    val plan = h.planState()
    assert(plan.occurrences.keySet == Set(10L, 20L) && plan.firstTerminals.isEmpty)
    assert(plan.successTotal == 0L && plan.failureTotal == 0L)
    h.finishCash(2)
    assert(h.balance(h.investorId).amount == BigDecimal("800.00"))
    plan.occurrences.values.foreach { o =>
      val starts = h.persisted(h.ids.sipRun(o.occurrenceId)).collect { case e: PersistentMonarch.RunStarted => e }
      assert(starts.size == 1 && starts.head.runId == o.occurrenceId.value)
      assert(starts.head.stageCursors == Vector("dispatch-cash#0"))
      assert(Dispatch.codec.decode(starts.head.initialSnapshot).inputs == Dispatch.Inputs(o.occurrenceId, o))
      assert(h.persisted(h.ids.paymentRun(o.operationId)).count(_.isInstanceOf[PersistentMonarch.RunStarted]) == 1)
      assert(h.orderState(o).taStatus != "confirmed")
    }
    val debits = h.persisted(h.ids.account(h.investorId)).size
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.tick(h.operator, BankTick(19L))) == Left(RequestConflict))
    assert(h.await(h.app.tick(h.operator, BankTick(20L))).isRight)
    assert(h.planState().occurrences == plan.occurrences && h.planState().firstTerminals.isEmpty)
    assert(h.persisted(h.ids.account(h.investorId)).size == debits)
  } }
  test("pause interval slots are skipped, resume does not resurrect them, and future revision supplies retained config") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L, 20L, 30L, 40L)))).isRight)
    assert(h.await(h.app.tick(h.operator, BankTick(0L))).isRight)
    assert(h.await(h.app.pause(h.alice, BankPlanKey(h.planId()))).isRight)
    assert(h.await(h.app.tick(h.operator, BankTick(25L))).isRight)
    assert(h.planState().slotDisposition == Map(10L -> "skipped", 20L -> "skipped"))
    val revision = BankSipRevisionInput(h.planId(), BankSipRevise(RevisionId("r2"), 30L, "fund", MoneyWire("20000", "CNY")))
    assert(h.await(h.app.revise(h.alice, revision)).isRight)
    assert(h.await(h.app.revise(h.alice, revision)).isRight)
    assert(h.await(h.app.revise(h.alice, revision.copy(request = revision.request.copy(amount = MoneyWire("30000", "CNY"))))) == Left(RequestConflict))
    assert(h.await(h.app.resume(h.alice, BankPlanKey(h.planId()))).isRight)
    assert(h.await(h.app.tick(h.operator, BankTick(40L))).isRight)
    h.finishCash(2)
    val s = h.planState()
    assert(s.occurrences.keySet == Set(30L, 40L) && s.startCount == 4L)
    assert(s.occurrences.values.forall(o => o.revision == RevisionId("r2") && o.config.amount.amount == BigDecimal("200.00")))
    assert(h.balance(h.investorId).amount == BigDecimal("600.00"))
  } }
  test("cash success and TA acceptance or unknown are not success; correlated TA confirmation counts exactly once across recovery") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L)))).isRight)
    assert(h.await(h.app.tick(h.operator, BankTick(10L))).isRight)
    h.finishCash(1); h.finishDispatch(1)
    val o = h.planState().occurrences(10L)
    val tx = h.paymentTx(o)
    assert(h.orderState(o).cashPaymentFinalResults.get(tx).contains("succeeded"))
    assert(h.await(h.app.recordTerminal(o)).isRight)
    assert(h.planState().firstTerminals.isEmpty)
    h.orderCommand(o, FundOrderProtocol.RegisterFundTASubmission(o.fundOrderId, tx))
    val requestId = h.orderState(o).taRequestId
    h.orderCommand(o, FundOrderProtocol.RecordFundTAAccepted(o.fundOrderId, tx, requestId, "ta-reference",
      "accepted-receipt", "accepted-body", "fund", "CNY"))
    assert(h.await(h.app.recordTerminal(o)).isRight)
    assert(h.planState().successTotal == 0L && h.planState().failureTotal == 0L)
    h.orderCommand(o, FundOrderProtocol.RecordFundTAUnknown(o.fundOrderId, tx, requestId, "ta-reference",
      "unknown-receipt", "unknown-body", "fund", "CNY"))
    assert(h.await(h.app.recordTerminal(o)).isRight)
    assert(h.planState().occurrenceProgress(o.occurrenceId) == "outcome-unknown")
    assert(h.planState().firstTerminals.isEmpty)
    val confirmed = FundOrderProtocol.RecordFundTAConfirmed(o.fundOrderId, tx, requestId, "ta-reference",
      "confirmed-receipt", "confirmed-body", "fund", "CNY", FundShare("fund", TaExactText("80.000"), TaExactText("1.2500")))
    h.orderCommand(o, confirmed)
    assert(h.await(h.app.recordTerminal(o)).isRight)
    val s = h.planState()
    assert(s.firstTerminals == Map(o.occurrenceId -> "succeeded") && s.successTotal == 1L && s.failureTotal == 0L)
    assert(s.terminalReceiptBodies("bank-sip-terminal-v1/" + o.occurrenceId.value) == "confirmed-body")
    val before = h.persisted(h.ids.plan(h.planId()))
    h.orderCommand(o, confirmed)
    assert(h.orderReply(o, FundOrderProtocol.RecordFundTARejected(o.fundOrderId, tx, requestId, "ta-reference",
      "opposite-receipt", "opposite-body", "fund", "CNY", "rejected")).isInstanceOf[FundOrderAggregate.Refused])
    assert(h.await(h.app.recordTerminal(o.copy(operationId = OperationId("forged")))) == Left(RequestConflict))
    assert(h.await(h.app.recordTerminal(o.copy(config = o.config.copy(amount = Money(BigDecimal("200.00"), "CNY"))))) == Left(RequestConflict))
    h.restartApplication(); h.restartPlan(h.planId()); h.restartExecutionGraph()
    assert(h.await(h.app.recordTerminal(o)).isRight)
    assert(h.await(h.app.recoverExisting(h.planId())).isRight)
    assert(h.planState().firstTerminals == s.firstTerminals && h.planState().successTotal == 1L)
    assert(h.persisted(h.ids.plan(h.planId())) == before)
    assert(h.balance(h.investorId).amount == BigDecimal("900.00"))
  } }
  test("all discovered clocks are preflighted before a lower tick mutates any plan") { withHarness { h =>
    val first = h.request("a", Vector(100L, 200L))
    val second = h.request("z", Vector(100L, 200L))
    assert(h.await(h.app.create(h.alice, first)).isRight && h.await(h.app.create(h.alice, second)).isRight)
    h.accept(h.planId("a"), SipPlanProtocol.AdvanceSipClock(10L))
    h.accept(h.planId("z"), SipPlanProtocol.AdvanceSipClock(30L))
    val before = Vector("a", "z").map(key => key -> h.persisted(h.ids.plan(h.planId(key)))).toMap
    h.restartApplication(); h.restartPlan(h.planId("a")); h.restartPlan(h.planId("z"))
    assert(h.await(h.app.tick(h.operator, BankTick(20L))) == Left(RequestConflict))
    before.foreach { case (key, events) => assert(h.persisted(h.ids.plan(h.planId(key))) == events) }
    assert(h.dispatchAttempts.isEmpty)
    assert(h.await(h.app.tick(h.operator, BankTick(30L))) == Right(BankTickAcknowledgement(30L, 2L)))
    assert(h.planState(h.planId("a")).currentTick == 30L && h.planState(h.planId("z")).currentTick == 30L)
  } }
  test("pause before the first manual clock tick fails without inventing a wall clock or appending an event") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request())).isRight)
    val before = h.persisted(h.ids.plan(h.planId()))
    assert(h.await(h.app.pause(h.alice, BankPlanKey(h.planId()))) == Left(RequestConflict))
    assert(h.planState().currentTick == -1L && !h.planState().paused)
    assert(h.persisted(h.ids.plan(h.planId())) == before && h.dispatchAttempts.isEmpty)
    assert(h.await(h.app.tick(h.operator, BankTick(-1L))) == Left(InvalidRequest))
  } }
  test("three genuine payment failures count once each and never automatically pause the next due slot") {
    val h = new BankSipApplicationHarness("0.00")
    try {
      assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L, 20L, 30L, 40L)))).isRight)
      assert(h.await(h.app.tick(h.operator, BankTick(30L))).isRight)
      h.finishCash(3, "failed")
      h.planState().occurrences.values.foreach { o => assert(h.await(h.app.recordTerminal(o)).isRight); assert(h.await(h.app.recordTerminal(o)).isRight) }
      val s = h.planState()
      assert(s.failureTotal == 3L && s.successTotal == 0L && !s.paused)
      val before = h.persisted(h.ids.plan(h.planId()))
      s.occurrences.values.foreach(o => assert(h.await(h.app.recordTerminal(o)).isRight))
      assert(h.persisted(h.ids.plan(h.planId())) == before)
      assert(h.await(h.app.tick(h.operator, BankTick(40L))).isRight)
      assert(h.planState().occurrences.contains(40L) && !h.planState().paused)
      h.finishCash(1, "failed")
    } finally h.close()
  }
}
