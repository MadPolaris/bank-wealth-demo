package example.bankwealth.service

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.serialization.{SerializationExtension, Serializers}
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
import scala.concurrent.{Await, Future, Promise}
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
      val expectedInput = Execution.State(Execution.Inputs(operationId, operationId, investorId, orderId, collectionId, amount, original.fundCode))
      val expectedTxid = TxId(Host.operationIdentity(expectedInput))
      val underlying = Definition.fromTechnical(bindings.installed)
      val collectionCommitted = kit.createTestProbe[Unit]()
      val allowCollectionAck = Promise[Unit]()
      val orderCommitChecks = kit.createTestProbe[Boolean]()
      val ports = new Definition.Ports {
        val technical = underlying.technical
        val installed = underlying.installed
        val reserve_investor_funds_prepare = underlying.reserve_investor_funds_prepare
        val reserve_investor_funds_commit = underlying.reserve_investor_funds_commit
        val reserve_investor_funds_compensate = underlying.reserve_investor_funds_compensate
        val credit_fund_collection_prepare = underlying.credit_fund_collection_prepare
        val credit_fund_collection_commit = new PhasePort[Definition.Args, BankPayment1CommitReceipt] {
          val receiptCodec = underlying.credit_fund_collection_commit.receiptCodec
          val querySafety = underlying.credit_fund_collection_commit.querySafety
          def execute(request: OperationRequest[Definition.Args]): Future[PhaseOutcome[BankPayment1CommitReceipt]] =
            underlying.credit_fund_collection_commit.execute(request).flatMap { actual =>
              collectionCommitted.ref ! (())
              allowCollectionAck.future.map(_ => actual)
            }
          def query(request: OperationRequest[Definition.Args]): Future[PhaseOutcome[BankPayment1CommitReceipt]] =
            allowCollectionAck.future.flatMap(_ => underlying.credit_fund_collection_commit.query(request))
        }
        val credit_fund_collection_compensate = underlying.credit_fund_collection_compensate
        val reserve_cash_fund_order_prepare = underlying.reserve_cash_fund_order_prepare
        val reserve_cash_fund_order_commit = new PhasePort[Definition.Args, BankPayment2CommitReceipt] {
          val receiptCodec = underlying.reserve_cash_fund_order_commit.receiptCodec
          val querySafety = underlying.reserve_cash_fund_order_commit.querySafety
          def execute(request: OperationRequest[Definition.Args]): Future[PhaseOutcome[BankPayment2CommitReceipt]] = {
            val investorPaid = journal.persistedInStorage("oracle-investor").collect {
              case p: CreditBalanceDeductFundsConfirmedPB => DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(p)
            }.exists(e => e.txid == expectedTxid && e.resource == investorId && e.amount == amount)
            val collectionPaid = journal.persistedInStorage("oracle-collection").collect {
              case p: CreditBalanceCommitIncomingCreditsConfirmedPB => DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(p)
            }.exists(e => e.txid == expectedTxid && e.resource == collectionId && e.amount == amount)
            orderCommitChecks.ref ! (investorPaid && collectionPaid && allowCollectionAck.isCompleted)
            underlying.reserve_cash_fund_order_commit.execute(request)
          }
          def query(request: OperationRequest[Definition.Args]): Future[PhaseOutcome[BankPayment2CommitReceipt]] =
            underlying.reserve_cash_fund_order_commit.query(request)
        }
        val reserve_cash_fund_order_compensate = underlying.reserve_cash_fund_order_compensate
      }
      coordinator = kit.spawn(Definition.coordinator("oracle-saga", ports, new ReconcileAuthorizer {
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

      val statuses = kit.createTestProbe[StrictSagaCoordinator.Reply]()
      def status(): StrictState = { coordinator ! StrictSagaCoordinator.GetStatus(statuses.ref); statuses.receiveMessage().asInstanceOf[StrictSagaCoordinator.Status].state }
      collectionCommitted.receiveMessage(10.seconds)
      assert(!journal.persistedInStorage("oracle-order").exists(_.isInstanceOf[FundOrderFundSubscriptionPaymentConfirmedPB]))
      assert(!journal.persistedInStorage("oracle-monarch").exists(_.isInstanceOf[PersistentMonarch.StageDone]))
      assert(!status().terminal)
      allowCollectionAck.success(())
      assert(orderCommitChecks.receiveMessage(10.seconds))
      statuses.awaitAssert(assert(status().terminal && status().status == StrictStatus.Succeeded), 20.seconds, 100.millis)
      assert(status().identity.exists(_.transactionId == expectedTxid.value))
      assert(status().commitDecision)
      assert(bindings.parentInput == expectedInput)

      val balances = kit.createTestProbe[CreditBalanceState]()
      def balance(actor: ActorRef[CreditBalanceAggregate.Request]): CreditBalanceState = { actor ! CreditBalanceAggregate.GetState(balances.ref); balances.receiveMessage() }
      assert(balance(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
      assert(balance(collection).accountBalance("CNY").amount == BigDecimal("100.00"))

      def receipts(pid: String): Vector[(String, TxId, String, Money)] =
        journal.persistedInStorage(pid).collect {
          case p: CreditBalanceReserveFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceReserveFundsConfirmedPB(p); ("reserve", e.txid, e.resource.value, e.amount)
          case p: CreditBalanceDeductFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(p); ("deduct", e.txid, e.resource.value, e.amount)
          case p: CreditBalanceRecordIncomingCreditsConfirmedPB => val e = DomainConverters.decodeCreditBalanceRecordIncomingCreditsConfirmedPB(p); ("incoming", e.txid, e.resource.value, e.amount)
          case p: CreditBalanceCommitIncomingCreditsConfirmedPB => val e = DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(p); ("credit", e.txid, e.resource.value, e.amount)
          case p: CreditBalanceReleaseReservedFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceReleaseReservedFundsConfirmedPB(p); ("release", e.txid, e.resource.value, e.amount)
          case p: CreditBalanceCancelIncomingCreditConfirmedPB => val e = DomainConverters.decodeCreditBalanceCancelIncomingCreditConfirmedPB(p); ("cancel-incoming", e.txid, e.resource.value, e.amount)
          case p: FundOrderReserveFundSubscriptionConfirmedPB => val e = DomainConverters.decodeFundOrderReserveFundSubscriptionConfirmedPB(p); ("subscribe", e.txid, e.resource.value, e.amount)
          case p: FundOrderFundSubscriptionPaymentConfirmedPB => val e = DomainConverters.decodeFundOrderFundSubscriptionPaymentConfirmedPB(p); ("pay-order", e.txid, e.resource.value, e.amount)
          case p: FundOrderCashFundSubscriptionCanceledPB => val e = DomainConverters.decodeFundOrderCashFundSubscriptionCanceledPB(p); ("cancel-order", e.txid, e.resource.value, e.amount)
        }.toVector
      for ((pid, resource, phases) <- Vector(
        ("oracle-investor", investorId.value, Vector("reserve", "deduct")),
        ("oracle-collection", collectionId.value, Vector("incoming", "credit")),
        ("oracle-order", orderId.value, Vector("subscribe", "pay-order")))) {
        assert(receipts(pid) == phases.map(phase => (phase, expectedTxid, resource, amount)))
      }
      assert(balance(investor).reservedAmount.isEmpty)
      assert(balance(investor).committedOutgoing == Map(expectedTxid -> amount))
      assert(balance(collection).committedIncoming == Map(expectedTxid -> amount))
      val expectedState = expectedInput.copy(pay_cash_purchase_paymentTxid = Some(expectedTxid))
      assert(checkpoints.receiveMessage(5.seconds) == expectedState)
      assert(completed.receiveMessage(5.seconds) == "succeeded")
      val runEvents = journal.persistedInStorage("oracle-monarch").toVector
      assert(runEvents.size == 3)
      val start = runEvents.collect { case e: PersistentMonarch.RunStarted => e }.ensuring(_.size == 1).head
      assert(start.runId == "cash-run" && start.stageCursors == Vector("pay-cash-purchase#0"))
      assert(Execution.codec.decode(start.initialSnapshot) == expectedInput)
      assert(start.initialSnapshot.toVector == Execution.codec.encode(expectedInput).toVector)
      val done = runEvents.collect { case e: PersistentMonarch.StageDone => e }.ensuring(_.size == 1).head
      assert(done.cursor == "pay-cash-purchase#0" && done.metadata.isEmpty && done.timestamp > 0)
      assert(Execution.codec.decode(done.snapshot) == expectedState)
      assert(done.snapshot.toVector == Execution.codec.encode(expectedState).toVector)
      assert(runEvents.collect { case e: PersistentMonarch.RunCompleted => e.runId } == Vector("cash-run"))

      val orders = kit.createTestProbe[FundOrderState]()
      def orderState(): FundOrderState = { order ! FundOrderAggregate.GetState(orders.ref); orders.receiveMessage() }
      orders.awaitAssert(assert(orderState().cashPaymentFinalResults.get(expectedTxid).contains("succeeded")), 15.seconds, 100.millis)
      val serialization = SerializationExtension(system.classicSystem)
      def inventory(pid: String): Vector[(Int, String, Vector[Byte])] = journal.persistedInStorage(pid).toVector.map { event =>
        val value = event.asInstanceOf[AnyRef]
        val serializer = serialization.findSerializerFor(value)
        (serializer.identifier, Serializers.manifestFor(serializer, value), serializer.toBinary(value).toVector)
      }
      val before = Vector("oracle-investor", "oracle-collection", "oracle-order", "oracle-saga", "oracle-host", "oracle-monarch").map(p => p -> inventory(p)).toMap
      val retained = orderState()
      order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(operationId, orderId, investorId, collectionId, original.fundCode, Money(BigDecimal("101.00"), "CNY")), orderReplies.ref)
      assert(orderReplies.receiveMessage() == FundOrderAggregate.Refused("ORDER_REPLAY_CONFLICT"))
      order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(operationId, orderId, investorId, collectionId, original.fundCode, amount), orderReplies.ref)
      assert(orderReplies.receiveMessage() == FundOrderAggregate.Accepted(Vector.empty))
      assert(orderState() == retained)
      before.foreach { case (pid, events) => assert(inventory(pid) == events) }
      assert(balance(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
      assert(balance(collection).accountBalance("CNY").amount == BigDecimal("100.00"))
    } finally kit.shutdownTestKit()
  }
}
