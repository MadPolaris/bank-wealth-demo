package example.bankwealth.bindings

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import example.bankwealth.application.{bank_independent_refund_v1Execution => Execution, bank_refund_hostDefinition => Definition, bank_refund_hostHost => Host, bank_refund_hostTechnicalPorts => Technical}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import net.imadz.infra.saga.strict._
import scalapb.GeneratedMessage
import java.security.MessageDigest
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

final class BankRefundBindings(
    val original: BankRefundOriginal,
    investor: ActorRef[CreditBalanceAggregate.Request], investorPersistenceId: String,
    collection: ActorRef[CreditBalanceAggregate.Request], collectionPersistenceId: String,
    order: ActorRef[FundOrderAggregate.Request], orderPersistenceId: String,
    readJournal: String => Future[Vector[GeneratedMessage]],
    coordinator: () => ActorRef[StrictSagaCoordinator.Command]
)(implicit system: ActorSystem[_]) {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)
  private val version = "bank-v1-1"
  val parentInput: Execution.State = Execution.State(Execution.Inputs(original.fundOrderId, original.paymentTxId,
    original.investorAccountId, original.fundCollectionAccountId, original.amount, original.refundOperationId))
  val operationId: String = Host.operationIdentity(parentInput)
  private val args = BankRefundArgs(original.fundCollectionAccountId, original.investorAccountId, original.amount)
  private val argsBytes = Definition.argsCodec.encode(args)
  private val argsDigest = MessageDigest.getInstance("SHA-256").digest(argsBytes.toByteArray).map(b => f"${b & 0xff}%02x").mkString
  private lazy val definition = Definition.definition(Definition.fromTechnical(installed))
  private val participants = Vector("collectionCreditBalance", "investorCreditBalance")
  private val steps = Vector("debit-fund-collection", "credit-original-investor")
  private val resources = Vector(original.fundCollectionAccountId.value, original.investorAccountId.value)
  require(investor != null && collection != null && order != null && readJournal != null && coordinator != null)
  require(original.investorAccountId != original.fundCollectionAccountId && original.amount.currency == "CNY" && original.amount.amount > 0)

  private def validateTransaction(id: TransactionIdentity): Unit = {
    require(id != null && id.transactionId == operationId && id.definitionName == definition.name &&
      id.definitionVersion == definition.version && id.definitionDigest == definition.definitionDigest &&
      id.argsCodec == Definition.argsCodec.pin && id.argsDigest == argsDigest, "refund authority identity mismatch")
  }
  private def validate(id: OperationIdentity, index: Int, phase: Phase): Unit = {
    validateTransaction(id.transaction)
    require(id.participantId == participants(index) && id.resource == resources(index) && id.stepId == steps(index) && id.phase == phase,
      "refund operation resource or phase mismatch")
  }
  private def ledger(index: Int): ActorRef[CreditBalanceAggregate.Request] = if (index == 0) collection else investor
  private def persistence(index: Int): String = Vector(collectionPersistenceId, investorPersistenceId)(index)
  private def ledgerState(index: Int): Future[CreditBalanceState] = ledger(index).ask[CreditBalanceState](CreditBalanceAggregate.GetState)
  private def orderState(): Future[FundOrderState] = order.ask[FundOrderState](FundOrderAggregate.GetState)
  private def event(raw: GeneratedMessage): Any = raw match {
    case x: CreditBalanceReserveFundsConfirmedPB => DomainConverters.decodeCreditBalanceReserveFundsConfirmedPB(x)
    case x: CreditBalanceDeductFundsConfirmedPB => DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(x)
    case x: CreditBalanceReleaseReservedFundsConfirmedPB => DomainConverters.decodeCreditBalanceReleaseReservedFundsConfirmedPB(x)
    case x: CreditBalanceRecordIncomingCreditsConfirmedPB => DomainConverters.decodeCreditBalanceRecordIncomingCreditsConfirmedPB(x)
    case x: CreditBalanceCommitIncomingCreditsConfirmedPB => DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(x)
    case x: CreditBalanceCancelIncomingCreditConfirmedPB => DomainConverters.decodeCreditBalanceCancelIncomingCreditConfirmedPB(x)
    case x: FundOrderReserveFundSubscriptionConfirmedPB => DomainConverters.decodeFundOrderReserveFundSubscriptionConfirmedPB(x)
    case x: FundOrderFundSubscriptionPaymentConfirmedPB => DomainConverters.decodeFundOrderFundSubscriptionPaymentConfirmedPB(x)
    case x: FundOrderCashFundSubscriptionCanceledPB => DomainConverters.decodeFundOrderCashFundSubscriptionCanceledPB(x)
    case x: FundOrderFundPurchaseRefundRequestedPB => DomainConverters.decodeFundOrderFundPurchaseRefundRequestedPB(x)
    case _ => raw
  }
  private def history(index: Int): Future[Vector[Any]] = readJournal(persistence(index)).map(_.map(event))
  private def ledgerEvidence(index: Int, phase: Phase, events: Vector[Any]): Option[Product] = events.collectFirst {
    case e: CreditBalanceProtocol.ReserveFundsConfirmed if index == 0 && phase == Phase.Prepare && e.txid.value == operationId && e.resource.value == resources(index) && e.amount == original.amount => e
    case e: CreditBalanceProtocol.DeductFundsConfirmed if index == 0 && phase == Phase.Commit && e.txid.value == operationId && e.resource.value == resources(index) && e.amount == original.amount => e
    case e: CreditBalanceProtocol.ReleaseReservedFundsConfirmed if index == 0 && phase == Phase.Compensate && e.txid.value == operationId && e.resource.value == resources(index) && e.amount == original.amount => e
    case e: CreditBalanceProtocol.RecordIncomingCreditsConfirmed if index == 1 && phase == Phase.Prepare && e.txid.value == operationId && e.resource.value == resources(index) && e.amount == original.amount => e
    case e: CreditBalanceProtocol.CommitIncomingCreditsConfirmed if index == 1 && phase == Phase.Commit && e.txid.value == operationId && e.resource.value == resources(index) && e.amount == original.amount => e
    case e: CreditBalanceProtocol.CancelIncomingCreditConfirmed if index == 1 && phase == Phase.Compensate && e.txid.value == operationId && e.resource.value == resources(index) && e.amount == original.amount => e
  }
  private def query(index: Int, phase: Phase, id: OperationIdentity): Future[Option[Product]] = {
    validate(id, index, phase)
    history(index).map { events =>
      val receipt = ledgerEvidence(index, phase, events)
      if (phase == Phase.Prepare && receipt.isEmpty && ledgerEvidence(index, Phase.Compensate, events).nonEmpty)
        throw Technical.OperationNotExecuted(id, "bank-v1-durable-cancel/" + persistence(index) + "/query", true)
      receipt
    }
  }
  private def ledgerCommand(index: Int, phase: Phase): CreditBalanceProtocol.Command = {
    import CreditBalanceProtocol._
    val tx = TxId(operationId); val resource = AccountId(resources(index)); val amount = original.amount
    (index, phase) match {
      case (0, Phase.Prepare) => ReserveFunds(tx, resource, amount)
      case (0, Phase.Commit) => DeductFunds(tx, resource, amount)
      case (0, Phase.Compensate) => ReleaseReservedFunds(tx, resource, amount)
      case (1, Phase.Prepare) => RecordIncomingCredits(tx, resource, amount)
      case (1, Phase.Commit) => CommitIncomingCredits(tx, resource, amount)
      case (1, Phase.Compensate) => CancelIncomingCredit(tx, resource, amount)
      case _ => throw new IllegalArgumentException("unknown bank refund participant")
    }
  }
  private def send(index: Int, phase: Phase): Future[Either[String, Unit]] = ledger(index).ask[CreditBalanceAggregate.Reply](reply => CreditBalanceAggregate.Execute(ledgerCommand(index, phase), reply)).map {
    case CreditBalanceAggregate.Accepted(_) => Right(())
    case CreditBalanceAggregate.Refused(code) => Left(code)
  }
  private def execute(index: Int, phase: Phase, id: OperationIdentity): Future[Product] = {
    validate(id, index, phase)
    query(index, phase, id).flatMap {
      case Some(receipt) => Future.successful(receipt)
      case None => send(index, phase).flatMap {
        case Right(_) => query(index, phase, id).map(_.getOrElse(throw new IllegalStateException("phase reply lacks original durable event")))
        case Left(code) if phase == Phase.Prepare =>
          send(index, Phase.Compensate).flatMap {
            case Left(_) => Future.failed(new IllegalStateException("rejected prepare has no cancellation fence"))
            case Right(_) => history(index).flatMap { events =>
              val prepared = ledgerEvidence(index, Phase.Prepare, events)
              val canceled = ledgerEvidence(index, Phase.Compensate, events)
              if (prepared.isEmpty && canceled.nonEmpty) Future.failed(Technical.OperationNotExecuted(id, "bank-v1-durable-cancel/" + persistence(index) + "/" + code, true))
              else Future.failed(new IllegalStateException("prepare absence not fenced"))
            }
          }
        case Left(code) => Future.failed(new IllegalStateException("phase refused: " + code))
      }
    }
  }
  private def entry(input: BankRefundOriginal): Future[Boolean] = {
    if (input != original || original.refundOperationId.value.isEmpty || operationId == original.paymentTxId.value) Future.successful(false)
    else for {
      collectionState <- ledgerState(0); investorState <- ledgerState(1); o <- orderState()
      events <- readJournal(orderPersistenceId).map(_.map(event))
    } yield collectionState.initialized && investorState.initialized && collectionState.id == original.fundCollectionAccountId && investorState.id == original.investorAccountId &&
      o.id == original.fundOrderId && o.selectedPaymentTxId == original.paymentTxId && o.cashPaymentFinalResults.get(original.paymentTxId).contains("succeeded") &&
      o.taStatus == "rejected" && o.refundOperationId == original.refundOperationId && o.investorAccountId == original.investorAccountId &&
      o.fundCollectionAccountId == original.fundCollectionAccountId && o.amount == original.amount && events.exists {
        case e: FundOrderProtocol.FundPurchaseRefundRequested => e.fundOrderId == original.fundOrderId && e.paymentTxId == original.paymentTxId &&
          e.investorAccountId == original.investorAccountId && e.fundCollectionAccountId == original.fundCollectionAccountId && e.amount == original.amount && e.refundOperationId == original.refundOperationId
        case _ => false
      }
  }
  private def classify(s: StrictState): String = s.status match {
    case StrictStatus.Succeeded => "succeeded"
    case StrictStatus.Aborted => if (s.evidence.values.exists { case Evidence.Confirmed(id, _) => id.phase == Phase.Prepare; case _ => false }) "compensated" else "rejected-before-effects"
    case StrictStatus.RecoveryRequired => if (s.evidence.values.exists(_.isInstanceOf[Evidence.Uncertain])) "outcome-unknown" else "recovery-required"
    case _ => throw new IllegalStateException("nonterminal refund status")
  }
  private def authority(kind: String, input: BankRefundOriginal, context: Technical.CompletionContext): Future[BankRefundResult] = {
    require(input == original && context.original == original, "completion original changed")
    validateTransaction(context.identity)
    coordinator().ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus).map {
      case StrictSagaCoordinator.Status(state) =>
        require(state.identity.contains(context.identity) && state.argsBytes == argsBytes && classify(state) == kind, "unproven refund result")
        BankRefundResult(TxId(context.identity.transactionId))
      case _ => throw new IllegalStateException("no authoritative Saga status")
    }
  }
  private def deliver(kind: String, input: BankRefundResult, context: Technical.CompletionContext): Future[Boolean] = {
    authority(kind, context.original, context).flatMap { actual =>
      require(actual == input, "completion result changed")
      val receiptId = "bank-refund-result-v1/" + operationId + "/" + kind
      val receiptBody = Vector(kind, operationId, original.paymentTxId.value, original.refundOperationId.value,
        original.fundOrderId.value, original.fundCollectionAccountId.value, original.investorAccountId.value,
        DomainConverters.MoneyToWire(original.amount).minorUnits, argsDigest).map(s => s.length.toString + ":" + s).mkString
      val command: FundOrderProtocol.Command = kind match {
        case "succeeded" => FundOrderProtocol.RecordFundRefundSucceeded(input.txid, original.refundOperationId, receiptId, receiptBody)
        case "rejected-before-effects" => FundOrderProtocol.RecordFundRefundRejectedBeforeEffects(input.txid, original.refundOperationId, receiptId, receiptBody)
        case "compensated" => FundOrderProtocol.RecordFundRefundCompensated(input.txid, original.refundOperationId, receiptId, receiptBody)
        case "recovery-required" => FundOrderProtocol.RecordFundRefundRecoveryRequired(input.txid, original.refundOperationId, receiptId, receiptBody)
        case "outcome-unknown" => FundOrderProtocol.RecordFundRefundOutcomeUnknown(input.txid, original.refundOperationId, receiptId, receiptBody)
      }
      order.ask[FundOrderAggregate.Reply](reply => FundOrderAggregate.Execute(command, reply)).map {
        case FundOrderAggregate.Accepted(_) => true
        case FundOrderAggregate.Refused(_) => false
      }
    }
  }
  private def simple[I, O](name: String)(run: I => Future[O]): Technical.Implementation[I, O] =
    Technical.Implementation("bankwealth." + name, version, run)
  private def operation[I, O](name: String)(run: (I, OperationIdentity) => Future[O]): Technical.Implementation[I, O] =
    Technical.Implementation("bankwealth." + name, version, (_: I) => Future.failed(new IllegalArgumentException("operation identity required")), operation = run)
  private def completion[I, O](name: String)(run: (I, Technical.CompletionContext) => Future[O]): Technical.Implementation[I, O] =
    Technical.Implementation("bankwealth." + name, version, (_: I) => Future.failed(new IllegalArgumentException("completion identity required")), completion = run)
  private def input(txid: TxId, resource: String, amount: Money, index: Int): Unit =
    require(txid.value == operationId && resource == resources(index) && amount == original.amount, "phase input differs from original")
  private def queryInput(txid: TxId, version: String, digest: String, participant: String, resource: String, step: String, phase: String, id: OperationIdentity): Unit =
    require(txid.value == id.transaction.transactionId && version == id.transaction.definitionVersion.toString && digest == id.transaction.argsDigest &&
      participant == id.participantId && resource == id.resource && step == id.stepId && phase == id.phase.toString.toLowerCase(java.util.Locale.ROOT), "query input identity mismatch")

  lazy val installed: Technical.Installed = Technical.install(bindings)
  private lazy val bindings: Technical.Bindings = bankBindings
  private def bankBindings: Technical.Bindings = Technical.Bindings(
    BankRefundEntry = simple[BankRefundOriginal, Boolean]("BankRefundEntry")(entry),
    BankRefundAssociation = simple[BankRefundOriginal, Boolean]("BankRefundAssociation")(entry),
    BankRefund0PrepareExecute = operation[BankRefund0PrepareInput, BankRefund0PrepareReceipt]("BankRefund0PrepareExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 0)
      execute(0, Phase.Prepare, id).map { case e: CreditBalanceProtocol.ReserveFundsConfirmed => BankRefund0PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankRefund0PrepareQueryPort = operation[BankRefund0PrepareQuery, Option[BankRefund0PrepareReceipt]]("BankRefund0PrepareQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(0, Phase.Prepare, id).map(_.map { case e: CreditBalanceProtocol.ReserveFundsConfirmed => BankRefund0PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankRefund0CommitExecute = operation[BankRefund0CommitInput, BankRefund0CommitReceipt]("BankRefund0CommitExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 0)
      execute(0, Phase.Commit, id).map { case e: CreditBalanceProtocol.DeductFundsConfirmed => BankRefund0CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankRefund0CommitQueryPort = operation[BankRefund0CommitQuery, Option[BankRefund0CommitReceipt]]("BankRefund0CommitQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(0, Phase.Commit, id).map(_.map { case e: CreditBalanceProtocol.DeductFundsConfirmed => BankRefund0CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankRefund0CompensateExecute = operation[BankRefund0CompensateInput, BankRefund0CompensateReceipt]("BankRefund0CompensateExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 0)
      execute(0, Phase.Compensate, id).map { case e: CreditBalanceProtocol.ReleaseReservedFundsConfirmed => BankRefund0CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankRefund0CompensateQueryPort = operation[BankRefund0CompensateQuery, Option[BankRefund0CompensateReceipt]]("BankRefund0CompensateQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(0, Phase.Compensate, id).map(_.map { case e: CreditBalanceProtocol.ReleaseReservedFundsConfirmed => BankRefund0CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankRefund1PrepareExecute = operation[BankRefund1PrepareInput, BankRefund1PrepareReceipt]("BankRefund1PrepareExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 1)
      execute(1, Phase.Prepare, id).map { case e: CreditBalanceProtocol.RecordIncomingCreditsConfirmed => BankRefund1PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankRefund1PrepareQueryPort = operation[BankRefund1PrepareQuery, Option[BankRefund1PrepareReceipt]]("BankRefund1PrepareQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(1, Phase.Prepare, id).map(_.map { case e: CreditBalanceProtocol.RecordIncomingCreditsConfirmed => BankRefund1PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankRefund1CommitExecute = operation[BankRefund1CommitInput, BankRefund1CommitReceipt]("BankRefund1CommitExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 1)
      execute(1, Phase.Commit, id).map { case e: CreditBalanceProtocol.CommitIncomingCreditsConfirmed => BankRefund1CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankRefund1CommitQueryPort = operation[BankRefund1CommitQuery, Option[BankRefund1CommitReceipt]]("BankRefund1CommitQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(1, Phase.Commit, id).map(_.map { case e: CreditBalanceProtocol.CommitIncomingCreditsConfirmed => BankRefund1CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankRefund1CompensateExecute = operation[BankRefund1CompensateInput, BankRefund1CompensateReceipt]("BankRefund1CompensateExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 1)
      execute(1, Phase.Compensate, id).map { case e: CreditBalanceProtocol.CancelIncomingCreditConfirmed => BankRefund1CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankRefund1CompensateQueryPort = operation[BankRefund1CompensateQuery, Option[BankRefund1CompensateReceipt]]("BankRefund1CompensateQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(1, Phase.Compensate, id).map(_.map { case e: CreditBalanceProtocol.CancelIncomingCreditConfirmed => BankRefund1CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankRefundSucceededAuthority = completion[BankRefundOriginal, BankRefundResult]("BankRefundSucceededAuthority")((input, context) => authority("succeeded", input, context)),
    BankRefundSucceededDelivery = completion[BankRefundResult, Boolean]("BankRefundSucceededDelivery")((input, context) => deliver("succeeded", input, context)),
    BankRefundRejectedBeforeEffectsAuthority = completion[BankRefundOriginal, BankRefundResult]("BankRefundRejectedBeforeEffectsAuthority")((input, context) => authority("rejected-before-effects", input, context)),
    BankRefundRejectedBeforeEffectsDelivery = completion[BankRefundResult, Boolean]("BankRefundRejectedBeforeEffectsDelivery")((input, context) => deliver("rejected-before-effects", input, context)),
    BankRefundCompensatedAuthority = completion[BankRefundOriginal, BankRefundResult]("BankRefundCompensatedAuthority")((input, context) => authority("compensated", input, context)),
    BankRefundCompensatedDelivery = completion[BankRefundResult, Boolean]("BankRefundCompensatedDelivery")((input, context) => deliver("compensated", input, context)),
    BankRefundRecoveryRequiredAuthority = completion[BankRefundOriginal, BankRefundResult]("BankRefundRecoveryRequiredAuthority")((input, context) => authority("recovery-required", input, context)),
    BankRefundRecoveryRequiredDelivery = completion[BankRefundResult, Boolean]("BankRefundRecoveryRequiredDelivery")((input, context) => deliver("recovery-required", input, context)),
    BankRefundOutcomeUnknownAuthority = completion[BankRefundOriginal, BankRefundResult]("BankRefundOutcomeUnknownAuthority")((input, context) => authority("outcome-unknown", input, context)),
    BankRefundOutcomeUnknownDelivery = completion[BankRefundResult, Boolean]("BankRefundOutcomeUnknownDelivery")((input, context) => deliver("outcome-unknown", input, context))
  )
}
