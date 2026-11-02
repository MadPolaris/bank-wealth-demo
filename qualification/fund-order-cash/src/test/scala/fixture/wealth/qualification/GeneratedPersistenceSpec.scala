package fixture.wealth.qualification

import java.util.UUID
import akka.actor.typed.ActorRef
import akka.persistence.testkit.scaladsl.EventSourcedBehaviorTestKit
import fixture.wealth.qualification.application.aggregates.FundOrderProtocol._
import fixture.wealth.qualification.domain.entities.FundOrderEntity
import fixture.wealth.qualification.domain.entities.FundOrderEntity._
import fixture.wealth.qualification.domain.values.Money

final class GeneratedPersistenceSpec extends QualificationTestSupport {
  import QualificationSamples._
  private type Kit = EventSourcedBehaviorTestKit[FundOrderCommandFamily, FundOrderEvent, FundOrderState]
  private type Write = ActorRef[FundOrderReply] => FundOrderCommandFamily
  private type Result = EventSourcedBehaviorTestKit.CommandResultWithReply[FundOrderCommandFamily, FundOrderEvent, FundOrderState, FundOrderReply]

  private def kit(label: String, snapshots: Boolean = false): (Kit, String) = {
    val persistenceId = "fund-order-qualification-" + label + "-" + UUID.randomUUID().toString
    (EventSourcedBehaviorTestKit[FundOrderCommandFamily, FundOrderEvent, FundOrderState](system,
      FundOrderActor(id, persistenceId, snapshots),
      EventSourcedBehaviorTestKit.SerializationSettings.enabled.withVerifyEquality(true)), persistenceId)
  }
  private def query(kit: Kit): FundOrderState = {
    val result = kit.runCommand[GetFundOrderStateReply](GetFundOrderState(_))
    result.events shouldBe empty
    result.reply.state shouldBe result.state
    result.reply.state
  }
  private def run(kit: Kit, command: Write): Result = kit.runCommand[FundOrderReply](command)
  private def success(kit: Kit, command: Write, expected: FundOrderEvent): FundOrderState = {
    val result = run(kit, command)
    result.reply.error shouldBe None
    result.events shouldBe Seq(expected)
    val state = query(kit)
    state shouldBe result.state
    exactMoney(state.amount, amount)
    untouched(state)
    state
  }
  private def emptySuccess(kit: Kit, command: Write): Unit = {
    val before = query(kit)
    val result = run(kit, command)
    result.reply.error shouldBe None
    result.events shouldBe empty
    query(kit) shouldBe before
  }
  private def reject(kit: Kit, command: Write, code: String): Unit = {
    val before = query(kit)
    val result = run(kit, command)
    result.reply.error.map(_.code) shouldBe Some(code)
    result.events shouldBe empty
    query(kit) shouldBe before
  }
  private def restart(kit: Kit): FundOrderState = {
    val before = query(kit)
    val restored = kit.restart().state
    restored shouldBe before
    if (before.amount != null) exactMoney(restored.amount, before.amount)
    before.reservedSubscriptions.foreach { case (key, money) => exactMoney(restored.reservedSubscriptions(key), money) }
    before.committedSubscriptions.foreach { case (key, money) => exactMoney(restored.committedSubscriptions(key), money) }
    before.compensatedSubscriptions.foreach { case (key, money) => exactMoney(restored.compensatedSubscriptions(key), money) }
    query(kit) shouldBe restored
    untouched(restored)
    restored
  }
  private val request: Write = reply => RequestFundPurchaseSettlement(operationId, id, investor, collection, fund, amount, reply)
  private val reserve: Write = reply => ReserveFundSubscription(txid, id, amount, reply)
  private val confirm: Write = reply => ConfirmFundSubscriptionPayment(txid, id, reply)
  private val cancel: Write = reply => CancelCashFundSubscription(txid, id, reply)
  private val succeeded: Write = reply => RecordFundCashPaymentSucceeded(txid, reply)
  private val rejected: Write = reply => RecordFundCashPaymentRejectedBeforeEffects(txid, reply)
  private val compensated: Write = reply => RecordFundCashPaymentCompensated(txid, reply)
  private val recovery: Write = reply => RecordFundCashPaymentRecoveryRequired(txid, reply)
  private val unknown: Write = reply => RecordFundCashPaymentOutcomeUnknown(txid, reply)
  private def create(kit: Kit): Unit = {
    success(kit, request, FundPurchaseSettlementRequested(operationId, id, investor, collection, fund, amount))
    restart(kit).status shouldBe "REQUESTED"
  }

