package fixture.wealth.qualification

import fixture.wealth.qualification.domain.entities.FundOrderEntity
import fixture.wealth.qualification.domain.entities.FundOrderEntity._
import fixture.wealth.qualification.domain.entities.behaviors.FundOrderEventHandler
import fixture.wealth.qualification.domain.invariant.FundOrderRules._
import fixture.wealth.qualification.domain.invariant.params.FundOrderRuleParams._
import fixture.wealth.qualification.domain.values.Money
import net.imadz.common.CommonTypes.iMadzError

final class GeneratedRulesSpec extends QualificationTestSupport {
  import QualificationSamples._
  private val empty = FundOrderEntity.empty(id)
  private val request = RequestFundPurchaseSettlementParams(operationId, id, investor, collection, fund, amount)
  private val reserve = ReserveFundSubscriptionParams(txid, id, amount)
  private val confirm = ConfirmFundSubscriptionPaymentParams(txid, id)
  private val cancel = CancelCashFundSubscriptionParams(txid, id)
  private type Decision = Either[iMadzError, List[FundOrderEvent]]
  private def error(decision: Decision, code: String): Unit = decision match {
    case Left(e) => e.code shouldBe code
    case Right(events) => fail("Expected source rejection " + code + ", got " + events)
  }
  private def events(decision: Decision): List[FundOrderEvent] = decision match {
    case Right(result) => result
    case Left(e) => fail("Unexpected source rejection " + e.code + ": " + e.message)
  }
  // Tests also use the generated event handler; no alternative fold interpreter.
  private def evolve(state: FundOrderState, decision: Decision): FundOrderState =
    events(decision).foldLeft(state)(FundOrderEventHandler.apply)
  private def requested = evolve(empty, RequestFundPurchaseSettlementRule(empty, request))
  private def reserved = evolve(requested, ReserveFundSubscriptionRule(requested, reserve))
  private def committed = evolve(reserved, ConfirmFundSubscriptionPaymentRule(reserved, confirm))

  "Source-generated creation rules" should {
    "keep the actual empty state and reject noncreation before command-specific guards" in {
      empty.amount shouldBe null
      empty.taConfirmedShares shouldBe null
      empty.status shouldBe ""
      empty.contractVersion shouldBe ""
      error(ReserveFundSubscriptionRule(empty, reserve), "AGG_NOT_INITIALIZED")
      error(ConfirmFundSubscriptionPaymentRule(empty, confirm), "AGG_NOT_INITIALIZED")
      error(CancelCashFundSubscriptionRule(empty, cancel), "AGG_NOT_INITIALIZED")
      error(RecordFundCashPaymentOutcomeUnknownRule(empty, RecordFundCashPaymentOutcomeUnknownParams(txid)), "AGG_NOT_INITIALIZED")
    }
    "enforce creation then identity then positive amount then CNY then fund code in author order" in {
      val bad = request.copy(fundOrderId = "wrong", amount = Money(BigDecimal.exact("0.00"), "USD"), fundCode = "")
      error(RequestFundPurchaseSettlementRule(requested, bad), "62100")
      error(RequestFundPurchaseSettlementRule(empty, bad), "62101")
      error(RequestFundPurchaseSettlementRule(empty, bad.copy(fundOrderId = id)), "62004")
      error(RequestFundPurchaseSettlementRule(empty, request.copy(investorAccountId = collection)), "62101")
      error(RequestFundPurchaseSettlementRule(empty, request.copy(amount = null)), "62004")
      error(RequestFundPurchaseSettlementRule(empty, request.copy(amount = Money(BigDecimal.exact("-0.01"), "CNY"))), "62004")
      error(RequestFundPurchaseSettlementRule(empty, request.copy(amount = Money(BigDecimal.exact("1.00"), "USD"), fundCode = "")), "62102")
      error(RequestFundPurchaseSettlementRule(empty, request.copy(fundCode = "")), "62103")
    }
    "construct and fold the precise source event without inventing confirmed shares" in {
      events(RequestFundPurchaseSettlementRule(empty, request)) shouldBe
        List(FundPurchaseSettlementRequested(operationId, id, investor, collection, fund, amount))
      val state = requested
      state.id shouldBe id
      state.status shouldBe "REQUESTED"
      state.contractVersion shouldBe "cash-purchase-v2"
      state.operationId shouldBe operationId
      state.investorAccountId shouldBe investor
      state.fundCollectionAccountId shouldBe collection
      state.fundCode shouldBe fund
      exactMoney(state.amount, amount)
      untouched(state)
    }
    "retain the emitter aggregate status guard instead of silently dropping it" in {
      error(ReserveFundSubscriptionRule(requested.copy(status = "not-in-source-enum"), reserve), "FUNDORDER_STATUS_INVALID")
    }
  }

