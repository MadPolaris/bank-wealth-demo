package example.bankwealth.integration

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.security.BankDemoConfiguration
import example.bankwealth.service.BankServiceService._
import net.imadz.monarch.persistence.PersistentMonarch
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash}
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import scala.util.control.NonFatal

final class BankCashRequests(directory: BankRuntimeDirectory, config: BankDemoConfiguration,
    admission: BankTrustedAdmission, journal: BankJournal)(implicit system: ActorSystem[_]) extends BankCashRequestService {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)

  def submit(principal: Principal, request: BankCashSubmit): Future[Outcome[BankCashAcknowledgement]] = admission.cash(principal, request) match {
    case Left(error) => Future.successful(Left(error))
    case Right(original) =>
      directory.order(original.payment.fundOrderId).flatMap { handle =>
        handle.ref.ask[FundOrderAggregate.Reply](r => FundOrderAggregate.Execute(FundOrderProtocol.RecordCashRequestSource(original, Some(original)), r)).flatMap {
          case _: FundOrderAggregate.Refused => Future.successful(Left(RequestConflict))
          case _: FundOrderAggregate.Accepted =>
            handle.ref.ask[FundOrderState](FundOrderAggregate.GetState).flatMap { state =>
              require(state.cashRequestSource.contains(original), "accepted original source was not retained")
              admission.validateCash(state.cashRequestSource.get)
              start(original.payment).map(_.map(_ => BankCashAcknowledgement(original, "accepted")))
            }
        }
      }.recover { case NonFatal(_) => Left(Unavailable) }
  }

  def getOriginal(principal: Principal, clientRequestId: String): Future[Outcome[BankCashOriginal]] = {
    config.customer(principal) match {
      case None => Future.successful(Left(NotAuthorized))
      case Some(customer) =>
        val id = try Right(BankRequestIdentity.order(customer.id, clientRequestId)) catch { case NonFatal(_) => Left(InvalidRequest) }
        id match {
          case Left(error) => Future.successful(Left(error))
          case Right(orderId) => directory.order(orderId).flatMap(_.ref.ask[FundOrderState](FundOrderAggregate.GetState)).map { state =>
            state.cashRequestSource match {
              case None => Left(MissingResource)
              case Some(original) if original.principalId != customer.id || original.clientRequestId != clientRequestId => Left(NotAuthorized)
              case Some(original) => admission.validateCash(original); Right(original)
            }
          }.recover { case NonFatal(_) => Left(Unavailable) }
        }
    }
  }

  def resumePersisted(original: BankCashOriginal): Future[Outcome[BankPaymentOriginal]] = {
    admission.validateCash(original)
    directory.order(original.payment.fundOrderId).flatMap(_.ref.ask[FundOrderState](FundOrderAggregate.GetState)).flatMap { state =>
      require(state.cashRequestSource.contains(original), "recovery requires retained full original source")
      start(original.payment)
    }.recover { case NonFatal(_) => Left(Unavailable) }
  }

  def submitOccurrence(occurrence: SipOccurrence): Future[Outcome[BankPaymentOriginal]] = {
    directory.plan(occurrence.planId).flatMap(_.ref.ask[SipPlanState](SipPlanAggregate.GetState)).flatMap { state =>
      require(state.occurrences.get(occurrence.dueSlot).contains(occurrence), "machine cash requires original persisted occurrence")
      start(BankPaymentOriginal(occurrence.operationId, occurrence.fundOrderId, occurrence.config.investorAccountId,
        occurrence.config.fundCollectionAccountId, occurrence.config.fundCode, occurrence.config.amount))
    }.recover { case NonFatal(_) => Left(Unavailable) }
  }

  private def start(original: BankPaymentOriginal): Future[Outcome[BankPaymentOriginal]] = {
    directory.order(original.fundOrderId).flatMap { handle =>
      handle.ref.ask[FundOrderAggregate.Reply](r => FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(
        original.operationId, original.fundOrderId, original.investorAccountId, original.fundCollectionAccountId, original.fundCode, original.amount), r)).flatMap {
        case _: FundOrderAggregate.Refused => Future.successful(Left(RequestConflict))
        case _: FundOrderAggregate.Accepted => directory.ensureCash(original).flatMap { runtime =>
          val state = Cash.State(Cash.Inputs(original.operationId, original.operationId, original.investorAccountId,
            original.fundOrderId, original.fundCollectionAccountId, original.amount, original.fundCode))
          runtime.parent.ref.ask[PersistentMonarch.RunReply](r => PersistentMonarch.StartRun(original.operationId.value, state, r)).flatMap { _ =>
            journal.readAll(runtime.parent.persistenceId).map { events =>
              require(events.exists {
                case started: PersistentMonarch.RunStarted => started.runId == original.operationId.value && java.util.Arrays.equals(started.initialSnapshot, Cash.codec.encode(state))
                case _ => false
              }, "cash start acknowledgement lacks matching durable original start")
              Right(original)
            }
          }
        }
      }
    }
  }
}