  "Persistent actor wired only to generated commands/helpers/rules/folds" should {
    "query and recover the actual empty/null state without initialization fixtures" in {
      val (k, _) = kit("empty")
      query(k) shouldBe FundOrderEntity.empty(id)
      query(k).amount shouldBe null
      query(k).taConfirmedShares shouldBe null
      reject(k, reserve, "AGG_NOT_INITIALIZED")
      reject(k, confirm, "AGG_NOT_INITIALIZED")
      reject(k, cancel, "AGG_NOT_INITIALIZED")
      restart(k) shouldBe FundOrderEntity.empty(id)
    }
    "persist request, reserve, commit, all recoverable observations then succeeded, recovering every stage" in {
      val (k, _) = kit("success")
      create(k)
      reject(k, request, "62100")
      success(k, reserve, ReserveFundSubscriptionConfirmed(txid, amount))
      val prepared = restart(k)
      prepared.status shouldBe "SUBSCRIPTION_RESERVED"
      exactMoney(prepared.reservedSubscriptions(txid), amount)
      emptySuccess(k, reserve)
      reject(k, reply => ReserveFundSubscription(txid, "other-order", amount, reply), "62180")
      reject(k, reply => ReserveFundSubscription(txid, id, Money(BigDecimal.exact("0.00"), "CNY"), reply), "62180")
      reject(k, reply => ReserveFundSubscription("other-tx", id, amount, reply), "62180")
      success(k, confirm, FundSubscriptionPaymentConfirmed(txid))
      val committed = restart(k)
      committed.status shouldBe "PAYMENT_SETTLED"
      committed.selectedPaymentTxId shouldBe txid
      committed.reservedSubscriptions shouldBe Map.empty
      exactMoney(committed.committedSubscriptions(txid), amount)
      reject(k, confirm, "62181") // Actual source is reject-on-repeat, not synthetic idempotency.
      reject(k, cancel, "62185")
      reject(k, rejected, "62144")
      reject(k, compensated, "62144")
      success(k, unknown, FundCashPaymentOutcomeUnknown(txid))
      restart(k).cashPaymentFinalResults shouldBe Map.empty
      success(k, recovery, FundCashPaymentRecoveryRequired(txid))
      val unresolved = restart(k)
      unresolved.cashPaymentResults shouldBe Map(txid -> "recovery-required")
      unresolved.cashPaymentFinalResults shouldBe Map.empty
      success(k, succeeded, FundCashPaymentSucceeded(txid))
      val finalState = restart(k)
      finalState.cashPaymentResults shouldBe Map(txid -> "succeeded")
      finalState.cashPaymentFinalResults shouldBe Map(txid -> "succeeded")
      finalState.status shouldBe "PAYMENT_SETTLED"
      emptySuccess(k, succeeded)
      reject(k, reply => RecordFundCashPaymentSucceeded("other-tx", reply), "62140")
      reject(k, rejected, "62141")
      reject(k, compensated, "62141")
      reject(k, unknown, "62141")
      reject(k, recovery, "62141")
      restart(k) shouldBe finalState
    }
    "persist pre-Prepare cancel and retain its fence after actor restart and terminal compensation" in {
      val (k, _) = kit("cancel-before-prepare")
      create(k)
      success(k, cancel, FundCashSubscriptionCanceled(txid))
      val canceled = restart(k)
      canceled.status shouldBe "CANCELED"
      canceled.reservedSubscriptions shouldBe Map.empty
      exactMoney(canceled.compensatedSubscriptions(txid), amount)
      emptySuccess(k, cancel)
      reject(k, reply => CancelCashFundSubscription(txid, "other-order", reply), "62183")
      reject(k, reply => CancelCashFundSubscription("other-tx", id, reply), "62184")
      reject(k, reserve, "62180")
      reject(k, confirm, "62181")
      success(k, compensated, FundCashPaymentCompensated(txid))
      val finalState = restart(k)
      finalState.cashPaymentFinalResults shouldBe Map(txid -> "compensated")
      finalState.cashPaymentResults shouldBe Map(txid -> "compensated")
      emptySuccess(k, compensated)
      emptySuccess(k, cancel)
      reject(k, reserve, "62180")
      reject(k, succeeded, "62141")
      reject(k, rejected, "62141")
      reject(k, recovery, "62141")
      reject(k, unknown, "62141")
    }
    "release a persisted prepared reservation through generated put/remove operations after recovery" in {
      val (k, _) = kit("cancel-prepared")
      create(k)
      success(k, reserve, ReserveFundSubscriptionConfirmed(txid, amount))
      restart(k)
      success(k, cancel, FundCashSubscriptionCanceled(txid))
      val canceled = restart(k)
      canceled.reservedSubscriptions shouldBe Map.empty
      exactMoney(canceled.compensatedSubscriptions(txid), amount)
      emptySuccess(k, cancel)
      reject(k, reserve, "62180")
    }
    "permit unknown/recovery to rejected-before-effects without a prior prepare or commit" in {
      val (k, _) = kit("early-rejection")
      create(k)
      reject(k, succeeded, "62143")
      success(k, unknown, FundCashPaymentOutcomeUnknown(txid))
      restart(k).cashPaymentFinalResults shouldBe Map.empty
      success(k, recovery, FundCashPaymentRecoveryRequired(txid))
      restart(k).cashPaymentFinalResults shouldBe Map.empty
      reject(k, reply => RecordFundCashPaymentRejectedBeforeEffects("other-tx", reply), "62140")
      success(k, rejected, FundCashPaymentRejectedBeforeEffects(txid))
      val finalState = restart(k)
      finalState.status shouldBe "REQUESTED"
      finalState.committedSubscriptions shouldBe Map.empty
      finalState.cashPaymentResults shouldBe Map(txid -> "rejected-before-effects")
      finalState.cashPaymentFinalResults shouldBe Map(txid -> "rejected-before-effects")
      emptySuccess(k, rejected)
      reject(k, compensated, "62141")
      reject(k, succeeded, "62141")
      reject(k, recovery, "62141")
      reject(k, unknown, "62141")
      reject(k, reserve, "62180")
    }
    "permit early compensated publication without claiming its sender was authenticated" in {
      val (k, _) = kit("early-compensation")
      create(k)
      success(k, compensated, FundCashPaymentCompensated(txid))
      val state = restart(k)
      state.status shouldBe "REQUESTED"
      state.compensatedSubscriptions shouldBe Map.empty
      state.committedSubscriptions shouldBe Map.empty
      state.cashPaymentFinalResults shouldBe Map(txid -> "compensated")
      emptySuccess(k, compensated)
      reject(k, reserve, "62180")
    }
    "store real serialized snapshots and recover the final snapshot with the journal removed" in {
      val (k, persistenceId) = kit("snapshot", snapshots = true)
      val snapshots = k.snapshotTestKit.getOrElse(fail("SnapshotTestKit is required"))
      val requested = success(k, request, FundPurchaseSettlementRequested(operationId, id, investor, collection, fund, amount))
      snapshots.expectNextPersisted(persistenceId, requested)
      restart(k).status shouldBe "REQUESTED"
      val prepared = success(k, reserve, ReserveFundSubscriptionConfirmed(txid, amount))
      snapshots.expectNextPersisted(persistenceId, prepared)
      restart(k).status shouldBe "SUBSCRIPTION_RESERVED"
      val committed = success(k, confirm, FundSubscriptionPaymentConfirmed(txid))
      snapshots.expectNextPersisted(persistenceId, committed)
      val successState = success(k, succeeded, FundCashPaymentSucceeded(txid))
      snapshots.expectNextPersisted(persistenceId, successState)
      val stored = snapshots.persistedInStorage(persistenceId)
      stored.nonEmpty shouldBe true
      val last = stored.maxBy(_._1.sequenceNr)._2.asInstanceOf[FundOrderState]
      last shouldBe successState
      exactMoney(last.amount, amount)
      exactMoney(last.committedSubscriptions(txid), amount)
      last.taConfirmedShares shouldBe null
      // Explicitly erase the test journal: equality after restart now requires the snapshot.
      k.persistenceTestKit.clearByPersistenceId(persistenceId)
      val restored = restart(k)
      restored shouldBe successState
      restored.cashPaymentFinalResults shouldBe Map(txid -> "succeeded")
      emptySuccess(k, succeeded)
      reject(k, unknown, "62141")
      reject(k, confirm, "62181")
    }
    "recover a snapshot containing the canceled fence and continue rejecting late Prepare" in {
      val (k, persistenceId) = kit("cancel-snapshot", snapshots = true)
      val snapshots = k.snapshotTestKit.getOrElse(fail("SnapshotTestKit is required"))
      val requested = success(k, request, FundPurchaseSettlementRequested(operationId, id, investor, collection, fund, amount))
      snapshots.expectNextPersisted(persistenceId, requested)
      val canceled = success(k, cancel, FundCashSubscriptionCanceled(txid))
      snapshots.expectNextPersisted(persistenceId, canceled)
      k.persistenceTestKit.clearByPersistenceId(persistenceId)
      val restored = restart(k)
      exactMoney(restored.compensatedSubscriptions(txid), amount)
      emptySuccess(k, cancel)
      reject(k, reserve, "62180")
    }
  }
}
