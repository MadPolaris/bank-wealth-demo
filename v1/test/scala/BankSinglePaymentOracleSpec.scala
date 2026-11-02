package example.bankwealth.service

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.Sink
import com.typesafe.config.ConfigFactory
import example.bankwealth.application.{bank_cash_payment_v1Execution => Execution, bank_payment_hostDefinition => Definition, bank_payment_hostHost => Host}
import example.bankwealth.bindings.{BankBalanceComputations, BankPaymentBindings, StableOrderIdentity}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.{DurableRunObserver, PersistentMonarch}
import org.scalatest.funsuite.AnyFunSuite
import scalapb.GeneratedMessage
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

/** P27-1 explicit single-purchase oracle: one 100.00 purchase from 1000.00/0.00 must end at
  * 900.00/100.00 with an exact, independently-written expectation for every participant's
  * ordered PB receipt sequence (kind, txid, resource, amount), the Saga identity/state, the
  * durable Monarch checkpoint, and order-last-commit. Amounts are asserted before the run
  * reads any result back, mirroring the original package's single-purchase conservation
  * requirement; this file does not re-certify the delivery matrix covered by
  * BankPaymentDeliveryAcceptanceSpec.
  */
final class BankSinglePaymentOracleSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)

  test("single 100.00 purchase from 1000.00/0.00 ends 900.00/100.00 with exact per-participant PB sequences, Saga identity and order last commit") {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: scala.concurrent.ExecutionContext = system.executionContext
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    try {
      val journal = PersistenceTestKit(system)
      val query = PersistenceQuery(system).readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
      def read(pid: String): Future[Vector[GeneratedMessage]] =
        query.currentEventsByPersistenceId(pid, 0L, Long.MaxValue).runWith(Sink.seq).map(_.map(_.event).collect { case p: GeneratedMessage => p }.toVector)
      val investorId = AccountId("investor"); val collectionId = AccountId("collection")
      val amount = Money(BigDecimal("100.00"), "CNY")
      val operationId = OperationId("cash-operation"); val orderId = FundOrderId("order")
      val original = BankPaymentOriginal(operationId, orderId, investorId, collectionId, "FUND-中文-001", amount)
      val investor = kit.spawn(CreditBalanceAggregate("oracle-investor", CreditBalanceState.empty.copy(id = investorId), BankBalanceComputations))
      val collection = kit.spawn(CreditBalanceAggregate("oracle-collection", CreditBalanceState.empty.copy(id = collectionId), BankBalanceComputations))
      val order = kit.spawn(FundOrderAggregate("oracle-order", FundOrderState.empty.copy(id = orderId), StableOrderIdentity,
        new FundOrderAggregate.ExternalAuthority {
          def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false
        }))
      val ledgerReplies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
      def ledger(actor: ActorRef[CreditBalanceAggregate.Request], command: CreditBalanceProtocol.Command): Unit = {
        actor ! CreditBalanceAggregate.Execute(command, ledgerReplies.ref)
        assert(ledgerReplies.receiveMessage().isInstanceOf[CreditBalanceAggregate.Accepted])
      }
      ledger(investor, CreditBalanceProtocol.InitializeAccount(investorId, "CNY", Money(BigDecimal("1000.00"), "CNY")))
      ledger(collection, CreditBalanceProtocol.InitializeAccount(collectionId, "CNY", Money(BigDecimal("0.00"), "CNY")))
      val orderReplies = kit.createTestProbe[FundOrderAggregate.Reply]()
      order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(operationId, orderId, investorId, collectionId, original.fundCode, amount), orderReplies.ref)
      assert(orderReplies.receiveMessage().isInstanceOf[FundOrderAggregate.Accepted])

      @volatile var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
      val bindings = new BankPaymentBindings(original, investor, "oracle-investor", collection, "oracle-collection", order, "oracle-order", read, () => coordinator)
      coordinator = kit.spawn(Definition.coordinator("oracle-saga", Definition.fromTechnical(bindings.installed), new ReconcileAuthorizer {
        def authorize(id: TransactionIdentity, token: String): Either[String, String] = Left("not authorized")
      }))
      val host = kit.spawn(Host("oracle-host", coordinator, bindings.installed))
      val checkpoints = kit.createTestProbe[Execution.State]()
      val completed = kit.createTestProbe[String]()
      val observer = new DurableRunObserver[Execution.State] {
        override def onCheckpointCommitted(cursor: String, metadata: Map[String, String], state: Execution.State): Unit = checkpoints.ref ! state
        override def onCompleted(id: String): Unit = completed.ref ! "succeeded"
        override def onFailed(id: String, cursor: String, reason: String): Unit = completed.ref ! "failed"
      }
      val execution = kit.spawn(Execution.behavior("oracle-monarch", Execution.install(new Execution.PureStages {}, host), observer))
      val starts = kit.createTestProbe[PersistentMonarch.RunReply]()
      execution ! PersistentMonarch.StartRun("cash-run", bindings.parentInput, starts.ref)
      assert(starts.receiveMessage().isInstanceOf[PersistentMonarch.Accepted])

      // Oracle written from the package requirement, not from observed output.
      val statuses = kit.createTestProbe[StrictSagaCoordinator.Reply]()
      def status(): StrictState = { coordinator ! StrictSagaCoordinator.GetStatus(statuses.ref); statuses.receiveMessage().asInstanceOf[StrictSagaCoordinator.Status].state }
      statuses.awaitAssert(assert(status().terminal && status().status == StrictStatus.Succeeded), 20.seconds, 100.millis)
      assert(status().identity.exists(_.transactionId == bindings.operationId), "Saga identity must be the operation identity")

      val balances = kit.createTestProbe[CreditBalanceState]()
      def balance(actor: ActorRef[CreditBalanceAggregate.Request]): CreditBalanceState = { actor ! CreditBalanceAggregate.GetState(balances.ref); balances.receiveMessage() }
      assert(balance(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
      assert(balance(collection).accountBalance("CNY").amount == BigDecimal("100.00"))

      // Exact per-participant PB receipt sequences; each receipt's txid must be the same single payment transaction.
      def receipts(pid: String): Vector[(String, String, String, BigDecimal)] =
        journal.persistedInStorage(pid).collect {
          case p: CreditBalanceReserveFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceReserveFundsConfirmedPB(p); ("reserve", e.txid.value, e.resource.value, e.amount.amount)
          case p: CreditBalanceDeductFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(p); ("deduct", e.txid.value, e.resource.value, e.amount.amount)
          case p: CreditBalanceCommitIncomingCreditsConfirmedPB => val e = DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(p); ("credit", e.txid.value, e.resource.value, e.amount.amount)
          case p: CreditBalanceReleaseReservedFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceReleaseReservedFundsConfirmedPB(p); ("release", e.txid.value, e.resource.value, e.amount.amount)
        }.toVector
      val investorReceipts = receipts("oracle-investor")
      val collectionReceipts = receipts("oracle-collection")
      assert(investorReceipts.map(_._1) == Vector("reserve", "deduct"))
      assert(collectionReceipts.map(_._1) == Vector("credit"))
      val txids = (investorReceipts ++ collectionReceipts).map(_._2).distinct
      assert(txids.size == 1, "all three participant phases must share one payment transaction id")
      assert(investorReceipts(0)._3 == "investor" && investorReceipts(0)._4 == BigDecimal("100.00"))
      assert(investorReceipts(1)._3 == "investor" && investorReceipts(1)._4 == BigDecimal("100.00"))
      assert(collectionReceipts(0)._3 == "collection" && collectionReceipts(0)._4 == BigDecimal("100.00"))
      // Reserved funds are fully consumed: no release receipt in a successful purchase.
      assert(!journal.persistedInStorage("oracle-investor").exists(_.isInstanceOf[CreditBalanceReleaseReservedFundsConfirmedPB]))

      // Durable Monarch checkpoint names the same transaction; the run completes exactly once.
      assert(checkpoints.receiveMessage(5.seconds).pay_cash_purchase_paymentTxid.contains(TxId(txids.head)))
      assert(completed.receiveMessage(5.seconds) == "succeeded")
      assert(!journal.persistedInStorage("oracle-monarch").exists(_.isInstanceOf[PersistentMonarch.RunFailedEvt]))

      // Order-last-commit: the settlement result is present, and a later settlement attempt changes nothing.
      val orders = kit.createTestProbe[FundOrderState]()
      def orderState(): FundOrderState = { order ! FundOrderAggregate.GetState(orders.ref); orders.receiveMessage() }
      orders.awaitAssert(assert(orderState().cashPaymentFinalResults.get(TxId(txids.head)).contains("succeeded")), 15.seconds, 100.millis)
      val before = Vector("oracle-investor", "oracle-collection", "oracle-order", "oracle-saga", "oracle-host", "oracle-monarch").map(p => p -> journal.persistedInStorage(p).size).toMap
      val retained = orderState()
      order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(operationId, orderId, investorId, collectionId, original.fundCode, Money(BigDecimal("101.00"), "CNY")), orderReplies.ref)
      assert(orderReplies.receiveMessage() == FundOrderAggregate.Refused("ORDER_REPLAY_CONFLICT"))
      order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(operationId, orderId, investorId, collectionId, original.fundCode, amount), orderReplies.ref)
      assert(orderReplies.receiveMessage() == FundOrderAggregate.Accepted(Vector.empty))
      assert(orderState() == retained)
      before.foreach { case (pid, count) => assert(journal.persistedInStorage(pid).size == count) }
      assert(balance(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
      assert(balance(collection).accountBalance("CNY").amount == BigDecimal("100.00"))
    } finally kit.shutdownTestKit()
  }
}
