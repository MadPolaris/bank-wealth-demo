package example.bankwealth.integration

import example.bankwealth.domain.values._
import example.bankwealth.service.BankServiceService.{Bindings, Endpoint, Outcome, Principal}
import play.api.libs.json.{Reads, Writes}
import scala.concurrent.Future

/** The generated HTTP contract delegates only to the shared application ports. */
object BankServiceEndpoints {
  val Version: String = "bank-v1-service-1"

  private def endpoint[I, O](
      portName: String,
      reads: Reads[I],
      writes: Writes[O]
  )(run: (Principal, I) => Future[Outcome[O]]): Endpoint[I, O] =
    Endpoint("example.bankwealth.integration.BankServiceEndpoints." + portName, Version, reads, writes, run)

  def build(
      cash: BankCashRequestService,
      queries: BankReadQueries,
      sip: BankSipApplicationService,
      recovery: BankRecoveryService
  ): Bindings = {
    require(cash != null && queries != null && sip != null && recovery != null,
      "complete bank application ports required")

    import BankServiceJson._

    Bindings(
      BankAccountQuery = endpoint[BankAccountKey, BankAccountResponse](
        "BankAccountQuery", bankAccountKeyReads, bankAccountResponseWrites
      )(queries.accountMe),
      BankCashSubmitPort = endpoint[BankCashSubmit, BankCashAcknowledgement](
        "BankCashSubmitPort", bankCashSubmitReads, bankCashAcknowledgementWrites
      )(cash.submit),
      BankCashOriginalQuery = endpoint[BankCashRequestKey, BankCashRequestResponse](
        "BankCashOriginalQuery", bankCashRequestKeyReads, bankCashRequestResponseWrites
      )(queries.cashOriginal),
      BankOrderQuery = endpoint[BankOrderKey, BankOrderResponse](
        "BankOrderQuery", bankOrderKeyReads, bankOrderResponseWrites
      )(queries.order),
      BankSipCreatePort = endpoint[BankSipCreate, BankSipAcknowledgement](
        "BankSipCreatePort", bankSipCreateReads, bankSipAcknowledgementWrites
      )(sip.create),
      BankSipPlansQuery = endpoint[BankPlanPageKey, BankSipPlanPage](
        "BankSipPlansQuery", bankPlanPageKeyReads, bankSipPlanPageWrites
      )(queries.plans),
      BankSipPlanQuery = endpoint[BankPlanKey, BankSipPlanResponse](
        "BankSipPlanQuery", bankPlanKeyReads, bankSipPlanResponseWrites
      )(queries.plan),
      BankSipRevisePort = endpoint[BankSipRevisionInput, BankSipAcknowledgement](
        "BankSipRevisePort", bankSipRevisionInputReads, bankSipAcknowledgementWrites
      )(sip.revise),
      BankSipPausePort = endpoint[BankPlanKey, BankSipAcknowledgement](
        "BankSipPausePort", bankPlanActionReads, bankSipAcknowledgementWrites
      )(sip.pause),
      BankSipResumePort = endpoint[BankPlanKey, BankSipAcknowledgement](
        "BankSipResumePort", bankPlanActionReads, bankSipAcknowledgementWrites
      )(sip.resume),
      BankSipOccurrencesQuery = endpoint[BankOccurrencePageKey, BankSipOccurrencePage](
        "BankSipOccurrencesQuery", bankOccurrencePageKeyReads, bankSipOccurrencePageWrites
      )(queries.occurrences),
      BankPendingOperationsQuery = endpoint[BankPendingPageKey, BankPendingResponse](
        "BankPendingOperationsQuery", bankPendingPageKeyReads, bankPendingResponseWrites
      )(queries.pending),
      BankReconcileExistingPort = endpoint[BankOperationKey, BankRecoveryAcknowledgement](
        "BankReconcileExistingPort", bankOperationActionReads, bankRecoveryAcknowledgementWrites
      )(recovery.reconcileExisting),
      BankBusinessTickPort = endpoint[BankTick, BankTickAcknowledgement](
        "BankBusinessTickPort", bankTickReads, bankTickAcknowledgementWrites
      )(sip.tick)
    )
  }
}
