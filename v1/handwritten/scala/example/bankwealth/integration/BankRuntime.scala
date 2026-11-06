package example.bankwealth.integration

import akka.actor.typed.{ActorRef, ActorSystem, Behavior}
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.util.Timeout
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash, bank_independent_refund_v1Execution => Refund,
  bank_ta_submission_v1Execution => Ta, bank_sip_dispatch_v1Execution => Dispatch,
  bank_payment_hostDefinition => PaymentDefinition, bank_refund_hostDefinition => RefundDefinition,
  bank_payment_hostHost => PaymentHost, bank_refund_hostHost => RefundHost,
  bank_ta_effectEffectHost => TaHost, bank_sip_dispatchEffectHost => SipHost}
import example.bankwealth.bindings._
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.RunObserver
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

final class BankRuntime(
    namespace: String,
    journal: BankJournal,
    reconcileAuthorizer: ReconcileAuthorizer,
    taBindings: ActorRef[FundOrderAggregate.Request] => TaHost.Installed
)(implicit system: ActorSystem[_]) extends BankRuntimeDirectory {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)
  private val ids = new BankPersistenceIds(namespace)
  require(journal.namespace == namespace && reconcileAuthorizer != null && taBindings != null)
  private val actors = mutable.ArrayBuffer.empty[ActorRef[_]]
  private val activePersistenceIds = mutable.Set.empty[String]
  private val accounts = new example.bankwealth.application.aggregates.CreditBalanceRepository[AccountId](ids.account,
    (id, pid) => example.bankwealth.infrastructure.bootstrap.CreditBalanceBootstrap.create(pid, CreditBalanceState.empty.copy(id = id), BankBalanceComputations),
    (pid, behavior) => spawn(pid, behavior).ref)
  private val orders = new example.bankwealth.application.aggregates.FundOrderRepository[FundOrderId](ids.order,
    (id, pid) => example.bankwealth.infrastructure.bootstrap.FundOrderBootstrap.create(pid, FundOrderState.empty.copy(id = id), StableOrderIdentity,
      new FundOrderAggregate.ExternalAuthority { def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false }),
    (pid, behavior) => spawn(pid, behavior).ref)
  private val plans = new example.bankwealth.application.aggregates.SipPlanRepository[PlanId](ids.plan,
    (id, pid) => example.bankwealth.infrastructure.bootstrap.SipPlanBootstrap.create(pid, SipPlanState.empty.copy(id = id), StableSipIdentity),
    (pid, behavior) => spawn(pid, behavior).ref)
  private val cashRuns = mutable.Map.empty[OperationId, Future[BankCashRuntime]]
  private val refundRuns = mutable.Map.empty[OperationId, Future[BankRefundRuntime]]
  private val taRuns = mutable.Map.empty[TaRequestId, Future[BankTaRuntime]]
  private val dispatchRuns = mutable.Map.empty[OccurrenceId, Future[BankSipDispatchRuntime]]
  private var closed = false

  private def spawn[C](pid: String, behavior: Behavior[C]): BankActorHandle[C] = synchronized {
    require(!closed, "runtime directory is closed")
    val name = "bank-" + java.security.MessageDigest.getInstance("SHA-256").digest(pid.getBytes(java.nio.charset.StandardCharsets.UTF_8)).map(b => f"${b & 0xff}%02x").mkString
    val ref = system.systemActorOf(behavior, name)
    actors += ref
    activePersistenceIds += pid
    BankActorHandle(pid, ref)
  }
  def account(id: AccountId): Future[BankActorHandle[CreditBalanceAggregate.Request]] = synchronized {
    require(!closed)
    val handle = accounts.get(id)
    Future.successful(BankActorHandle(handle.persistenceId, handle.ref))
  }
  def order(id: FundOrderId): Future[BankActorHandle[FundOrderAggregate.Request]] = synchronized {
    require(!closed)
    val handle = orders.get(id)
    Future.successful(BankActorHandle(handle.persistenceId, handle.ref))
  }
  def plan(id: PlanId): Future[BankActorHandle[SipPlanAggregate.Request]] = synchronized {
    require(!closed)
    val handle = plans.get(id)
    Future.successful(BankActorHandle(handle.persistenceId, handle.ref))
  }
  private def cached[K, V](map: mutable.Map[K, Future[V]], key: K, graphPid: String)(create: => Future[V]): Future[V] = synchronized {
    require(!closed)
    map.get(key) match {
      case Some(existing) => existing
      case None =>
        val result = create
        map.put(key, result)
        result.failed.foreach { _ => synchronized {
          // A partially constructed graph retains its writer lock; a pre-graph read failure can retry.
          if (!activePersistenceIds(graphPid) && map.get(key).contains(result)) map.remove(key)
        }}
        result
    }
  }
  private def verifyPayment(state: FundOrderState, original: BankPaymentOriginal): Unit = {
    require(state.id == original.fundOrderId && state.status != "new" && state.operationId == original.operationId &&
      state.investorAccountId == original.investorAccountId && state.fundCollectionAccountId == original.fundCollectionAccountId &&
      state.amount == original.amount && state.fundCode == original.fundCode, "cash graph requires retained complete original settlement")
  }
  def ensureCash(original: BankPaymentOriginal): Future[BankCashRuntime] = cached(cashRuns, original.operationId, ids.paymentSaga(original.operationId)) {
    for {
      investor <- account(original.investorAccountId)
      collection <- account(original.fundCollectionAccountId)
      destination <- order(original.fundOrderId)
      state <- destination.ref.ask[FundOrderState](FundOrderAggregate.GetState)
      _ = verifyPayment(state, original)
    } yield synchronized {
      var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
      val bindings = new BankPaymentBindings(original, investor.ref, investor.persistenceId, collection.ref, collection.persistenceId,
        destination.ref, destination.persistenceId, journal.readPb(_), () => coordinator)
      val saga = spawn(ids.paymentSaga(original.operationId), PaymentDefinition.coordinator(ids.paymentSaga(original.operationId), PaymentDefinition.fromTechnical(bindings.installed), reconcileAuthorizer))
      coordinator = saga.ref
      val host = spawn(ids.paymentHost(original.operationId), PaymentHost(ids.paymentHost(original.operationId), saga.ref, bindings.installed))
      val parent = spawn(ids.paymentRun(original.operationId), Cash.behavior(ids.paymentRun(original.operationId), Cash.install(new Cash.PureStages {}, host.ref), new RunObserver[Cash.State] {}))
      BankCashRuntime(original, bindings.operationId, saga, host, parent)
    }
  }.map { value => require(value.original == original, "same cash identity has conflicting body"); value }

  def ensureRefund(original: BankRefundOriginal): Future[BankRefundRuntime] = cached(refundRuns, original.refundOperationId, ids.refundSaga(original.refundOperationId)) {
    for {
      investor <- account(original.investorAccountId)
      collection <- account(original.fundCollectionAccountId)
      destination <- order(original.fundOrderId)
      state <- destination.ref.ask[FundOrderState](FundOrderAggregate.GetState)
      _ = require(state.id == original.fundOrderId && state.selectedPaymentTxId == original.paymentTxId && state.refundOperationId == original.refundOperationId &&
        state.investorAccountId == original.investorAccountId && state.fundCollectionAccountId == original.fundCollectionAccountId && state.amount == original.amount,
        "refund graph requires retained original refund intent")
    } yield synchronized {
      var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
      val bindings = new BankRefundBindings(original, investor.ref, investor.persistenceId, collection.ref, collection.persistenceId,
        destination.ref, destination.persistenceId, journal.readPb(_), () => coordinator)
      val saga = spawn(ids.refundSaga(original.refundOperationId), RefundDefinition.coordinator(ids.refundSaga(original.refundOperationId), RefundDefinition.fromTechnical(bindings.installed), reconcileAuthorizer))
      coordinator = saga.ref
      val host = spawn(ids.refundHost(original.refundOperationId), RefundHost(ids.refundHost(original.refundOperationId), saga.ref, bindings.installed))
      val parent = spawn(ids.refundRun(original.refundOperationId), Refund.behavior(ids.refundRun(original.refundOperationId), Refund.install(new Refund.PureStages {}, host.ref), new RunObserver[Refund.State] {}))
      BankRefundRuntime(original, bindings.operationId, saga, host, parent)
    }
  }.map { value => require(value.original == original, "same refund identity has conflicting body"); value }

  def ensureTa(request: BankTaEffectRequest): Future[BankTaRuntime] = cached(taRuns, request.taRequestId, ids.taHost(request.taRequestId)) {
    for {
      destination <- order(request.fundOrderId)
      state <- destination.ref.ask[FundOrderState](FundOrderAggregate.GetState)
      _ = require(state.taRequestId == request.taRequestId && state.selectedPaymentTxId == request.paymentTxId && state.cashPaymentFinalResults.get(request.paymentTxId).contains("succeeded"), "TA graph requires original paid submission")
    } yield synchronized {
      val host = spawn(ids.taHost(request.taRequestId), TaHost(ids.taHost(request.taRequestId), taBindings(destination.ref)))
      val parent = spawn(ids.taRun(request.taRequestId), Ta.behavior(ids.taRun(request.taRequestId), Ta.install(new Ta.PureStages {}, host.ref), new RunObserver[Ta.State] {}))
      BankTaRuntime(request, host, parent)
    }
  }.map { value => require(value.request == request, "same TA identity has conflicting body"); value }

  def ensureSipDispatch(occurrence: SipOccurrence): Future[BankSipDispatchRuntime] = cached(dispatchRuns, occurrence.occurrenceId, ids.sipHost(occurrence.occurrenceId)) {
    for {
      source <- plan(occurrence.planId)
      state <- source.ref.ask[SipPlanState](SipPlanAggregate.GetState)
      _ = require(state.occurrences.get(occurrence.dueSlot).contains(occurrence), "dispatch graph requires retained occurrence")
      destination <- order(occurrence.fundOrderId)
      original = BankPaymentOriginal(occurrence.operationId, occurrence.fundOrderId, occurrence.config.investorAccountId,
        occurrence.config.fundCollectionAccountId, occurrence.config.fundCode, occurrence.config.amount)
      reply <- destination.ref.ask[FundOrderAggregate.Reply](r => FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(original.operationId,
        original.fundOrderId, original.investorAccountId, original.fundCollectionAccountId, original.fundCode, original.amount), r))
      _ = require(reply.isInstanceOf[FundOrderAggregate.Accepted], "persisted occurrence settlement rejected")
      cash <- ensureCash(original)
    } yield synchronized {
      val bindings = new BankSipDispatchBindings(source.ref, source.persistenceId, destination.ref, cash.parent.ref, cash.parent.persistenceId, journal.readAll(_))
      val host = spawn(ids.sipHost(occurrence.occurrenceId), SipHost(ids.sipHost(occurrence.occurrenceId), bindings.installed))
      val parent = spawn(ids.sipRun(occurrence.occurrenceId), Dispatch.behavior(ids.sipRun(occurrence.occurrenceId), Dispatch.install(new Dispatch.PureStages {}, host.ref), new RunObserver[Dispatch.State] {}))
      BankSipDispatchRuntime(occurrence, host, parent)
    }
  }.map { value => require(value.occurrence == occurrence, "same dispatch identity has conflicting body"); value }

  def close(): Unit = synchronized {
    if (!closed) {
      closed = true
      accounts.close()
      orders.close()
      plans.close()
      val termination = actors.reverseIterator.map(ref => akka.pattern.gracefulStop(ref.toClassic, 10.seconds, akka.actor.PoisonPill)).toVector
      scala.concurrent.Await.result(Future.sequence(termination), 15.seconds)
      actors.clear()
    }
  }
}
