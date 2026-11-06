package example.bankwealth.ta

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.stream.{KillSwitches, Materializer, SystemMaterializer}
import akka.stream.scaladsl.{RestartSource, Sink, Source}
import akka.util.Timeout
import example.bankwealth.application.{bank_independent_refund_v1Execution => Refund, bank_ta_submission_v1Execution => Ta,
  bank_refund_hostHost => RefundHost, bank_ta_effectEffectHost => TaHost}
import example.bankwealth.bindings.{BankTaBridge, BankTaEffectBindings, MockTAClient, StableOrderIdentity}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.integration._
import example.bankwealth.security.BankDemoConfiguration
import example.bankwealth.service.BankServiceService._
import net.imadz.monarch.persistence.{PersistentMonarch, StateCodec}
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import scala.util.control.NonFatal

/** Application orchestration only: generated order/host/Saga/Monarch events own every
  * business decision. The maps below contain subscriptions and in-flight calls, not
  * financial state or durable recovery authority. Lifecycle belongs to the main root.
  */
final class BankTaRefundApplication(directory: BankRuntimeDirectory, journal: BankJournal, client: MockTAClient,
    scenarioForOrder: FundOrderId => String, onTerminal: FundOrderId => Future[Unit],
    config: BankDemoConfiguration, admission: BankTrustedAdmission, pollInterval: FiniteDuration = 1.second)
    (implicit system: ActorSystem[_]) extends BankTaRefundService {
  require(directory != null && journal != null && client != null && scenarioForOrder != null && onTerminal != null &&
    config != null && admission != null && pollInterval >= 100.millis, "complete trusted TA/refund application configuration required")
  require(!client.usesLegacyConfiguration, "service must use explicit MockTA node/worker/ownedRoot configuration")
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val materializer: Materializer = SystemMaterializer(system).materializer
  implicit private val timeout: Timeout = Timeout(3.seconds)
  private val ids = new BankPersistenceIds(journal.namespace)
  private val closed = new AtomicBoolean(false)
  private val stop = KillSwitches.shared("bank-ta-refund-" + journal.namespace)
  private var watched = Set.empty[FundOrderId]
  private var inFlight = Map.empty[FundOrderId, Promise[Outcome[Unit]]]

  private def orderFromPid(pid: String): Option[FundOrderId] = try {
    val prefix = ids.prefix + "order/"
    if (pid == null || !pid.startsWith(prefix)) None
    else {
      val id = FundOrderId(new String(Base64.getUrlDecoder.decode(pid.drop(prefix.length)), StandardCharsets.UTF_8))
      if (ids.order(id) == pid) Some(id) else None
    }
  } catch { case NonFatal(_) => None }

  private def watch(id: FundOrderId): Unit = synchronized {
    if (!closed.get() && !watched(id)) {
      watched += id
      // Start from zero on every subscription/restart. Duplicate observations are
      // harmless; a RAM watermark must never suppress recovery after a process loss.
      RestartSource.withBackoff(250.millis, 3.seconds, 0.1)(() => journal.events(ids.order(id), 0L))
        .via(stop.flow).mapAsync(1) { row =>
          require(row.persistenceId == ids.order(id), "foreign order subscription event")
          resumeExisting(id).map(_ => ())
        }.runWith(Sink.ignore).onComplete { _ => synchronized { watched -= id } }
    }
  }
  // withBackoff also restarts finite discovery on completion. An eagerly
  // materialized failed concat tail can discard PIDs before watch receives them.
  private val discovery = RestartSource.withBackoff(250.millis, 3.seconds, 0.1)(() =>
    journal.persistenceIds()).via(stop.flow).runForeach(pid => orderFromPid(pid).foreach(watch))
  // TA may advance without a bank event. Poll retained orders as well as following
  // the journal; this also retries callback delivery and temporary query failures.
  private val polling = Source.tick(pollInterval, pollInterval, ()).via(stop.flow).mapAsync(1) { _ =>
    val orders = synchronized { watched.toVector }
    Source(orders).mapAsync(4)(resumeExisting).runWith(Sink.ignore)
  }.runWith(Sink.ignore)

  def resumeExisting(orderId: FundOrderId): Future[Outcome[Unit]] = synchronized {
    if (closed.get()) Future.successful(Left(Unavailable))
    else if (orderId == null || orderId.value == null || orderId.value.isEmpty) Future.successful(Left(InvalidRequest))
    else inFlight.get(orderId) match {
      case Some(result) => result.future
      case None =>
        val result = Promise[Outcome[Unit]]()
        inFlight += orderId -> result
        val work = try resume(orderId) catch { case NonFatal(e) => Future.failed(e) }
        work.recover { case NonFatal(e) =>
          if (!closed.get()) system.log.warn("TA/refund remains recoverable for {}: {}", orderId.value, e.getMessage)
          Left(Unavailable)
        }.onComplete { value => synchronized {
          inFlight -= orderId
          result.tryComplete(value)
        } }
        result.future
    }
  }

  private def active(): Unit = require(!closed.get(), "TA/refund application is closed")
  private def history(pid: String): Future[Vector[Any]] = {
    active()
    require(ids.owns(pid), "foreign persistence namespace")
    journal.currentEvents(pid, 0L).map { rows =>
      require(rows.zipWithIndex.forall { case (r, i) => r.persistenceId == pid && r.sequenceNr == i.toLong + 1L },
        "complete contiguous original journal required")
      rows.map(_.event).map {
        case p: FundOrderFundPurchaseSettlementRequestedPB => DomainConverters.decodeFundOrderFundPurchaseSettlementRequestedPB(p)
        case p: FundOrderFundSubscriptionPaymentConfirmedPB => DomainConverters.decodeFundOrderFundSubscriptionPaymentConfirmedPB(p)
        case p: FundOrderFundCashPaymentSucceededPB => DomainConverters.decodeFundOrderFundCashPaymentSucceededPB(p)
        case p: FundOrderFundTASubmissionRegisteredPB => DomainConverters.decodeFundOrderFundTASubmissionRegisteredPB(p)
        case p: FundOrderFundTASharesConfirmedPB => DomainConverters.decodeFundOrderFundTASharesConfirmedPB(p)
        case p: FundOrderFundTARejectedPB => DomainConverters.decodeFundOrderFundTARejectedPB(p)
        case p: FundOrderFundPurchaseRefundRequestedPB => DomainConverters.decodeFundOrderFundPurchaseRefundRequestedPB(p)
        case p: FundOrderFundRefundSucceededPB => DomainConverters.decodeFundOrderFundRefundSucceededPB(p)
        case other => other
      }
    }
  }
  private def state(handle: BankActorHandle[FundOrderAggregate.Request]): Future[FundOrderState] = {
    active(); handle.ref.ask[FundOrderState](FundOrderAggregate.GetState)
  }
  private def paid(s: FundOrderState, events: Vector[Any]): Unit = {
    s.cashRequestSource.foreach { original =>
      admission.validateCash(original)
      require(original.payment.fundOrderId == s.id && original.payment.operationId == s.operationId &&
        original.payment.investorAccountId == s.investorAccountId && original.payment.fundCollectionAccountId == s.fundCollectionAccountId &&
        original.payment.fundCode == s.fundCode && original.payment.amount == s.amount, "retained cash source differs from paid order")
    }
    require(config.principals.exists(p => p.roles.contains("customer") && p.accountId == s.investorAccountId) &&
      config.fund(s.fundCode).exists(_.collectionAccountId == s.fundCollectionAccountId), "paid order is outside trusted bank configuration")
    require(s.amount.currency == "CNY" && s.amount.amount > 0 && s.investorAccountId != s.fundCollectionAccountId &&
      s.selectedPaymentTxId.value.nonEmpty && s.cashPaymentFinalResults.get(s.selectedPaymentTxId).contains("succeeded"), "original guarded payment success required")
    require(events.exists {
      case e: FundOrderProtocol.FundPurchaseSettlementRequested => e.fundOrderId == s.id && e.operationId == s.operationId &&
        e.investorAccountId == s.investorAccountId && e.fundCollectionAccountId == s.fundCollectionAccountId && e.fundCode == s.fundCode && e.amount == s.amount
      case _ => false
    } && events.exists {
      case e: FundOrderProtocol.FundSubscriptionPaymentConfirmed => e.txid == s.selectedPaymentTxId && e.resource == s.id && e.amount == s.amount
      case _ => false
    } && events.exists {
      case e: FundOrderProtocol.FundCashPaymentSucceeded => e.txid == s.selectedPaymentTxId && e.kind == "succeeded"
      case _ => false
    }, "exact original payment journal evidence required")
  }
  private def registered(s: FundOrderState, events: Vector[Any]): Unit = {
    require(s.taRequestId == StableOrderIdentity.StableTaRequestId(s, FundOrderProtocol.RegisterFundTASubmission(s.id, s.selectedPaymentTxId)) &&
      events.exists {
        case e: FundOrderProtocol.FundTASubmissionRegistered => e.fundOrderId == s.id && e.paymentTxId == s.selectedPaymentTxId && e.taRequestId == s.taRequestId
        case _ => false
      }, "exact durable TA registration required")
  }
  /** First related generated terminal event, not effect completion or accepted status. */
  private def terminal(s: FundOrderState, events: Vector[Any]): Option[String] = events.collectFirst {
    case e: FundOrderProtocol.FundTASharesConfirmed if e.fundOrderId == s.id && e.paymentTxId == s.selectedPaymentTxId && e.taRequestId == s.taRequestId =>
      require(s.taStatus == "confirmed" && s.taReceipts.get(e.receiptId).contains(e.receiptBody) &&
        s.taReceiptOutcomes.get(e.receiptId).contains("confirmed") && e.taReference == s.taReference && e.fundCode == s.fundCode &&
        e.currency == s.amount.currency && e.shares == s.taConfirmedShares, "first TA confirmation differs from retained generated state")
      "confirmed"
    case e: FundOrderProtocol.FundTARejected if e.fundOrderId == s.id && e.paymentTxId == s.selectedPaymentTxId && e.taRequestId == s.taRequestId =>
      require(s.taStatus == "rejected" && s.taReceipts.get(e.receiptId).contains(e.receiptBody) &&
        s.taReceiptOutcomes.get(e.receiptId).contains("rejected") && e.taReference == s.taReference && e.fundCode == s.fundCode &&
        e.currency == s.amount.currency && e.reason == s.taRejectionReason, "first TA rejection differs from retained generated state")
      "rejected"
  }

  private def resume(id: FundOrderId): Future[Outcome[Unit]] = for {
    handle <- directory.order(id)
    _ = require(handle.persistenceId == ids.order(id), "directory returned another order identity")
    before <- state(handle)
    _ = require(before.id == id, "directory returned another order")
    events <- history(handle.persistenceId)
    result <- if (!before.cashPaymentFinalResults.get(before.selectedPaymentTxId).contains("succeeded"))
      Future.successful(if (events.isEmpty) Left(MissingResource) else Right(()))
    else {
      paid(before, events)
      // A direct resume must keep following the verified retained order too:
      // StartRun acknowledges before refund completion/terminal delivery exists.
      watch(id)
      val bridge = new BankTaBridge(handle.ref, client)
      for {
        // A bank terminal receipt does not prove that the finite effect's reply or
        // parent checkpoint survived. Always reattach that exact original graph.
        request <- if (before.taRequestId.value.nonEmpty)
          Future.successful(BankTaEffectRequest(before.taRequestId, id, before.selectedPaymentTxId))
          else { active(); bridge.register() }
        retained <- state(handle)
        retainedEvents <- history(handle.persistenceId)
        _ = registered(retained, retainedEvents)
        scenario = scenarioForOrder(id)
        _ = require(scenario != null && scenario.nonEmpty, "trusted per-order TA scenario required")
        _ = active()
        runtime <- directory.ensureTa(request)
        _ = require(runtime.request == request && runtime.host.persistenceId == ids.taHost(request.taRequestId) &&
          runtime.parent.persistenceId == ids.taRun(request.taRequestId), "TA runtime changed original identity")
        _ <- startOriginal(runtime.parent, request.taRequestId.value, Ta.State(Ta.Inputs(request.taRequestId, id, request.paymentTxId)), Ta.codec, Vector("submit-ta#0"))
        _ <- recoverUnsubmitted(runtime)
        _ <- if (terminal(retained, retainedEvents).nonEmpty) Future.successful(())
          else { active(); bridge.reconcile(scenario).map(_ => ()) }
        after <- state(handle)
        afterEvents <- history(handle.persistenceId)
        value <- finish(handle, after, afterEvents, bridge)
      } yield value
    }
  } yield result

  private def recoverUnsubmitted(runtime: BankTaRuntime): Future[Unit] = history(runtime.host.persistenceId).flatMap { events =>
    val input = Ta.State(Ta.Inputs(runtime.request.taRequestId, runtime.request.fundOrderId, runtime.request.paymentTxId))
    val intents = events.collect { case e: TaHost.Intent => e }
    require(intents.size <= 1, "duplicate TA effect intent")
    intents.foreach(e => require(e.operation == TaHost.operationIdentity(input) && Ta.codec.decode(e.original.toByteArray) == input,
      "TA effect intent differs from original registered request"))
    val latest = events.collect { case e: TaHost.ObservationStored => e.value }.lastOption.filterNot(_.isEmpty)
      .map(bytes => DomainConverters.decodeBankTaEffectObservationPB(BankTaEffectObservationPB.parseFrom(bytes.toByteArray)))
    latest match {
      case Some(proof) if intents.nonEmpty && proof.status == "absent" =>
        require(proof.operation == TaHost.operationIdentity(input) && proof.request == runtime.request && proof.result.isEmpty && proof.evidence.nonEmpty,
          "TA retry requires matching durable absence")
        active()
        runtime.host.ref.ask[TaHost.Reply](reply => TaHost.Reconcile(input, "retry", BankTaEffectBindings.RecoveryAuthorization, reply)).map {
          case _: TaHost.Completed | _: TaHost.Pending => ()
          case _: TaHost.Conflict => throw new IllegalStateException("TA retry rejected original identity")
        }
      case _ => Future.successful(())
    }
  }

  private def finish(handle: BankActorHandle[FundOrderAggregate.Request], s: FundOrderState, events: Vector[Any],
      bridge: BankTaBridge): Future[Outcome[Unit]] = {
    paid(s, events); registered(s, events)
    terminal(s, events) match {
      case Some("confirmed") => active(); onTerminal(s.id).map(_ => Right(()))
      case Some("rejected") =>
        active()
        bridge.requestRefund().flatMap { original =>
        for {
          retained <- state(handle)
          evidence <- history(handle.persistenceId)
          _ = require(original.refundOperationId == StableOrderIdentity.StableRefundOperationId(retained,
            FundOrderProtocol.RequestFundPurchaseRefund(original.fundOrderId, original.paymentTxId)), "refund identity must be stable and independent")
          _ = require(evidence.exists {
            case e: FundOrderProtocol.FundPurchaseRefundRequested => BankRefundOriginal(e.fundOrderId, e.paymentTxId,
              e.investorAccountId, e.fundCollectionAccountId, e.amount, e.refundOperationId) == original
            case _ => false
          }, "independent refund must be durably requested before assembly")
          _ = active()
          runtime <- directory.ensureRefund(original)
          input = Refund.State(Refund.Inputs(original.fundOrderId, original.paymentTxId, original.investorAccountId,
            original.fundCollectionAccountId, original.amount, original.refundOperationId))
          _ = require(runtime.original == original && runtime.transactionId == RefundHost.operationIdentity(input) &&
            runtime.transactionId != original.paymentTxId.value && runtime.parent.persistenceId == ids.refundRun(original.refundOperationId) &&
            runtime.host.persistenceId == ids.refundHost(original.refundOperationId) && runtime.coordinator.persistenceId == ids.refundSaga(original.refundOperationId),
            "refund must use its actual independent reverse Saga and parent")
          _ <- startOriginal(runtime.parent, original.refundOperationId.value, input, Refund.codec, Vector("return-principal#0"))
          current <- state(handle)
          currentEvents <- history(handle.persistenceId)
          _ <- if (current.refundOutcome == "succeeded" && current.refundFinalResults.get(TxId(runtime.transactionId)).contains("succeeded") && currentEvents.exists {
            case e: FundOrderProtocol.FundRefundSucceeded => e.refundOperationId == original.refundOperationId && e.refundTxId.value == runtime.transactionId
            case _ => false
          }) { active(); onTerminal(s.id) } else Future.successful(())
        } yield Right(())
      }
      case _ => Future.successful(Right(())) // accepted/unknown remains a recoverable nonterminal business outcome
    }
  }

  private def startOriginal[S](parent: BankActorHandle[PersistentMonarch.Command[S]], runId: String, input: S,
      codec: StateCodec[S], plan: Vector[String]): Future[Unit] = {
    def retained(): Future[Boolean] = history(parent.persistenceId).map { events =>
      val starts = events.collect { case e: PersistentMonarch.RunStarted => e }
      require(starts.size <= 1, "duplicate durable parent originals")
      starts.headOption.foreach(e => require(e.runId == runId && e.stageCursors == plan && codec.decode(e.initialSnapshot) == input,
        "parent recovery must retain complete original identity and inputs"))
      starts.nonEmpty
    }
    retained().flatMap {
      case true => Future.successful(()) // ensure* has reattached the original recovery behavior
      case false =>
        active()
        parent.ref.ask[PersistentMonarch.RunReply](r => PersistentMonarch.StartRun(runId, input, r)).flatMap {
          case PersistentMonarch.Accepted(id) if id == runId => Future.successful(())
          case _: PersistentMonarch.Rejected => retained().map(found => require(found, "parent refused without a retained same-original run"))
          case _ => Future.failed(new IllegalStateException("parent acknowledgement identity mismatch"))
        }
    }
  }
  def close(): Unit = synchronized {
    if (closed.compareAndSet(false, true)) {
      stop.shutdown()
      watched = Set.empty
      inFlight.values.foreach(_.trySuccess(Left(Unavailable)))
      inFlight = Map.empty
      // Shared directory, journal and client are closed exactly once by the main root.
    }
  }
}
