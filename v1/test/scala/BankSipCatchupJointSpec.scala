import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.actor.typed.{ActorRef, ActorSystem}
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.Sink
import com.typesafe.config.ConfigFactory
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash, bank_payment_hostDefinition => Payment, bank_payment_hostHost => PaymentHost, bank_sip_dispatch_v1Execution => Dispatch, bank_sip_dispatchEffectHost => DispatchHost}
import example.bankwealth.bindings._
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.{DurableRunObserver, PersistentMonarch}
import org.scalatest.funsuite.AnyFunSuite
import scalapb.GeneratedMessage
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

final class BankSipCatchupJointSpec extends AnyFunSuite {
  test("SIP catch-up/pause/revision/repeat: ordered real cash dispatch does not wait for prior investment terminal") {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local").withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: scala.concurrent.ExecutionContext = system.executionContext
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    try {
      val journal = PersistenceTestKit(system)
      val query = PersistenceQuery(system).readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
      def read(pid: String): Future[Vector[Any]] = query.currentEventsByPersistenceId(pid, 0L, Long.MaxValue).runWith(Sink.seq).map(_.map(_.event).toVector)
      def messages(pid: String): Future[Vector[GeneratedMessage]] = read(pid).map(_.collect { case p: GeneratedMessage => p })
      val investorId = AccountId("investor"); val collectionId = AccountId("collection")
      val investor = kit.spawn(CreditBalanceAggregate("catch-investor", CreditBalanceState.empty.copy(id = investorId), BankBalanceComputations))
      val collection = kit.spawn(CreditBalanceAggregate("catch-collection", CreditBalanceState.empty.copy(id = collectionId), BankBalanceComputations))
      val replies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
      investor ! CreditBalanceAggregate.Execute(CreditBalanceProtocol.InitializeAccount(investorId, "CNY", Money(BigDecimal("1000.00"), "CNY")), replies.ref)
      assert(replies.receiveMessage().isInstanceOf[CreditBalanceAggregate.Accepted])
      collection ! CreditBalanceAggregate.Execute(CreditBalanceProtocol.InitializeAccount(collectionId, "CNY", Money(BigDecimal("0.00"), "CNY")), replies.ref)
      assert(replies.receiveMessage().isInstanceOf[CreditBalanceAggregate.Accepted])
      var plan = kit.spawn(SipPlanAggregate("catch-plan", SipPlanState.empty, StableSipIdentity))
      val planReplies = kit.createTestProbe[SipPlanAggregate.Reply](); val planStates = kit.createTestProbe[SipPlanState]()
      def send(c: SipPlanProtocol.Command): SipPlanAggregate.Reply = { plan ! SipPlanAggregate.Execute(c, planReplies.ref); planReplies.receiveMessage() }
      def accept(c: SipPlanProtocol.Command): Unit = assert(send(c).isInstanceOf[SipPlanAggregate.Accepted])
      def state(): SipPlanState = { plan ! SipPlanAggregate.GetState(planStates.ref); planStates.receiveMessage() }
      val first = SipRevisionConfig(RevisionId("r1"), 0L, investorId, collectionId, "fund", Money(BigDecimal("100.00"), "CNY"))
      val second = first.copy(revision = RevisionId("r2"), effectiveSlot = 30L, amount = Money(BigDecimal("200.00"), "CNY"))
      accept(SipPlanProtocol.CreateSipPlan(PlanId("catchup"), first))
      Vector(10L, 20L, 30L, 40L).zipWithIndex.foreach { case (slot, i) => accept(SipPlanProtocol.AppendSipDueSlot(i.toLong, slot)) }
      accept(SipPlanProtocol.SealSipSchedule())
      accept(SipPlanProtocol.AdvanceSipClock(25L))
      accept(SipPlanProtocol.ReviseSipPlan(second))
      accept(SipPlanProtocol.ObserveSipDueSlot(0L, 10L)); accept(SipPlanProtocol.ObserveSipDueSlot(1L, 20L))
      assert(send(SipPlanProtocol.TriggerSipInstallment(1L, 20L, first.revision, first)) == SipPlanAggregate.Refused("SIP_START_ORDER"))
      accept(SipPlanProtocol.PauseSipPlan(25L))
      assert(send(SipPlanProtocol.TriggerSipInstallment(0L, 10L, first.revision, first)) == SipPlanAggregate.Refused("SIP_ACTIVE_START"))
      accept(SipPlanProtocol.AdvanceSipClock(35L)); accept(SipPlanProtocol.SkipPausedSipDueSlot(2L, 30L)); accept(SipPlanProtocol.ResumeSipPlan(35L))
      val cashCompleted = kit.createTestProbe[String]()
      def dispatch(position: Long, slot: Long, config: SipRevisionConfig): (SipOccurrence, ActorRef[DispatchHost.Request], ActorRef[FundOrderAggregate.Request]) = {
        accept(SipPlanProtocol.TriggerSipInstallment(position, slot, config.revision, config))
        val o = state().occurrences(slot)
        val orderPid = "catch-order-" + position
        val order = kit.spawn(FundOrderAggregate(orderPid, FundOrderState.empty.copy(id = o.fundOrderId), StableOrderIdentity, new FundOrderAggregate.ExternalAuthority {
          def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false
        }))
        val original = BankPaymentOriginal(o.operationId, o.fundOrderId, investorId, collectionId, config.fundCode, config.amount)
        @volatile var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
        val binding = new BankPaymentBindings(original, investor, "catch-investor", collection, "catch-collection", order, orderPid, messages, () => coordinator)
        coordinator = kit.spawn(Payment.coordinator("catch-saga-" + position, Payment.fromTechnical(binding.installed), new ReconcileAuthorizer {
          def authorize(identity: TransactionIdentity, token: String): Either[String, String] = Left("not authorized")
        }))
        val host = kit.spawn(PaymentHost("catch-host-" + position, coordinator, binding.installed))
        val cashPid = "catch-cash-" + position
        val cash = kit.spawn(Cash.behavior(cashPid, Cash.install(new Cash.PureStages {}, host), new DurableRunObserver[Cash.State] {
          override def onCompleted(id: String): Unit = cashCompleted.ref ! id
        }))
        val dispatchBinding = new BankSipDispatchBindings(plan, "catch-plan", order, cash, cashPid, read)
        val dispatchHost = kit.spawn(DispatchHost("catch-dispatch-host-" + position, dispatchBinding.installed))
        val done = kit.createTestProbe[String]()
        val run = kit.spawn(Dispatch.behavior("catch-dispatch-" + position, Dispatch.install(new Dispatch.PureStages {}, dispatchHost), new DurableRunObserver[Dispatch.State] {
          override def onCompleted(id: String): Unit = done.ref ! id
        }))
        val started = kit.createTestProbe[PersistentMonarch.RunReply]()
        run ! PersistentMonarch.StartRun("dispatch-" + position, Dispatch.State(Dispatch.Inputs(o.occurrenceId, o)), started.ref)
        assert(started.receiveMessage().isInstanceOf[PersistentMonarch.Accepted]); assert(done.receiveMessage(10.seconds) == "dispatch-" + position)
        (o, dispatchHost, order)
      }
      val a = dispatch(0L, 10L, first)
      assert(state().firstTerminals.isEmpty)
      val b = dispatch(1L, 20L, first)
      assert(state().firstTerminals.isEmpty)
      assert(Set(cashCompleted.receiveMessage(10.seconds), cashCompleted.receiveMessage(10.seconds)) == Set(a._1.operationId.value, b._1.operationId.value))
      accept(SipPlanProtocol.AdvanceSkippedSipSlot(2L, 30L))
      accept(SipPlanProtocol.AdvanceSipClock(40L)); accept(SipPlanProtocol.ObserveSipDueSlot(3L, 40L))
      val c = dispatch(3L, 40L, second)
      assert(cashCompleted.receiveMessage(10.seconds) == c._1.operationId.value)
      assert(state().occurrences.values.map(_.operationId).toSet.size == 3)
      assert(state().occurrences(10L).config.amount == first.amount && state().occurrences(40L).config.amount == second.amount)
      assert(!state().occurrences.contains(30L))
      val states = kit.createTestProbe[CreditBalanceState]()
      investor ! CreditBalanceAggregate.GetState(states.ref); assert(states.receiveMessage().accountBalance("CNY").amount == BigDecimal("600.00"))
      collection ! CreditBalanceAggregate.GetState(states.ref); assert(states.receiveMessage().accountBalance("CNY").amount == BigDecimal("400.00"))
      val before = journal.persistedInStorage("catch-investor").size
      val retained = state()
      val planEvents = journal.persistedInStorage("catch-plan")
      kit.stop(plan)
      plan = kit.spawn(SipPlanAggregate("catch-plan", SipPlanState.empty, StableSipIdentity))
      assert(state() == retained)
      accept(SipPlanProtocol.AdvanceSipClock(40L))
      accept(SipPlanProtocol.TriggerSipInstallment(0L, 10L, first.revision, first))
      accept(SipPlanProtocol.TriggerSipInstallment(1L, 20L, first.revision, first))
      assert(journal.persistedInStorage("catch-plan") == planEvents)
      val again = kit.createTestProbe[DispatchHost.Reply]()
      a._2 ! DispatchHost.Invoke(Dispatch.State(Dispatch.Inputs(a._1.occurrenceId, a._1)), again.ref)
      assert(again.receiveMessage().isInstanceOf[DispatchHost.Completed]); assert(journal.persistedInStorage("catch-investor").size == before)
      assert(send(SipPlanProtocol.TriggerSipInstallment(0L, 10L, first.revision, first.copy(amount = second.amount))) == SipPlanAggregate.Refused("SIP_OCCURRENCE_REPLAY_CONFLICT"))
      assert(state().successTotal == 0L && state().failureTotal == 0L)
      assert(journal.persistedInStorage("catch-plan").collect { case p: SipPlanSipInstallmentTriggeredPB => p.f0 } == Seq(0L, 1L, 3L))
    } finally kit.shutdownTestKit()
  }
}
