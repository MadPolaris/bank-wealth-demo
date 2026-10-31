package example.bankwealth.integration

import akka.actor.typed.ActorRef
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash, bank_independent_refund_v1Execution => Refund,
  bank_ta_submission_v1Execution => Ta, bank_sip_dispatch_v1Execution => SipDispatch,
  bank_payment_hostHost => PaymentHost, bank_refund_hostHost => RefundHost,
  bank_ta_effectEffectHost => TaHost, bank_sip_dispatchEffectHost => SipHost}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import net.imadz.infra.saga.strict.StrictSagaCoordinator
import net.imadz.monarch.persistence.PersistentMonarch
import scala.concurrent.Future

final case class BankActorHandle[C](persistenceId: String, ref: ActorRef[C])
final case class BankCashRuntime(original: BankPaymentOriginal, transactionId: String,
  coordinator: BankActorHandle[StrictSagaCoordinator.Command], host: BankActorHandle[PaymentHost.Request],
  parent: BankActorHandle[PersistentMonarch.Command[Cash.State]])
final case class BankRefundRuntime(original: BankRefundOriginal, transactionId: String,
  coordinator: BankActorHandle[StrictSagaCoordinator.Command], host: BankActorHandle[RefundHost.Request],
  parent: BankActorHandle[PersistentMonarch.Command[Refund.State]])
final case class BankTaRuntime(request: BankTaEffectRequest, host: BankActorHandle[TaHost.Request],
  parent: BankActorHandle[PersistentMonarch.Command[Ta.State]])
final case class BankSipDispatchRuntime(occurrence: SipOccurrence, host: BankActorHandle[SipHost.Request],
  parent: BankActorHandle[PersistentMonarch.Command[SipDispatch.State]])

trait BankRuntimeDirectory extends AutoCloseable {
  def account(id: AccountId): Future[BankActorHandle[CreditBalanceAggregate.Request]]
  def order(id: FundOrderId): Future[BankActorHandle[FundOrderAggregate.Request]]
  def plan(id: PlanId): Future[BankActorHandle[SipPlanAggregate.Request]]
  def ensureCash(original: BankPaymentOriginal): Future[BankCashRuntime]
  def ensureRefund(original: BankRefundOriginal): Future[BankRefundRuntime]
  def ensureTa(request: BankTaEffectRequest): Future[BankTaRuntime]
  def ensureSipDispatch(occurrence: SipOccurrence): Future[BankSipDispatchRuntime]
}
