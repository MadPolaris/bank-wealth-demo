package example.bankwealth.bindings

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import example.bankwealth.application.{bank_cash_payment_v1Execution => Execution, bank_payment_hostDefinition => Definition, bank_payment_hostHost => Host, bank_payment_hostTechnicalPorts => Technical}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import net.imadz.infra.saga.strict._
import scalapb.GeneratedMessage
import java.security.MessageDigest
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

final class BankPaymentBindings(
    val original: BankPaymentOriginal,
    investor: ActorRef[CreditBalanceAggregate.Request], investorPersistenceId: String,
    collection: ActorRef[CreditBalanceAggregate.Request], collectionPersistenceId: String,
    order: ActorRef[FundOrderAggregate.Request], orderPersistenceId: String,
    readJournal: String => Future[Vector[GeneratedMessage]],
    coordinator: () => ActorRef[StrictSagaCoordinator.Command]
)(implicit system: ActorSystem[_]) {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)
  private val version = "bank-v1-1"
  val parentInput: Execution.State = Execution.State(Execution.Inputs(original.operationId, original.operationId,
    original.investorAccountId, original.fundOrderId, original.fundCollectionAccountId, original.amount, original.fundCode))
  val operationId: String = Host.operationIdentity(parentInput)
  private val args = BankPaymentArgs(original.investorAccountId, original.fundOrderId, original.fundCollectionAccountId, original.amount)
  private val argsBytes = Definition.argsCodec.encode(args)
  private val argsDigest = MessageDigest.getInstance("SHA-256").digest(argsBytes.toByteArray).map(b => f"${b & 0xff}%02x").mkString
  private lazy val definition = Definition.definition(Definition.fromTechnical(installed))
  private val participants = Vector("investorCreditBalance", "collectionCreditBalance", "orderFundOrderTCC")
  private val steps = Vector("reserve-investor-funds", "credit-fund-collection", "reserve-cash-fund-order")
  private val resources = Vector(original.investorAccountId.value, original.fundCollectionAccountId.value, original.fundOrderId.value)
  require(investor != null && collection != null && order != null && readJournal != null && coordinator != null)
  require(original.investorAccountId != original.fundCollectionAccountId && original.amount.currency == "CNY" && original.amount.amount > 0)

  private def validateTransaction(id: TransactionIdentity): Unit = {
    require(id != null && id.transactionId == operationId && id.definitionName == definition.name &&
      id.definitionVersion == definition.version && id.definitionDigest == definition.definitionDigest &&
      id.argsCodec == Definition.argsCodec.pin && id.argsDigest == argsDigest, "payment authority identity mismatch")
  }
  private def validate(id: OperationIdentity, index: Int, phase: Phase): Unit = {
    validateTransaction(id.transaction)
    require(id.participantId == participants(index) && id.resource == resources(index) && id.stepId == steps(index) && id.phase == phase,
      "payment operation resource or phase mismatch")
  }
  private def ledger(index: Int): ActorRef[CreditBalanceAggregate.Request] = if (index == 0) investor else collection
  private def persistence(index: Int): String = Vector(investorPersistenceId, collectionPersistenceId, orderPersistenceId)(index)
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
    case x: FundOrderFundPurchaseSettlementRequestedPB => DomainConverters.decodeFundOrderFundPurchaseSettlementRequestedPB(x)
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
  private def orderEvidence(phase: Phase, events: Vector[Any]): Option[Product] = events.collectFirst {
    case e: FundOrderProtocol.ReserveFundSubscriptionConfirmed if phase == Phase.Prepare && e.txid.value == operationId && e.resource == original.fundOrderId && e.amount == original.amount => e
    case e: FundOrderProtocol.FundSubscriptionPaymentConfirmed if phase == Phase.Commit && e.txid.value == operationId && e.resource == original.fundOrderId && e.amount == original.amount => e
    case e: FundOrderProtocol.CashFundSubscriptionCanceled if phase == Phase.Compensate && e.txid.value == operationId && e.resource == original.fundOrderId && e.amount == original.amount => e
  }
  private def query(index: Int, phase: Phase, id: OperationIdentity): Future[Option[Product]] = {
    validate(id, index, phase)
    history(index).map(events => if (index == 2) orderEvidence(phase, events) else ledgerEvidence(index, phase, events))
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
      case _ => throw new IllegalArgumentException("unknown bank ledger participant")
    }
  }
  private def orderCommand(phase: Phase): FundOrderProtocol.Command = phase match {
    case Phase.Prepare => FundOrderProtocol.ReserveFundSubscription(TxId(operationId), original.fundOrderId, original.amount)
    case Phase.Commit => FundOrderProtocol.ConfirmFundSubscriptionPayment(TxId(operationId), original.fundOrderId, original.amount)
    case Phase.Compensate => FundOrderProtocol.CancelCashFundSubscription(TxId(operationId), original.fundOrderId, original.amount)
  }
  private def send(index: Int, phase: Phase): Future[Either[String, Unit]] = if (index == 2) {
    order.ask[FundOrderAggregate.Reply](reply => FundOrderAggregate.Execute(orderCommand(phase), reply)).map {
      case FundOrderAggregate.Accepted(_) => Right(())
      case FundOrderAggregate.Refused(code) => Left(code)
    }
  } else ledger(index).ask[CreditBalanceAggregate.Reply](reply => CreditBalanceAggregate.Execute(ledgerCommand(index, phase), reply)).map {
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
              val prepared = if (index == 2) orderEvidence(Phase.Prepare, events) else ledgerEvidence(index, Phase.Prepare, events)
              val canceled = if (index == 2) orderEvidence(Phase.Compensate, events) else ledgerEvidence(index, Phase.Compensate, events)
              if (prepared.isEmpty && canceled.nonEmpty) Future.failed(Technical.OperationNotExecuted(id, "bank-v1-durable-cancel/" + persistence(index) + "/" + code, true))
              else Future.failed(new IllegalStateException("prepare absence not fenced"))
            }
          }
        case Left(code) => Future.failed(new IllegalStateException("phase refused: " + code))
      }
    }
  }
  private def entry(input: BankPaymentOriginal): Future[Boolean] = {
    if (input != original) Future.successful(false)
    else for {
      a <- ledgerState(0); b <- ledgerState(1); o <- orderState(); events <- history(2)
    } yield a.initialized && b.initialized && a.id == original.investorAccountId && b.id == original.fundCollectionAccountId &&
      o.id == original.fundOrderId && o.operationId == original.operationId && o.investorAccountId == a.id &&
      o.fundCollectionAccountId == b.id && o.fundCode == original.fundCode && o.amount == original.amount && events.exists {
        case e: FundOrderProtocol.FundPurchaseSettlementRequested => e.operationId == original.operationId && e.fundOrderId == original.fundOrderId &&
          e.investorAccountId == original.investorAccountId && e.fundCollectionAccountId == original.fundCollectionAccountId && e.fundCode == original.fundCode && e.amount == original.amount
        case _ => false
      }
  }
  private def classify(s: StrictState): String = s.status match {
    case StrictStatus.Succeeded => "succeeded"
    case StrictStatus.Aborted => if (s.evidence.values.exists { case Evidence.Confirmed(id, _) => id.phase == Phase.Prepare; case _ => false }) "compensated" else "rejected-before-effects"
    case StrictStatus.RecoveryRequired => if (s.evidence.values.exists(_.isInstanceOf[Evidence.Uncertain])) "outcome-unknown" else "recovery-required"
    case _ => throw new IllegalStateException("nonterminal payment status")
  }
  private def authority(kind: String, input: BankPaymentOriginal, context: Technical.CompletionContext): Future[BankPaymentResult] = {
    require(input == original && context.original == original, "completion original changed")
    validateTransaction(context.identity)
    coordinator().ask[StrictSagaCoordinator.Reply](StrictSagaCoordinator.GetStatus).map {
      case StrictSagaCoordinator.Status(state) =>
        require(state.identity.contains(context.identity) && state.argsBytes == argsBytes && classify(state) == kind, "unproven payment result")
        BankPaymentResult(TxId(context.identity.transactionId))
      case _ => throw new IllegalStateException("no authoritative Saga status")
    }
  }
  private def deliver(kind: String, input: BankPaymentResult, context: Technical.CompletionContext): Future[Boolean] = {
    authority(kind, context.original, context).flatMap { actual =>
      require(actual == input, "completion result changed")
      val command: FundOrderProtocol.Command = kind match {
        case "succeeded" => FundOrderProtocol.RecordFundCashPaymentSucceeded(input.txid)
        case "rejected-before-effects" => FundOrderProtocol.RecordFundCashPaymentRejectedBeforeEffects(input.txid)
        case "compensated" => FundOrderProtocol.RecordFundCashPaymentCompensated(input.txid)
        case "recovery-required" => FundOrderProtocol.RecordFundCashPaymentRecoveryRequired(input.txid)
        case "outcome-unknown" => FundOrderProtocol.RecordFundCashPaymentOutcomeUnknown(input.txid)
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
    BankPaymentEntry = simple[BankPaymentOriginal, Boolean]("BankPaymentEntry")(entry),
    BankPaymentAssociation = simple[BankPaymentOriginal, Boolean]("BankPaymentAssociation")(entry),
    BankPayment0PrepareExecute = operation[BankPayment0PrepareInput, BankPayment0PrepareReceipt]("BankPayment0PrepareExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 0)
      execute(0, Phase.Prepare, id).map { case e: CreditBalanceProtocol.ReserveFundsConfirmed => BankPayment0PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment0PrepareQueryPort = operation[BankPayment0PrepareQuery, Option[BankPayment0PrepareReceipt]]("BankPayment0PrepareQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(0, Phase.Prepare, id).map(_.map { case e: CreditBalanceProtocol.ReserveFundsConfirmed => BankPayment0PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment0CommitExecute = operation[BankPayment0CommitInput, BankPayment0CommitReceipt]("BankPayment0CommitExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 0)
      execute(0, Phase.Commit, id).map { case e: CreditBalanceProtocol.DeductFundsConfirmed => BankPayment0CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment0CommitQueryPort = operation[BankPayment0CommitQuery, Option[BankPayment0CommitReceipt]]("BankPayment0CommitQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(0, Phase.Commit, id).map(_.map { case e: CreditBalanceProtocol.DeductFundsConfirmed => BankPayment0CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment0CompensateExecute = operation[BankPayment0CompensateInput, BankPayment0CompensateReceipt]("BankPayment0CompensateExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 0)
      execute(0, Phase.Compensate, id).map { case e: CreditBalanceProtocol.ReleaseReservedFundsConfirmed => BankPayment0CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment0CompensateQueryPort = operation[BankPayment0CompensateQuery, Option[BankPayment0CompensateReceipt]]("BankPayment0CompensateQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(0, Phase.Compensate, id).map(_.map { case e: CreditBalanceProtocol.ReleaseReservedFundsConfirmed => BankPayment0CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment1PrepareExecute = operation[BankPayment1PrepareInput, BankPayment1PrepareReceipt]("BankPayment1PrepareExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 1)
      execute(1, Phase.Prepare, id).map { case e: CreditBalanceProtocol.RecordIncomingCreditsConfirmed => BankPayment1PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment1PrepareQueryPort = operation[BankPayment1PrepareQuery, Option[BankPayment1PrepareReceipt]]("BankPayment1PrepareQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(1, Phase.Prepare, id).map(_.map { case e: CreditBalanceProtocol.RecordIncomingCreditsConfirmed => BankPayment1PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment1CommitExecute = operation[BankPayment1CommitInput, BankPayment1CommitReceipt]("BankPayment1CommitExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 1)
      execute(1, Phase.Commit, id).map { case e: CreditBalanceProtocol.CommitIncomingCreditsConfirmed => BankPayment1CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment1CommitQueryPort = operation[BankPayment1CommitQuery, Option[BankPayment1CommitReceipt]]("BankPayment1CommitQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(1, Phase.Commit, id).map(_.map { case e: CreditBalanceProtocol.CommitIncomingCreditsConfirmed => BankPayment1CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount, e.currency, e.available); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment1CompensateExecute = operation[BankPayment1CompensateInput, BankPayment1CompensateReceipt]("BankPayment1CompensateExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 1)
      execute(1, Phase.Compensate, id).map { case e: CreditBalanceProtocol.CancelIncomingCreditConfirmed => BankPayment1CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment1CompensateQueryPort = operation[BankPayment1CompensateQuery, Option[BankPayment1CompensateReceipt]]("BankPayment1CompensateQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(1, Phase.Compensate, id).map(_.map { case e: CreditBalanceProtocol.CancelIncomingCreditConfirmed => BankPayment1CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, AccountId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment2PrepareExecute = operation[BankPayment2PrepareInput, BankPayment2PrepareReceipt]("BankPayment2PrepareExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 2)
      execute(2, Phase.Prepare, id).map { case e: FundOrderProtocol.ReserveFundSubscriptionConfirmed => BankPayment2PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, FundOrderId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment2PrepareQueryPort = operation[BankPayment2PrepareQuery, Option[BankPayment2PrepareReceipt]]("BankPayment2PrepareQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(2, Phase.Prepare, id).map(_.map { case e: FundOrderProtocol.ReserveFundSubscriptionConfirmed => BankPayment2PrepareReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, FundOrderId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment2CommitExecute = operation[BankPayment2CommitInput, BankPayment2CommitReceipt]("BankPayment2CommitExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 2)
      execute(2, Phase.Commit, id).map { case e: FundOrderProtocol.FundSubscriptionPaymentConfirmed => BankPayment2CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, FundOrderId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment2CommitQueryPort = operation[BankPayment2CommitQuery, Option[BankPayment2CommitReceipt]]("BankPayment2CommitQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(2, Phase.Commit, id).map(_.map { case e: FundOrderProtocol.FundSubscriptionPaymentConfirmed => BankPayment2CommitReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, FundOrderId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPayment2CompensateExecute = operation[BankPayment2CompensateInput, BankPayment2CompensateReceipt]("BankPayment2CompensateExecute") { (p, id) =>
      input(p.txid, p.resource.value, p.amount, 2)
      execute(2, Phase.Compensate, id).map { case e: FundOrderProtocol.CashFundSubscriptionCanceled => BankPayment2CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, FundOrderId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") }
    },
    BankPayment2CompensateQueryPort = operation[BankPayment2CompensateQuery, Option[BankPayment2CompensateReceipt]]("BankPayment2CompensateQueryPort") { (p, id) =>
      queryInput(p.transaction, p.definitionVersion, p.argsDigest, p.participant, p.resource.value, p.step, p.phase, id)
      query(2, Phase.Compensate, id).map(_.map { case e: FundOrderProtocol.CashFundSubscriptionCanceled => BankPayment2CompensateReceipt(TxId(id.transaction.transactionId), id.transaction.definitionVersion.toString, id.transaction.argsDigest, id.participantId, FundOrderId(id.resource), id.stepId, id.phase.toString.toLowerCase(java.util.Locale.ROOT), e.txid, e.resource, e.amount); case _ => throw new IllegalStateException("wrong persisted phase event") })
    },
    BankPaymentSucceededAuthority = completion[BankPaymentOriginal, BankPaymentResult]("BankPaymentSucceededAuthority")((input, context) => authority("succeeded", input, context)),
    BankPaymentSucceededDelivery = completion[BankPaymentResult, Boolean]("BankPaymentSucceededDelivery")((input, context) => deliver("succeeded", input, context)),
    BankPaymentRejectedBeforeEffectsAuthority = completion[BankPaymentOriginal, BankPaymentResult]("BankPaymentRejectedBeforeEffectsAuthority")((input, context) => authority("rejected-before-effects", input, context)),
    BankPaymentRejectedBeforeEffectsDelivery = completion[BankPaymentResult, Boolean]("BankPaymentRejectedBeforeEffectsDelivery")((input, context) => deliver("rejected-before-effects", input, context)),
    BankPaymentCompensatedAuthority = completion[BankPaymentOriginal, BankPaymentResult]("BankPaymentCompensatedAuthority")((input, context) => authority("compensated", input, context)),
    BankPaymentCompensatedDelivery = completion[BankPaymentResult, Boolean]("BankPaymentCompensatedDelivery")((input, context) => deliver("compensated", input, context)),
    BankPaymentRecoveryRequiredAuthority = completion[BankPaymentOriginal, BankPaymentResult]("BankPaymentRecoveryRequiredAuthority")((input, context) => authority("recovery-required", input, context)),
    BankPaymentRecoveryRequiredDelivery = completion[BankPaymentResult, Boolean]("BankPaymentRecoveryRequiredDelivery")((input, context) => deliver("recovery-required", input, context)),
    BankPaymentOutcomeUnknownAuthority = completion[BankPaymentOriginal, BankPaymentResult]("BankPaymentOutcomeUnknownAuthority")((input, context) => authority("outcome-unknown", input, context)),
    BankPaymentOutcomeUnknownDelivery = completion[BankPaymentResult, Boolean]("BankPaymentOutcomeUnknownDelivery")((input, context) => deliver("outcome-unknown", input, context))
  )
}
