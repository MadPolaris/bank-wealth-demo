package example.bankwealth.integration

import akka.actor.Cancellable
import akka.actor.typed.ActorSystem
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.Sink
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.service.BankServiceService.Outcome
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import java.util.concurrent.atomic.AtomicBoolean
import scala.util.control.NonFatal

final class BankRecoveryLoop(journal: BankJournal, cash: BankCashRequests, ta: BankTaRefundService,
    sip: BankSipApplicationService, recovery: BankRecovery)(implicit system: ActorSystem[_]) extends AutoCloseable {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
  private val running = new AtomicBoolean(false)
  private val closed = new AtomicBoolean(false)
  private val readyPromise = Promise[Unit]()
  val ready: Future[Unit] = readyPromise.future
  @volatile private var failures = Vector.empty[String]
  def pendingPersistenceIds: Vector[String] = failures
  private var schedule = Option.empty[Cancellable]
  def start(): Future[Unit] = synchronized {
    require(!closed.get(), "recovery driver is closed")
    if (schedule.isEmpty) schedule = Some(system.scheduler.scheduleWithFixedDelay(Duration.Zero, 1.second)(new Runnable {
      def run(): Unit = if (!closed.get() && running.compareAndSet(false, true)) {
        scan().onComplete { result =>
          running.set(false)
          result match {
            case scala.util.Success(pending) => failures = pending; readyPromise.trySuccess(())
            case scala.util.Failure(error) =>
              readyPromise.tryFailure(error)
              system.log.warn("Bank recovery discovery failed: {}", error.getClass.getName)
          }
        }
      }
    }))
    ready
  }
  private def attempt[A](operation: => Future[Outcome[A]]): Future[Boolean] =
    try operation.map(_.isRight).recover { case NonFatal(_) => false }
    catch { case NonFatal(_) => Future.successful(false) }
  private val ids = new BankPersistenceIds(journal.namespace)
  private def scan(): Future[Vector[String]] = journal.persistenceIds()
    .filter(pid => pid.startsWith(ids.prefix + "order/") || pid.startsWith(ids.prefix + "plan/"))
    .runWith(Sink.seq).flatMap { ids =>
    ids.foldLeft(Future.successful(Vector.empty[String])) { (previous, pid) => previous.flatMap { pending =>
      if (closed.get()) Future.successful(pending)
      else {
        journal.readPb(pid).flatMap { rows =>
          val originals = rows.collect { case p: FundOrderCashRequestSourceRecordedPB => DomainConverters.decodeFundOrderCashRequestSourceRecordedPB(p).original }.distinct
          val plans = rows.collect { case p: SipPlanSipCreateIntentRecordedPB => DomainConverters.decodeSipPlanSipCreateIntentRecordedPB(p).intent.planId }.distinct
          val settlements = rows.collect { case p: FundOrderFundPurchaseSettlementRequestedPB => DomainConverters.decodeFundOrderFundPurchaseSettlementRequestedPB(p) }.distinct
          val refunds = rows.collect { case p: FundOrderFundPurchaseRefundRequestedPB => DomainConverters.decodeFundOrderFundPurchaseRefundRequestedPB(p) }.distinct
          val orders = settlements.map(_.fundOrderId)
          for {
            cashResults <- Future.traverse(originals)(o => attempt(cash.resumePersisted(o)))
            sipResults <- Future.traverse(plans)(p => attempt(sip.recoverExisting(p)))
            paymentResults <- Future.traverse(settlements)(s => attempt(recovery.resumePayment(example.bankwealth.domain.values.BankPaymentOriginal(
              s.operationId, s.fundOrderId, s.investorAccountId, s.fundCollectionAccountId, s.fundCode, s.amount))))
            taResults <- Future.traverse(orders)(o => attempt(ta.resumeExisting(o)))
            refundResults <- Future.traverse(refunds)(r => attempt(recovery.resumeRefund(example.bankwealth.domain.values.BankRefundOriginal(
              r.fundOrderId, r.paymentTxId, r.investorAccountId, r.fundCollectionAccountId, r.amount, r.refundOperationId))))
          } yield if ((cashResults ++ sipResults ++ paymentResults ++ taResults ++ refundResults).forall(identity)) pending else pending :+ pid
        }.recover { case NonFatal(_) => pending :+ pid }
      }
    }}
  }
  def close(): Unit = synchronized {
    if (closed.compareAndSet(false, true)) { schedule.foreach(_.cancel()); () }
  }
}
