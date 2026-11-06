package example.bankwealth.integration

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.Sink
import akka.util.Timeout
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.security.BankDemoConfiguration
import example.bankwealth.service.BankServiceService._
import net.imadz.infra.saga.strict._
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import scala.util.control.NonFatal

final class BankRecovery(directory: BankRuntimeDirectory, journal: BankJournal, config: BankDemoConfiguration,
    cash: BankCashRequests, machineAuthorization: String)(implicit system: ActorSystem[_]) extends BankRecoveryService {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(5.seconds)
  implicit private val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
  private val ids = new BankPersistenceIds(journal.namespace)

  private def reconcile(coordinator: BankActorHandle[StrictSagaCoordinator.Command], transactionId: String,
      operation: OperationId): Future[Outcome[BankRecoveryAcknowledgement]] = {
    coordinator.ref.ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus).flatMap {
      case StrictSagaCoordinator.Status(state) if state.identity.exists(_.transactionId == transactionId) =>
        coordinator.ref.ask[StrictSagaCoordinator.Reply](r => StrictSagaCoordinator.Reconcile(state.identity.get, machineAuthorization, 32, r)).map {
          case StrictSagaCoordinator.Status(next) => Right(BankRecoveryAcknowledgement(operation, next.status.toString))
          case _ => Left(Unavailable)
        }
      case _ => Future.successful(Left(Unavailable))
    }
  }
  private def resume(coordinator: BankActorHandle[StrictSagaCoordinator.Command], transactionId: String,
      operationId: OperationId): Future[Outcome[Unit]] =
    coordinator.ref.ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus).flatMap {
      case StrictSagaCoordinator.Status(state) if state.identity.exists(_.transactionId == transactionId) =>
        if (!state.terminal) reconcile(coordinator, transactionId, operationId).map(_.map(_ => ()))
        else Future.successful(Right(()))
      case _ => Future.successful(Left(Unavailable))
    }

  private[integration] def resumePayment(original: BankPaymentOriginal): Future[Outcome[Unit]] =
    directory.ensureCash(original).flatMap { runtime =>
      resume(runtime.coordinator, runtime.transactionId, original.operationId)
    }.recover { case NonFatal(_) => Left(Unavailable) }

  private[integration] def resumeRefund(original: BankRefundOriginal): Future[Outcome[Unit]] =
    directory.ensureRefund(original).flatMap { runtime =>
      resume(runtime.coordinator, runtime.transactionId, original.refundOperationId)
    }.recover { case NonFatal(_) => Left(Unavailable) }

  def reconcileExisting(principal: Principal, key: BankOperationKey): Future[Outcome[BankRecoveryAcknowledgement]] = {
    if (!config.operator(principal)) Future.successful(Left(NotAuthorized))
    else journal.persistenceIds().filter(pid => pid.startsWith(ids.prefix + "order/") || pid.startsWith(ids.prefix + "plan/")).runWith(Sink.seq).flatMap { pids =>
      Future.traverse(pids)(pid => journal.readPb(pid)).flatMap { streams =>
        val rows = streams.flatten
        val refunds = rows.collect { case p: FundOrderFundPurchaseRefundRequestedPB => DomainConverters.decodeFundOrderFundPurchaseRefundRequestedPB(p) }
        val originals = rows.collect { case p: FundOrderCashRequestSourceRecordedPB => DomainConverters.decodeFundOrderCashRequestSourceRecordedPB(p).original }
        val occurrences = rows.collect { case p: SipPlanSipInstallmentTriggeredPB => DomainConverters.decodeSipPlanSipInstallmentTriggeredPB(p).occurrence }
        refunds.find(_.refundOperationId == key.operationId) match {
          case Some(r) =>
            val original = BankRefundOriginal(r.fundOrderId, r.paymentTxId, r.investorAccountId, r.fundCollectionAccountId, r.amount, r.refundOperationId)
            directory.ensureRefund(original).flatMap(runtime => reconcile(runtime.coordinator, runtime.transactionId, key.operationId))
          case None => originals.find(_.payment.operationId == key.operationId) match {
            case Some(original) => cash.resumePersisted(original).flatMap {
              case Left(error) => Future.successful(Left(error))
              case Right(_) => directory.ensureCash(original.payment).flatMap(r => reconcile(r.coordinator, r.transactionId, key.operationId))
            }
            case None => occurrences.find(_.operationId == key.operationId) match {
              case None => Future.successful(Left(MissingResource))
              case Some(occurrence) => cash.submitOccurrence(occurrence).flatMap {
                case Left(error) => Future.successful(Left(error))
                case Right(original) => directory.ensureCash(original).flatMap(r => reconcile(r.coordinator, r.transactionId, key.operationId))
              }
            }
          }
        }
      }
    }.recover { case NonFatal(_) => Left(Unavailable) }
  }
}