  "Source-generated prepare/commit/cancel rules" should {
    "allow exact reserve duplicates only after resource, amount and stable txid guards" in {
      events(ReserveFundSubscriptionRule(requested, reserve)) shouldBe List(ReserveFundSubscriptionConfirmed(txid, amount))
      events(ReserveFundSubscriptionRule(reserved, reserve)) shouldBe Nil
      error(ReserveFundSubscriptionRule(reserved, reserve.copy(resource = "wrong")), "62180")
      error(ReserveFundSubscriptionRule(reserved, reserve.copy(amount = Money(BigDecimal.exact("0.00"), "CNY"))), "62180")
      error(ReserveFundSubscriptionRule(reserved, reserve.copy(txid = "other-tx")), "62180")
      exactMoney(reserved.reservedSubscriptions(txid), amount)
      exactMoney(reserved.amount, amount)
      reserved.status shouldBe "SUBSCRIPTION_RESERVED"
    }
    "move the original reservation to the original committed marker and reject repeated confirm" in {
      error(ConfirmFundSubscriptionPaymentRule(requested, confirm), "62181")
      error(ConfirmFundSubscriptionPaymentRule(reserved, confirm.copy(resource = "wrong")), "62181")
      events(ConfirmFundSubscriptionPaymentRule(reserved, confirm)) shouldBe List(FundSubscriptionPaymentConfirmed(txid))
      committed.reservedSubscriptions shouldBe Map.empty
      exactMoney(committed.committedSubscriptions(txid), amount)
      exactMoney(committed.amount, amount)
      committed.selectedPaymentTxId shouldBe txid
      committed.status shouldBe "PAYMENT_SETTLED"
      error(ConfirmFundSubscriptionPaymentRule(committed, confirm), "62181")
      error(CancelCashFundSubscriptionRule(committed, cancel), "62185")
      untouched(committed)
    }
    "cancel before Prepare by a durable fence and reject late Prepare and wrong identities" in {
      val canceled = evolve(requested, CancelCashFundSubscriptionRule(requested, cancel))
      canceled.status shouldBe "CANCELED"
      canceled.reservedSubscriptions shouldBe Map.empty
      exactMoney(canceled.compensatedSubscriptions(txid), amount)
      events(CancelCashFundSubscriptionRule(canceled, cancel)) shouldBe Nil
      error(CancelCashFundSubscriptionRule(canceled, cancel.copy(resource = "wrong")), "62183")
      error(CancelCashFundSubscriptionRule(canceled, cancel.copy(txid = "wrong-tx")), "62184")
      error(ReserveFundSubscriptionRule(canceled, reserve), "62180")
      error(ConfirmFundSubscriptionPaymentRule(canceled, confirm), "62181")
    }
    "release an existing reservation through the generated remove/put fold" in {
      val canceled = evolve(reserved, CancelCashFundSubscriptionRule(reserved, cancel))
      canceled.reservedSubscriptions shouldBe Map.empty
      exactMoney(canceled.compensatedSubscriptions(txid), amount)
      exactMoney(canceled.amount, amount)
      events(CancelCashFundSubscriptionRule(canceled, cancel)) shouldBe Nil
      untouched(canceled)
    }
  }

