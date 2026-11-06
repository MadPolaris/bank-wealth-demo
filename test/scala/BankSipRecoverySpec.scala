import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import akka.persistence.testkit.SnapshotMeta
import akka.persistence.testkit.scaladsl.SnapshotTestKit
import example.bankwealth.application.{bank_sip_dispatch_v1Execution => Dispatch}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.service.BankServiceService._
import net.imadz.monarch.persistence.PersistentMonarch
import org.scalatest.funsuite.AnyFunSuite

/** Recovery reopens generated actors over the same serialized testkit journal. Positive
  * evidence comes only from real commands/execution; malformed PB snapshots below are
  * deliberately corrupt durable inputs for rejection tests, never financial authority.
  * These are same-JVM unit tests, not a cross-JVM/disk or application-bootstrap claim.
  */
final class BankSipRecoverySpec extends AnyFunSuite {
  private def withHarness(test: BankSipApplicationHarness => Unit): Unit = {
    val h = new BankSipApplicationHarness; try test(h) finally h.close()
  }
  private def starts(h: BankSipApplicationHarness, o: SipOccurrence): Vector[PersistentMonarch.RunStarted] =
    h.persisted(h.ids.sipRun(o.occurrenceId)).collect { case e: PersistentMonarch.RunStarted => e }

  test("intent-only, create-only, each exact append prefix and pre-seal gaps recover the original complete schedule") { withHarness { h =>
    // -1 means intent only; 0 means Create but no append; 2 is the pre-Seal gap.
    (-1 to 2).foreach { count =>
      val key = "prefix-" + count
      val intent = h.intent(h.request(key))
      h.accept(intent.planId, SipPlanProtocol.RecordSipCreateIntent(intent, Some(intent)))
      if (count >= 0) h.accept(intent.planId, SipPlanProtocol.CreateSipPlan(intent.planId, intent.config))
      intent.request.dueSlots.zipWithIndex.take(math.max(0, count)).foreach { case (slot, position) =>
        h.accept(intent.planId, SipPlanProtocol.AppendSipDueSlot(position.toLong, slot))
      }
      val before = h.persisted(h.ids.plan(intent.planId))
      assert(before.head.isInstanceOf[SipPlanSipCreateIntentRecordedPB])
      h.restartApplication(); h.restartPlan(intent.planId)
      assert(h.await(h.app.recoverExisting(intent.planId)) == Right(()))
      val s = h.planState(intent.planId)
      assert(s.createIntent.contains(intent) && s.createIntentDueSlots == intent.request.dueSlots)
      assert(s.slots == Map(0L -> 10L, 1L -> 20L) && s.intentAppendedDueSlots == Map(10L -> 0L, 20L -> 1L))
      assert(s.initialized && s.scheduleSealed && s.scheduleCount == 2L && s.currentTick == -1L)
      assert(s.occurrences.isEmpty)
      val events = h.persisted(h.ids.plan(intent.planId))
      assert(events.take(before.size) == before)
      assert(events.count(_.isInstanceOf[SipPlanSipCreateIntentRecordedPB]) == 1)
      assert(events.count(_.isInstanceOf[SipPlanSipPlanCreatedPB]) == 1)
      assert(events.collect { case p: SipPlanSipDueSlotAppendedPB => p.f0 -> p.f1 } == Vector(0L -> 10L, 1L -> 20L))
      assert(events.count(_.isInstanceOf[SipPlanSipScheduleSealedPB]) == 1)
      assert(h.await(h.app.recoverExisting(intent.planId)).isRight)
      assert(h.persisted(h.ids.plan(intent.planId)) == events)
    }
    assert(h.dispatchAttempts.isEmpty && h.balance(h.investorId).amount == BigDecimal("1000.00"))
  } }

  test("recovery re-admits persisted wire amounts, identities and complete finite schedules before looking up the plan") { withHarness { h =>
    val base = h.intent(h.request())
    val badBodies = Vector(
      base.copy(request = base.request.copy(amount = MoneyWire("20000", "CNY"))),
      base.copy(request = base.request.copy(dueSlots = Vector(10L, 10L))),
      base.copy(request = base.request.copy(dueSlots = Vector(20L, 10L))),
      base.copy(request = base.request.copy(dueSlots = Vector(-1L, 10L))),
      base.copy(request = base.request.copy(dueSlots = (0L to 1024L).toVector)),
      base.copy(request = base.request.copy(effectiveSlot = 11L), config = base.config.copy(effectiveSlot = 11L)),
      base.copy(authorityVersion = "untrusted-version"),
      base.copy(config = base.config.copy(investorAccountId = h.bobId)))
    badBodies.zipWithIndex.foreach { case (bad, position) =>
      val key = "invalid-" + position
      val intent = bad.copy(clientRequestId = key, request = bad.request.copy(clientRequestId = key), planId = h.planId(key))
      // The generated internal command does not replace trusted application admission.
      h.accept(intent.planId, SipPlanProtocol.RecordSipCreateIntent(intent, Some(intent)))
      val before = h.persisted(h.ids.plan(intent.planId))
      h.restartApplication(); h.restartPlan(intent.planId)
      val lookups = h.planLookups
      assert(h.await(h.app.recoverExisting(intent.planId)) == Left(RequestConflict))
      assert(h.planLookups == lookups && h.persisted(h.ids.plan(intent.planId)) == before)
    }
    assert(h.dispatchAttempts.isEmpty && h.balance(h.investorId).amount == BigDecimal("1000.00"))
  } }

