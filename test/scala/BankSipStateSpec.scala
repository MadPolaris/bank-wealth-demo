import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.StableSipIdentity
import example.bankwealth.domain._
import example.bankwealth.domain.SipPlanProtocol._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto.SipPlanSipInstallmentTriggeredPB
import org.scalatest.funsuite.AnyFunSuite

// Aggregate contract tests only. Terminal labels here do not certify the pending trusted completion bridge.
final class BankSipStateSpec extends AnyFunSuite {
  private val config = SipRevisionConfig(RevisionId("revision-1"), 0L,
    AccountId("investor"), AccountId("collection"), "fund-a", Money(BigDecimal("100.00"), "CNY"))

  private final class Fixture(id: String) {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    val journal = PersistenceTestKit(kit.system)
    private var actor = kit.spawn(SipPlanAggregateFactory.create(id, SipPlanState.empty, StableSipIdentity))
    private val replies = kit.createTestProbe[SipPlanAggregate.Reply]()
    private val states = kit.createTestProbe[SipPlanState]()
    def send(command: Command): SipPlanAggregate.Reply = {
      actor ! SipPlanAggregate.Execute(command, replies.ref)
      replies.receiveMessage()
    }
    def accept(command: Command): Vector[Event] = send(command) match {
      case SipPlanAggregate.Accepted(events) => events
      case reply => fail("unexpected refusal: " + command + " -> " + reply)
    }
    def refuse(command: Command, code: String): Unit = assert(send(command) == SipPlanAggregate.Refused(code))
    def state: SipPlanState = { actor ! SipPlanAggregate.GetState(states.ref); states.receiveMessage() }
    def events: Seq[Any] = journal.persistedInStorage(id)
    def recover(): Unit = {
      kit.stop(actor)
      actor = kit.spawn(SipPlanAggregateFactory.create(id, SipPlanState.empty, StableSipIdentity))
    }
    def seed(): Unit = {
      accept(CreateSipPlan(PlanId("plan-1"), config))
      Vector(10L, 20L, 30L).zipWithIndex.foreach { case (slot, i) => accept(AppendSipDueSlot(i.toLong, slot)) }
      accept(SealSipSchedule())
    }
    def close(): Unit = kit.shutdownTestKit()
  }
  private def withFixture(id: String)(test: Fixture => Unit): Unit = {
    val f = new Fixture(id)
    try test(f) finally f.close()
  }

  test("catch-up creates in slot order without waiting for preceding terminal and retains identity on replay") {
    withFixture("sip-state-catch-up") { f =>
      f.seed(); f.accept(AdvanceSipClock(25L))
      f.refuse(ObserveSipDueSlot(1L, 20L), "SIP_OBSERVATION_ORDER")
      f.accept(ObserveSipDueSlot(0L, 10L)); f.accept(ObserveSipDueSlot(1L, 20L))
      f.refuse(TriggerSipInstallment(1L, 20L, config.revision, config), "SIP_START_ORDER")
      f.accept(TriggerSipInstallment(0L, 10L, config.revision, config))
      val first = f.state.occurrences(10L)
      f.accept(TriggerSipInstallment(1L, 20L, config.revision, config))
      assert(f.state.startCount == 2L)
      assert(f.state.firstTerminals.isEmpty)
      assert(f.state.occurrenceProgress.values.toSet == Set("pending"))
      assert(f.state.occurrences.values.map(_.operationId).toSet.size == 2)
      val persisted = f.events
      assert(persisted.collect { case e: SipPlanSipInstallmentTriggeredPB => e.f0 } == Seq(0L, 1L))
      f.recover()
      assert(f.state.occurrences(10L) == first)
      assert(f.accept(TriggerSipInstallment(0L, 10L, config.revision, config)).isEmpty)
      assert(f.events == persisted)
      f.refuse(TriggerSipInstallment(0L, 10L, config.revision, config.copy(amount = Money(BigDecimal("200.00"), "CNY"))), "SIP_OCCURRENCE_REPLAY_CONFLICT")
    }
  }