  "Source-generated cash outcome rules" should {
    "allow early unknown/recovery/rejected/compensated without commit but require commit for succeeded" in {
      error(RecordFundCashPaymentSucceededRule(requested, RecordFundCashPaymentSucceededParams(txid)), "62143")
      val unknown = evolve(requested, RecordFundCashPaymentOutcomeUnknownRule(requested, RecordFundCashPaymentOutcomeUnknownParams(txid)))
      unknown.cashPaymentResults shouldBe Map(txid -> "outcome-unknown")
      unknown.cashPaymentFinalResults shouldBe Map.empty
      val recovery = evolve(unknown, RecordFundCashPaymentRecoveryRequiredRule(unknown, RecordFundCashPaymentRecoveryRequiredParams(txid)))
      recovery.cashPaymentResults shouldBe Map(txid -> "recovery-required")
      recovery.cashPaymentFinalResults shouldBe Map.empty
      val rejected = evolve(recovery, RecordFundCashPaymentRejectedBeforeEffectsRule(recovery, RecordFundCashPaymentRejectedBeforeEffectsParams(txid)))
      rejected.cashPaymentResults shouldBe Map(txid -> "rejected-before-effects")
      rejected.cashPaymentFinalResults shouldBe Map(txid -> "rejected-before-effects")
      val compensated = evolve(requested, RecordFundCashPaymentCompensatedRule(requested, RecordFundCashPaymentCompensatedParams(txid)))
      compensated.cashPaymentFinalResults shouldBe Map(txid -> "compensated")
      compensated.status shouldBe "REQUESTED"
      compensated.committedSubscriptions shouldBe Map.empty
      // This only proves rule semantics; there is no authenticated sender/start bridge here.
      untouched(rejected)
      untouched(compensated)
    }
    "advance nonterminal observations to succeeded and retain separate final/current ledgers" in {
      val unknown = evolve(committed, RecordFundCashPaymentOutcomeUnknownRule(committed, RecordFundCashPaymentOutcomeUnknownParams(txid)))
      val recovery = evolve(unknown, RecordFundCashPaymentRecoveryRequiredRule(unknown, RecordFundCashPaymentRecoveryRequiredParams(txid)))
      val success = evolve(recovery, RecordFundCashPaymentSucceededRule(recovery, RecordFundCashPaymentSucceededParams(txid)))
      success.cashPaymentResults shouldBe Map(txid -> "succeeded")
      success.cashPaymentFinalResults shouldBe Map(txid -> "succeeded")
      success.status shouldBe "PAYMENT_SETTLED"
      exactMoney(success.committedSubscriptions(txid), amount)
      events(RecordFundCashPaymentSucceededRule(success, RecordFundCashPaymentSucceededParams(txid))) shouldBe Nil
      error(RecordFundCashPaymentSucceededRule(success, RecordFundCashPaymentSucceededParams("other-tx")), "62140")
      error(RecordFundCashPaymentCompensatedRule(success, RecordFundCashPaymentCompensatedParams(txid)), "62141")
      error(RecordFundCashPaymentRejectedBeforeEffectsRule(success, RecordFundCashPaymentRejectedBeforeEffectsParams(txid)), "62141")
      error(RecordFundCashPaymentRecoveryRequiredRule(success, RecordFundCashPaymentRecoveryRequiredParams(txid)), "62141")
      error(RecordFundCashPaymentOutcomeUnknownRule(success, RecordFundCashPaymentOutcomeUnknownParams(txid)), "62141")
      untouched(success)
    }
    "reject compensated/rejected facts after commit and reject identity drift before later guards" in {
      error(RecordFundCashPaymentCompensatedRule(committed, RecordFundCashPaymentCompensatedParams(txid)), "62144")
      error(RecordFundCashPaymentRejectedBeforeEffectsRule(committed, RecordFundCashPaymentRejectedBeforeEffectsParams(txid)), "62144")
      error(RecordFundCashPaymentSucceededRule(committed, RecordFundCashPaymentSucceededParams("other-tx")), "62140")
    }
    "keep same rejected/compensated finals empty but reject conflicting finals and nonterminal regression" in {
      val rejected = evolve(requested, RecordFundCashPaymentRejectedBeforeEffectsRule(requested, RecordFundCashPaymentRejectedBeforeEffectsParams(txid)))
      events(RecordFundCashPaymentRejectedBeforeEffectsRule(rejected, RecordFundCashPaymentRejectedBeforeEffectsParams(txid))) shouldBe Nil
      error(RecordFundCashPaymentSucceededRule(rejected, RecordFundCashPaymentSucceededParams(txid)), "62141")
      error(RecordFundCashPaymentOutcomeUnknownRule(rejected, RecordFundCashPaymentOutcomeUnknownParams(txid)), "62141")
      val canceled = evolve(requested, CancelCashFundSubscriptionRule(requested, cancel))
      val compensated = evolve(canceled, RecordFundCashPaymentCompensatedRule(canceled, RecordFundCashPaymentCompensatedParams(txid)))
      events(RecordFundCashPaymentCompensatedRule(compensated, RecordFundCashPaymentCompensatedParams(txid))) shouldBe Nil
      events(CancelCashFundSubscriptionRule(compensated, cancel)) shouldBe Nil
      error(RecordFundCashPaymentRejectedBeforeEffectsRule(compensated, RecordFundCashPaymentRejectedBeforeEffectsParams(txid)), "62141")
      error(RecordFundCashPaymentRecoveryRequiredRule(compensated, RecordFundCashPaymentRecoveryRequiredParams(txid)), "62141")
    }
    "leave every unrelated complete-state TA/refund/legacy field unchanged under each result fold" in {
      Seq[FundOrderEvent](FundCashPaymentSucceeded(txid), FundCashPaymentRejectedBeforeEffects(txid),
        FundCashPaymentCompensated(txid), FundCashPaymentRecoveryRequired(txid), FundCashPaymentOutcomeUnknown(txid)).foreach { event =>
        val result = FundOrderEventHandler.apply(fullState, event)
        result.copy(cashPaymentResults = fullState.cashPaymentResults,
          cashPaymentFinalResults = fullState.cashPaymentFinalResults) shouldBe fullState
        exact(result.taConfirmedShares.shares, share.shares)
        exact(result.taConfirmedShares.nav, share.nav)
      }
    }
  }
}
