package example.bankwealth.bindings

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash, bank_payment_hostHost => PaymentHost}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

final class BankSipTerminalBridge(plan: ActorRef[SipPlanAggregate.Request], order: ActorRef[FundOrderAggregate.Request],
    orderPersistenceId: String, readJournal: String => Future[Vector[Any]])(implicit system: ActorSystem[_]) {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)
  def record(o: SipOccurrence): Future[Unit] = for {
    p <- plan.ask[SipPlanState](SipPlanAggregate.GetState)
    s <- order.ask[FundOrderState](FundOrderAggregate.GetState)
    events <- readJournal(orderPersistenceId)
    _ = require(p.id == o.planId && p.occurrences.get(o.dueSlot).contains(o) && s.id == o.fundOrderId && s.operationId == o.operationId &&
      s.investorAccountId == o.config.investorAccountId && s.fundCollectionAccountId == o.config.fundCollectionAccountId &&
      s.amount == o.config.amount && s.fundCode == o.config.fundCode, "terminal original occurrence association mismatch")
    expectedPayment = TxId(PaymentHost.operationIdentity(Cash.State(Cash.Inputs(o.operationId, o.operationId, o.config.investorAccountId,
      o.fundOrderId, o.config.fundCollectionAccountId, o.config.amount, o.config.fundCode))))
    outcome = if (s.taStatus == "confirmed" && s.selectedPaymentTxId == expectedPayment && s.cashPaymentFinalResults.get(expectedPayment).contains("succeeded") && events.exists {
      case raw: FundOrderFundTASharesConfirmedPB => val e = DomainConverters.decodeFundOrderFundTASharesConfirmedPB(raw); e.fundOrderId == o.fundOrderId && e.paymentTxId == s.selectedPaymentTxId && e.taRequestId == s.taRequestId && e.shares == s.taConfirmedShares
      case _ => false
    }) Some("ta-confirmed") else if (s.taStatus == "rejected" && s.refundOutcome == "succeeded" && s.refundFinalResults.values.exists(_ == "succeeded") && events.exists {
      case raw: FundOrderFundRefundSucceededPB => val e = DomainConverters.decodeFundOrderFundRefundSucceededPB(raw); e.refundOperationId == s.refundOperationId && s.refundFinalResults.get(e.refundTxId).contains("succeeded")
      case _ => false
    }) Some("ta-rejected-refund-completed") else if (s.paymentOutcome == "rejected-before-effects" && s.cashPaymentFinalResults.get(expectedPayment).contains("rejected-before-effects") && events.exists {
      case raw: FundOrderFundCashPaymentRejectedBeforeEffectsPB => DomainConverters.decodeFundOrderFundCashPaymentRejectedBeforeEffectsPB(raw).txid == expectedPayment
      case _ => false
    }) Some("payment-rejected-before-effects")
    else if (s.paymentOutcome == "compensated" && s.cashPaymentFinalResults.get(expectedPayment).contains("compensated") && events.exists {
      case raw: FundOrderFundCashPaymentCompensatedPB => DomainConverters.decodeFundOrderFundCashPaymentCompensatedPB(raw).txid == expectedPayment
      case _ => false
    }) Some("payment-compensated") else None
    command: SipPlanProtocol.Command = outcome match {
      case Some("ta-confirmed") => SipPlanProtocol.RecordSipInstallmentSucceeded(o, "ta-confirmed", "bank-sip-terminal-v1/" + o.occurrenceId.value, s.taReceipts.toVector.sorted.mkString)
      case Some(reason) => SipPlanProtocol.RecordSipInstallmentFailed(o, reason, "bank-sip-terminal-v1/" + o.occurrenceId.value,
        Vector(s.id.value, s.selectedPaymentTxId.value, s.refundOperationId.value, s.paymentOutcome, s.refundOutcome).map(x => x.length.toString + ":" + x).mkString)
      case None if s.taStatus == "rejected" => SipPlanProtocol.RecordSipInstallmentRefundInProgress(o)
      case None => SipPlanProtocol.RecordSipInstallmentPending(o)
    }
    reply <- plan.ask[SipPlanAggregate.Reply](r => SipPlanAggregate.Execute(command, r))
    _ = require(reply.isInstanceOf[SipPlanAggregate.Accepted], "SIP terminal refused")
  } yield ()
}