  test("member-only append is not an exact prefix and recovery must not fill, seal or dispatch it") { withHarness { h =>
    val intent = h.intent(h.request())
    h.accept(intent.planId, SipPlanProtocol.RecordSipCreateIntent(intent, Some(intent)))
    h.accept(intent.planId, SipPlanProtocol.CreateSipPlan(intent.planId, intent.config))
    // The existing generated guard allows a member at position zero; C must reject it.
    h.accept(intent.planId, SipPlanProtocol.AppendSipDueSlot(0L, 20L))
    val before = h.persisted(h.ids.plan(intent.planId))
    h.restartApplication(); h.restartPlan(intent.planId)
    assert(h.await(h.app.recoverExisting(intent.planId)) == Left(RequestConflict))
    assert(h.persisted(h.ids.plan(intent.planId)) == before)
    assert(!h.planState().scheduleSealed && h.planState().slots == Map(0L -> 20L))
    assert(h.dispatchAttempts.isEmpty)
  } }

  test("corrupt positional order, gaps, extras, duplicate slots and incomplete sealing fail closed in recovered generated state") { withHarness { h =>
    val corrupt = Vector(
      ("wrong-order", Vector(0L -> 20L, 1L -> 10L), false),
      ("gap", Vector(1L -> 10L), false),
      ("extra", Vector(0L -> 10L, 1L -> 20L, 2L -> 30L), false),
      ("duplicate", Vector(0L -> 10L, 1L -> 10L), false),
      ("sealed-prefix", Vector(0L -> 10L), true))
    corrupt.foreach { case (key, slots, sealedEarly) =>
      val intent = h.intent(h.request(key))
      h.accept(intent.planId, SipPlanProtocol.RecordSipCreateIntent(intent, Some(intent)))
      h.accept(intent.planId, SipPlanProtocol.CreateSipPlan(intent.planId, intent.config))
      val appended = slots.foldLeft(h.planState(intent.planId)) { case (s, (position, slot)) =>
        SipPlanEventHandler(s, SipPlanProtocol.SipDueSlotAppended(position, slot))
      }
      val corruptState = if (sealedEarly) SipPlanEventHandler(appended, SipPlanProtocol.SipScheduleSealed(true)) else appended
      val pid = h.ids.plan(intent.planId)
      val events = h.persisted(pid)
      h.restartPlan(intent.planId)
      // persistForRecovery(raw PB events) supplies no event-adapter manifest and stops
      // replay before C can validate the prefix. Keep the real journal, inject only
      // the intended structural corruption through the generated PB snapshot adapter.
      SnapshotTestKit(h.system).persistForRecovery(pid,
        SnapshotMeta(events.size.toLong) -> DomainConverters.encodeSipPlanStatePB(corruptState))
      h.restartApplication()
      assert(h.await(h.app.recoverExisting(intent.planId)) == Left(RequestConflict))
      assert(h.planState(intent.planId) == corruptState)
      assert(h.persisted(pid) == events)
    }
    assert(h.dispatchAttempts.isEmpty && h.balance(h.investorId).amount == BigDecimal("1000.00"))
  } }