  test("pause preserves prior backlog, skips paused dues and does not create while paused") {
    withFixture("sip-state-pause") { f =>
      f.seed(); f.accept(AdvanceSipClock(15L)); f.accept(PauseSipPlan(15L))
      f.accept(ObserveSipDueSlot(0L, 10L))
      f.accept(AdvanceSipClock(16L))
      f.refuse(TriggerSipInstallment(0L, 10L, config.revision, config), "SIP_ACTIVE_START")
      assert(f.state.occurrences.isEmpty)
      f.accept(AdvanceSipClock(25L))
      f.refuse(ResumeSipPlan(25L), "SIP_RESUME_CLASSIFIED")
      f.accept(SkipPausedSipDueSlot(1L, 20L)); f.accept(ResumeSipPlan(25L))
      f.accept(TriggerSipInstallment(0L, 10L, config.revision, config))
      f.accept(AdvanceSkippedSipSlot(1L, 20L))
      f.accept(AdvanceSipClock(30L)); f.accept(ObserveSipDueSlot(2L, 30L))
      f.accept(TriggerSipInstallment(2L, 30L, config.revision, config))
      assert(f.state.occurrences.keySet == Set(10L, 30L))
      assert(f.state.slotDisposition(20L) == "skipped")
      assert(f.state.pauseIntervals == Map(15L -> 25L))
      assert(f.state.successTotal == 0L && f.state.failureTotal == 0L)
    }
  }

  test("new revision owns only future interval and cannot replace old backlog configuration") {
    withFixture("sip-state-revision") { f =>
      f.seed(); f.accept(AdvanceSipClock(25L))
      f.accept(ObserveSipDueSlot(0L, 10L)); f.accept(ObserveSipDueSlot(1L, 20L))
      val next = config.copy(revision = RevisionId("revision-2"), effectiveSlot = 30L, amount = Money(BigDecimal("200.00"), "CNY"))
      f.accept(ReviseSipPlan(next))
      f.refuse(TriggerSipInstallment(0L, 10L, next.revision, next), "SIP_REVISION_INTERVAL")
      f.accept(TriggerSipInstallment(0L, 10L, config.revision, config))
      f.accept(TriggerSipInstallment(1L, 20L, config.revision, config))
      f.accept(AdvanceSipClock(30L)); f.accept(ObserveSipDueSlot(2L, 30L))
      f.refuse(TriggerSipInstallment(2L, 30L, config.revision, config), "SIP_REVISION_INTERVAL")
      f.accept(TriggerSipInstallment(2L, 30L, next.revision, next))
      assert(f.state.occurrences(10L).config == config)
      assert(f.state.occurrences(30L).config == next)
      assert(f.state.revisionEnds == Map(config.revision -> 30L))
      f.recover()
      assert(f.state.occurrences(10L).config.amount.amount == BigDecimal("100.00"))
      assert(f.state.occurrences(30L).config.amount.amount == BigDecimal("200.00"))
    }
  }

  test("first-terminal aggregate guard counts once, excludes refund noncompletion and ignores late progress") {
    withFixture("sip-state-terminal-label-contract") { f =>
      f.seed(); f.accept(AdvanceSipClock(25L))
      f.accept(ObserveSipDueSlot(0L, 10L)); f.accept(ObserveSipDueSlot(1L, 20L))
      f.accept(TriggerSipInstallment(0L, 10L, config.revision, config)); f.accept(TriggerSipInstallment(1L, 20L, config.revision, config))
      val first = f.state.occurrences(10L); val second = f.state.occurrences(20L)
      f.accept(RecordSipInstallmentRefundInProgress(first))
      f.refuse(RecordSipInstallmentFailed(first, "refund-compensated", "r1", "body1"), "SIP_TERMINAL_EVIDENCE")
      assert(f.state.failureTotal == 0L)
      f.accept(RecordSipInstallmentFailed(first, "ta-rejected-refund-completed", "r1", "body1"))
      f.accept(RecordSipInstallmentSucceeded(second, "ta-confirmed", "r2", "body2"))
      val persisted = f.events
      assert(f.accept(RecordSipInstallmentSucceeded(second, "ta-confirmed", "r2", "body2")).isEmpty)
      f.refuse(RecordSipInstallmentFailed(second, "payment-compensated", "r3", "body3"), "SIP_TERMINAL_CONFLICT")
      f.refuse(RecordSipInstallmentSucceeded(second.copy(operationId = OperationId("substitute")), "ta-confirmed", "r2", "body2"), "SIP_ORIGINAL_ASSOCIATION")
      assert(f.accept(RecordSipInstallmentOutcomeUnknown(second)).isEmpty)
      assert(f.events == persisted)
      assert(f.state.failureTotal == 1L && f.state.successTotal == 1L && !f.state.paused)
      assert(f.state.occurrenceProgress(second.occurrenceId) == "succeeded")
      f.recover()
      assert(f.state.failureTotal == 1L && f.state.successTotal == 1L)
    }
  }
}
