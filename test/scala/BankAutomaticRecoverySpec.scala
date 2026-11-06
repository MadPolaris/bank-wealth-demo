package example.bankwealth.integration

import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.Behaviors
import com.typesafe.config.ConfigFactory
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.service.UnitConfigurationCheck
import net.imadz.infra.saga.strict._
import org.scalatest.funsuite.AnyFunSuite
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

final class BankAutomaticRecoverySpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  private val original = BankPaymentOriginal(OperationId("original-operation"), FundOrderId("original-order"),
    AccountId("customer"), AccountId("collection"), "fund", Money(BigDecimal("10.00"), "CNY"))
  private val identity = TransactionIdentity("original-transaction", "definition", 1, "args-digest",
    "definition-digest", CodecPin("args", 1), "plan-digest")

  private val refund = BankRefundOriginal(original.fundOrderId, TxId("original-payment-transaction"),
    original.investorAccountId, original.fundCollectionAccountId, original.amount, OperationId("original-refund"))
  for (flow <- Vector("payment", "refund"); (name, state, expectedCalls, expectedRight) <- Vector(
    ("uncertain", StrictState(identity = Some(identity), status = StrictStatus.RecoveryRequired), 1, true),
    ("completed", StrictState(identity = Some(identity), status = StrictStatus.Succeeded), 0, true),
    ("interrupted-commit", StrictState(identity = Some(identity), status = StrictStatus.Committing), 1, true),
    ("foreign", StrictState(identity = Some(identity.copy(transactionId = "other")), status = StrictStatus.RecoveryRequired), 0, false))) {
    test("automatic " + flow + " recovery uses retained identity only: " + name) {
      val kit = ActorTestKit(ConfigFactory.load())
      implicit val system: ActorSystem[_] = kit.system
      val calls = kit.createTestProbe[StrictSagaCoordinator.Reconcile]()
      val coordinator = kit.spawn(Behaviors.receiveMessage[StrictSagaCoordinator.Command] {
        case StrictSagaCoordinator.GetStatus(replyTo) =>
          replyTo ! StrictSagaCoordinator.Status(state)
          Behaviors.same
        case request: StrictSagaCoordinator.Reconcile =>
          calls.ref ! request
          request.replyTo ! StrictSagaCoordinator.Status(state.copy(status = StrictStatus.Succeeded))
          Behaviors.same
        case _ => Behaviors.unhandled
      })
      val directory = new BankRuntimeDirectory {
        def account(id: AccountId): Future[BankActorHandle[CreditBalanceAggregate.Request]] = throw new AssertionError("unexpected account")
        def order(id: FundOrderId): Future[BankActorHandle[FundOrderAggregate.Request]] = throw new AssertionError("unexpected order")
        def plan(id: PlanId): Future[BankActorHandle[SipPlanAggregate.Request]] = throw new AssertionError("unexpected plan")
        def ensureCash(value: BankPaymentOriginal): Future[BankCashRuntime] = {
          assert(value == original)
          Future.successful(BankCashRuntime(original, identity.transactionId,
            BankActorHandle("owned/payment-saga", coordinator), null, null))
        }
        def ensureRefund(value: BankRefundOriginal): Future[BankRefundRuntime] = {
          assert(value == refund && flow == "refund")
          Future.successful(BankRefundRuntime(refund, identity.transactionId,
            BankActorHandle("owned/refund-saga", coordinator), null, null))
        }
        def ensureTa(value: BankTaEffectRequest): Future[BankTaRuntime] = throw new AssertionError("unexpected TA")
        def ensureSipDispatch(value: SipOccurrence): Future[BankSipDispatchRuntime] = throw new AssertionError("unexpected occurrence")
        def close(): Unit = ()
      }
      try {
        val journal = new BankJournal {
          val namespace = "automatic-recovery"
          def persistenceIds() = akka.stream.scaladsl.Source.empty[String]
          def currentEvents(pid: String, after: Long) = Future.successful(Vector.empty[BankJournalEnvelope])
          def events(pid: String, after: Long) = akka.stream.scaladsl.Source.empty[BankJournalEnvelope]
          def close(): Unit = ()
        }
        val recovery = new BankRecovery(directory, journal, null, null, "trusted-machine-token")
        assert(Await.result(if (flow == "payment") recovery.resumePayment(original) else recovery.resumeRefund(refund), 5.seconds).isRight == expectedRight)
        if (expectedCalls == 1) {
          val request = calls.receiveMessage()
          assert(request.identity == identity && request.authorization == "trusted-machine-token" && request.maxInteractions == 32)
        }
        calls.expectNoMessage(100.millis)
      } finally kit.shutdownTestKit()
    }
  }
}