  test("durable occurrences survive the pre-dispatch gap and recovered real parents start once without a second debit") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request())).isRight)
    h.failDispatch = true
    assert(h.await(h.app.tick(h.operator, BankTick(20L))) == Left(Unavailable))
    val retained = h.planState()
    val occurrences = retained.occurrences.toVector.sortBy(_._1).map(_._2)
    assert(occurrences.size == 2 && retained.firstTerminals.isEmpty)
    assert(h.dispatchAttempts == occurrences.map(_.occurrenceId))
    occurrences.foreach { o =>
      assert(starts(h, o).isEmpty && h.persisted(h.ids.paymentRun(o.operationId)).isEmpty)
      assert(h.persisted(h.ids.plan(o.planId)).exists {
        case p: SipPlanSipInstallmentTriggeredPB => DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(p).occurrence == o
        case _ => false
      })
    }
    assert(h.balance(h.investorId).amount == BigDecimal("1000.00"))
    h.restartApplication(); h.restartPlan(h.planId()); h.failDispatch = false
    assert(h.await(h.app.recoverExisting(h.planId())) == Right(()))
    h.finishCash(2); h.finishDispatch(2)
    occurrences.foreach { o =>
      val originalStarts = starts(h, o)
      assert(originalStarts.size == 1 && originalStarts.head.runId == o.occurrenceId.value)
      assert(originalStarts.head.stageCursors == Vector("dispatch-cash#0"))
      assert(Dispatch.codec.decode(originalStarts.head.initialSnapshot).inputs == Dispatch.Inputs(o.occurrenceId, o))
      assert(h.persisted(h.ids.paymentRun(o.operationId)).count(_.isInstanceOf[PersistentMonarch.RunStarted]) == 1)
    }
    val debits = h.persisted(h.ids.account(h.investorId))
    h.restartApplication(); h.restartPlan(h.planId()); h.restartExecutionGraph()
    assert(h.await(h.app.recoverExisting(h.planId())).isRight)
    assert(h.planState().occurrences == retained.occurrences && h.planState().firstTerminals.isEmpty)
    assert(h.planState().successTotal == 0L && h.planState().failureTotal == 0L)
    assert(h.balance(h.investorId).amount == BigDecimal("800.00"))
    assert(h.persisted(h.ids.account(h.investorId)) == debits)
    occurrences.foreach(o => assert(starts(h, o).size == 1))
    assert(h.await(h.app.tick(h.operator, BankTick(19L))) == Left(RequestConflict))
  } }

  test("one unavailable earlier occurrence does not prevent the next due occurrence from actually starting") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request())).isRight)
    h.failDispatch = true
    assert(h.await(h.app.tick(h.operator, BankTick(20L))) == Left(Unavailable))
    val occurrences = h.planState().occurrences.toVector.sortBy(_._1).map(_._2)
    h.failDispatch = false; h.failDispatchFor = Set(occurrences.head.occurrenceId); h.dispatchAttempts = Vector.empty
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.recoverExisting(h.planId())) == Left(Unavailable))
    h.finishCash(1); h.finishDispatch(1)
    assert(h.dispatchAttempts == occurrences.map(_.occurrenceId))
    assert(starts(h, occurrences.head).isEmpty && starts(h, occurrences.last).size == 1)
    assert(h.balance(h.investorId).amount == BigDecimal("900.00") && h.planState().firstTerminals.isEmpty)
    h.failDispatchFor = Set.empty
    assert(h.await(h.app.recoverExisting(h.planId())).isRight)
    h.finishCash(1); h.finishDispatch(1)
    assert(h.balance(h.investorId).amount == BigDecimal("800.00"))
    occurrences.foreach(o => assert(starts(h, o).size == 1))
  } }

  test("recovery rejects a conflicting original dispatch snapshot rather than acknowledging a cached handle") { withHarness { h =>
    implicit val system: ActorSystem[_] = h.system
    implicit val timeout: Timeout = h.timeout
    assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L)))).isRight)
    h.failDispatch = true
    assert(h.await(h.app.tick(h.operator, BankTick(10L))) == Left(Unavailable))
    val o = h.planState().occurrences(10L)
    h.failDispatch = false
    val runtime = h.await(h.directory.ensureSipDispatch(o))
    assert(starts(h, o).isEmpty && h.persisted(h.ids.paymentRun(o.operationId)).isEmpty)
    val wrong = o.copy(config = o.config.copy(amount = Money(BigDecimal("200.00"), "CNY")))
    val reply = h.await(runtime.parent.ref.ask[PersistentMonarch.RunReply](r => PersistentMonarch.StartRun[Dispatch.State](
      o.occurrenceId.value, Dispatch.State(Dispatch.Inputs(o.occurrenceId, wrong)), r)))
    assert(reply.isInstanceOf[PersistentMonarch.Accepted])
    assert(h.await(h.app.recoverExisting(h.planId())) == Left(RequestConflict))
    assert(starts(h, o).size == 1 && h.persisted(h.ids.paymentRun(o.operationId)).isEmpty)
    assert(h.balance(h.investorId).amount == BigDecimal("1000.00") && h.planState().firstTerminals.isEmpty)
  } }

  test("pause recovery preserves pre-pause backlog, skips the entire paused interval and resumes without resurrection") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L, 20L, 25L, 30L, 40L)))).isRight)
    h.accept(h.planId(), SipPlanProtocol.AdvanceSipClock(25L))
    h.accept(h.planId(), SipPlanProtocol.PauseSipPlan(25L)) // Gap before observation.
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.recoverExisting(h.planId())).isRight)
    assert(h.planState().slotDisposition == Map(10L -> "backlog", 20L -> "backlog", 25L -> "skipped"))
    assert(h.planState().paused && h.planState().occurrences.isEmpty && h.dispatchAttempts.isEmpty)
    h.accept(h.planId(), SipPlanProtocol.AdvanceSipClock(40L)) // Gap before skip classification.
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.recoverExisting(h.planId())).isRight)
    assert(h.planState().slotDisposition == Map(10L -> "backlog", 20L -> "backlog", 25L -> "skipped", 30L -> "skipped", 40L -> "skipped"))
    assert(h.planState().observedCount == 5L && h.planState().startCount == 0L && h.dispatchAttempts.isEmpty)
    assert(h.await(h.app.resume(h.alice, BankPlanKey(h.planId()))).isRight)
    h.finishCash(2); h.finishDispatch(2)
    val resumed = h.planState()
    assert(!resumed.paused && resumed.pauseIntervals == Map(25L -> 40L))
    assert(resumed.occurrences.keySet == Set(10L, 20L) && resumed.startCount == 5L)
    assert(h.balance(h.investorId).amount == BigDecimal("800.00"))
    val before = h.persisted(h.ids.plan(h.planId()))
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.resume(h.alice, BankPlanKey(h.planId()))).isRight)
    assert(h.await(h.app.tick(h.operator, BankTick(40L))).isRight)
    assert(h.planState().occurrences == resumed.occurrences && h.persisted(h.ids.plan(h.planId())) == before)
  } }

  test("recovery retains each revision and already triggered occurrence before dispatching remaining backlog") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L, 20L, 30L)))).isRight)
    assert(h.await(h.app.revise(h.alice, BankSipRevisionInput(h.planId(),
      BankSipRevise(RevisionId("r2"), 20L, "fund", MoneyWire("20000", "CNY"))))).isRight)
    h.accept(h.planId(), SipPlanProtocol.AdvanceSipClock(30L))
    Vector(10L, 20L, 30L).zipWithIndex.foreach { case (slot, position) =>
      h.accept(h.planId(), SipPlanProtocol.ObserveSipDueSlot(position.toLong, slot))
    }
    val revisions = h.planState().revisions
    h.accept(h.planId(), SipPlanProtocol.TriggerSipInstallment(0L, 10L, RevisionId("initial"), revisions(RevisionId("initial"))))
    h.accept(h.planId(), SipPlanProtocol.TriggerSipInstallment(1L, 20L, RevisionId("r2"), revisions(RevisionId("r2"))))
    val retained = h.planState().occurrences
    h.failDispatch = true; h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.recoverExisting(h.planId())) == Left(Unavailable))
    assert(retained.forall { case (slot, o) => h.planState().occurrences.get(slot).contains(o) })
    assert(h.planState().occurrences(30L).config == revisions(RevisionId("r2")))
    assert(h.planState().revisions == revisions && h.planState().firstTerminals.isEmpty)
    h.failDispatch = false
    assert(h.await(h.app.recoverExisting(h.planId())).isRight)
    h.finishCash(3); h.finishDispatch(3)
    assert(h.balance(h.investorId).amount == BigDecimal("500.00"))
    assert(h.planState().occurrences.keySet == Set(10L, 20L, 30L))
  } }

  test("recovery never trusts a retained terminal lacking the original order's correlated evidence") { withHarness { h =>
    assert(h.await(h.app.create(h.alice, h.request(due = Vector(10L)))).isRight)
    h.failDispatch = true
    assert(h.await(h.app.tick(h.operator, BankTick(10L))) == Left(Unavailable))
    val o = h.planState().occurrences(10L)
    // Adversarial internal command: an evidence string alone is not trusted order proof.
    h.accept(h.planId(), SipPlanProtocol.RecordSipInstallmentSucceeded(o, "ta-confirmed", "forged-receipt", "forged-body"))
    val before = h.persisted(h.ids.plan(h.planId()))
    h.restartApplication(); h.restartPlan(h.planId())
    assert(h.await(h.app.recordTerminal(o)) == Left(RequestConflict))
    assert(h.await(h.app.recoverExisting(h.planId())) == Left(RequestConflict))
    assert(h.persisted(h.ids.plan(h.planId())) == before && starts(h, o).isEmpty)
    assert(h.balance(h.investorId).amount == BigDecimal("1000.00"))
  } }
}
