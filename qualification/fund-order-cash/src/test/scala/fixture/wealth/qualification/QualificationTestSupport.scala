package fixture.wealth.qualification

import akka.actor.testkit.typed.scaladsl.ScalaTestWithActorTestKit
import akka.persistence.testkit.scaladsl.EventSourcedBehaviorTestKit
import com.typesafe.config.ConfigFactory
import fixture.wealth.qualification.domain.entities.FundOrderEntity
import fixture.wealth.qualification.domain.entities.FundOrderEntity.FundOrderState
import fixture.wealth.qualification.domain.values.{FundShare, Money}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpecLike

abstract class QualificationTestSupport extends ScalaTestWithActorTestKit(
  ConfigFactory.parseResources("application.conf").withFallback(EventSourcedBehaviorTestKit.config).withFallback(ConfigFactory.load())
) with AnyWordSpecLike with Matchers {
  protected def exact(actual: BigDecimal, expected: BigDecimal): Unit = {
    actual.bigDecimal.unscaledValue shouldBe expected.bigDecimal.unscaledValue
    actual.bigDecimal.scale shouldBe expected.bigDecimal.scale
    actual.bigDecimal.toString shouldBe expected.bigDecimal.toString
  }
  protected def exactMoney(actual: Money, expected: Money): Unit = {
    actual.currency shouldBe expected.currency
    exact(actual.amount, expected.amount)
  }
  protected def untouched(state: FundOrderState): Unit = {
    state.confirmedShareLots shouldBe Map.empty
    state.sagaResults shouldBe Map.empty
    state.taRequestId shouldBe ""
    state.taReference shouldBe ""
    state.taStatus shouldBe ""
    state.taObservation shouldBe ""
    state.taReceipts shouldBe Map.empty
    state.taConfirmedShares shouldBe null
    state.taRejectionReason shouldBe ""
    state.taRequests shouldBe Map.empty
    state.refundOperationId shouldBe ""
    state.refundTxId shouldBe ""
    state.refundOutcome shouldBe ""
    state.refundResultReceipts shouldBe Map.empty
    state.refundFinalResults shouldBe Map.empty
    state.refundResultReceiptKinds shouldBe Map.empty
  }
}

object QualificationSamples {
  val id = "order-string-not-uuid"
  val txid = "cash/string/tx-1"
  val operationId = "purchase-operation-1"
  val investor = "investor-account"
  val collection = "collection-account"
  val fund = "DEMO-FUND"
  val amount = Money(BigDecimal.exact("123456789012345678901234567890123456.78"), "CNY")
  val share = FundShare(fund,
    BigDecimal.exact("12345678901234567890123456789012345678901234567890.123456789000"),
    BigDecimal.exact("1.234567890123456789012345678901234567890"))

  // Only a serializer fixture: does not claim these TA/refund/legacy facts were executed.
  val fullState: FundOrderState = FundOrderEntity.empty(id).copy(
    status = "PAYMENT_SETTLED", operationId = operationId, investorAccountId = investor,
    fundCode = fund, amount = amount,
    reservedSubscriptions = Map("reserved-other" -> amount),
    committedSubscriptions = Map(txid -> amount), compensatedSubscriptions = Map("canceled-other" -> amount),
    confirmedShareLots = Map(operationId -> share), sagaResults = Map("legacy" -> "outcome-unknown"),
    contractVersion = "cash-purchase-v2", fundCollectionAccountId = collection, selectedPaymentTxId = txid,
    taRequestId = "ta-request", taReference = "ta-reference", taStatus = "TA_ACCEPTED", taObservation = "UNKNOWN",
    taReceipts = Map("ta-receipt" -> "exact receipt body"), taConfirmedShares = share, taRejectionReason = "reason",
    refundOperationId = "refund-operation", refundTxId = "refund-tx", refundOutcome = "recovery-required",
    refundResultReceipts = Map("refund-receipt" -> "refund body"), taRequests = Map("ta-request" -> txid),
    cashPaymentResults = Map(txid -> "succeeded"), cashPaymentFinalResults = Map(txid -> "succeeded"),
    refundFinalResults = Map("refund-tx" -> "compensated"), refundResultReceiptKinds = Map("refund-receipt" -> "compensated")
  )
}
