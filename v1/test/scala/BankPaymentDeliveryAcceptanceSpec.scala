import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.{PersistenceTestKitPlugin, PersistenceTestKitSnapshotPlugin}
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import akka.persistence.typed.PersistenceId
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.Sink
import com.google.protobuf.ByteString
import com.typesafe.config.ConfigFactory
import example.bankwealth.application.{bank_cash_payment_v1Execution => Execution, bank_payment_hostDefinition => Definition, bank_payment_hostHost => Host, bank_payment_hostHostIO => HostIO, bank_payment_hostTechnicalPorts => Technical}
import example.bankwealth.bindings.{BankBalanceComputations, BankPaymentBindings, StableOrderIdentity}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.service.UnitConfigurationCheck
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.{DurableRunObserver, PersistentMonarch}
import org.scalatest.funsuite.AnyFunSuite
import scalapb.GeneratedMessage
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.concurrent.duration._

/** Faults withhold a real prepare ACK or visibility of real journal receipts.
  * Recovery is same-PID actor recovery in one JVM, not cross-JVM evidence.
  */
final class BankPaymentDeliveryAcceptanceSpec extends AnyFunSuite {
  private val cursor = "pay-cash-purchase#0"
  private val kinds = Vector("succeeded", "rejected-before-effects", "compensated", "recovery-required", "outcome-unknown")

  private def withHarness(available: String = "1000.00", holdPrepareAck: Boolean = false,
      hidePrepareReceipt: Boolean = false)(body: Harness => Unit): Unit = {
    UnitConfigurationCheck.main(Array.empty)
    val config = ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config)
      .withFallback(PersistenceTestKitSnapshotPlugin.config).withFallback(ConfigFactory.load())
    UnitConfigurationCheck.validate(config)
    val kit = ActorTestKit(config)
    try body(new Harness(kit, available, holdPrepareAck, hidePrepareReceipt))
    finally kit.shutdownTestKit()
  }

  private final class Harness(val kit: ActorTestKit, available: String, holdPrepareAck: Boolean,
      hidePrepareReceipt: Boolean) {
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: ExecutionContext = system.executionContext
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    val storage = PersistenceTestKit(system)
    private val query = PersistenceQuery(system).readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
    private val assertions = kit.createTestProbe[Unit]()
    private val prefix = "payment-delivery-" + java.util.UUID.randomUUID().toString
    val investorPid = prefix + "-investor"
    val collectionPid = prefix + "-collection"
    val orderPid = prefix + "-order"
    val decoyPid = prefix + "-decoy"
    val sagaPid = prefix + "-saga"
    val hostPid = prefix + "-host"
    val monarchPid = prefix + "-monarch"
    val runId = prefix + "-run"
    val investorId = AccountId("investor")
    val collectionId = AccountId("collection")
    val amount = Money(BigDecimal("100.00"), "CNY")
    val original = BankPaymentOriginal(OperationId("cash-operation"), FundOrderId("original-order"),
      investorId, collectionId, "FUND-中文-001", amount)
    val decoyOriginal = original.copy(operationId = OperationId("decoy-operation"), fundOrderId = FundOrderId("decoy-order"))
    val hideReceipts = new AtomicBoolean(hidePrepareReceipt)
    val hiddenReads = new AtomicInteger(0)
    val actualPrepare = Promise[PhaseOutcome[BankPayment0PrepareReceipt]]()
    private val releasePrepare = Promise[Unit]()
    private val holdOnce = new AtomicBoolean(holdPrepareAck)

    def events(pid: String): Vector[Any] = storage.persistedInStorage(pid).toVector
    private def read(pid: String): Future[Vector[GeneratedMessage]] =
      query.currentEventsByPersistenceId(pid, 0L, Long.MaxValue).runWith(Sink.seq).map { rows =>
        val actual = rows.map(_.event).collect { case p: GeneratedMessage => p }.toVector
        if (pid == investorPid && hideReceipts.get() && actual.exists(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB])) {
          hiddenReads.incrementAndGet()
          throw new java.io.IOException("test-only visibility loss after the actual durable reserve")
        }
        actual
      }
    private val denyExternal = new FundOrderAggregate.ExternalAuthority {
      def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false
    }
    val investor = kit.spawn(CreditBalanceAggregate(investorPid, CreditBalanceState.empty.copy(id = investorId), BankBalanceComputations))
    val collection = kit.spawn(CreditBalanceAggregate(collectionPid, CreditBalanceState.empty.copy(id = collectionId), BankBalanceComputations))
    val order = kit.spawn(FundOrderAggregate(orderPid, FundOrderState.empty.copy(id = original.fundOrderId), StableOrderIdentity, denyExternal))
    val decoy = kit.spawn(FundOrderAggregate(decoyPid, FundOrderState.empty.copy(id = decoyOriginal.fundOrderId), StableOrderIdentity, denyExternal))
    private val ledgerReplies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
    private val orderReplies = kit.createTestProbe[FundOrderAggregate.Reply]()
    private val orderStates = kit.createTestProbe[FundOrderState]()
    private val balanceStates = kit.createTestProbe[CreditBalanceState]()
    private val statuses = kit.createTestProbe[StrictSagaCoordinator.Reply]()
    private val hostReplies = kit.createTestProbe[Host.Reply]()
    val checkpoints = kit.createTestProbe[(String, Map[String, String], Execution.State)]()
    val finishes = kit.createTestProbe[String]()
    private val observer = new DurableRunObserver[Execution.State] {
      override def onCheckpointCommitted(c: String, metadata: Map[String, String], state: Execution.State): Unit =
        checkpoints.ref ! ((c, metadata, state))
      override def onCompleted(id: String): Unit = finishes.ref ! ("completed:" + id)
      override def onFailed(id: String, c: String, reason: String): Unit = finishes.ref ! ("failed:" + id)
    }
    private def ledger(actor: ActorRef[CreditBalanceAggregate.Request], command: CreditBalanceProtocol.Command): Unit = {
      actor ! CreditBalanceAggregate.Execute(command, ledgerReplies.ref)
      assert(ledgerReplies.receiveMessage().isInstanceOf[CreditBalanceAggregate.Accepted])
    }
    private def request(actor: ActorRef[FundOrderAggregate.Request], input: BankPaymentOriginal): Unit = {
      actor ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(input.operationId, input.fundOrderId,
        input.investorAccountId, input.fundCollectionAccountId, input.fundCode, input.amount), orderReplies.ref)
      assert(orderReplies.receiveMessage().isInstanceOf[FundOrderAggregate.Accepted])
    }
    ledger(investor, CreditBalanceProtocol.InitializeAccount(investorId, "CNY", Money(BigDecimal(available), "CNY")))
    ledger(collection, CreditBalanceProtocol.InitializeAccount(collectionId, "CNY", Money(BigDecimal("0.00"), "CNY")))
    request(order, original)
    request(decoy, decoyOriginal)
    private val decoyBefore = orderState(decoy)
    private val decoyEventsBefore = events(decoyPid)

    @volatile var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
    val bindings = new BankPaymentBindings(original, investor, investorPid, collection, collectionPid,
      order, orderPid, read, () => coordinator)
    val input = bindings.parentInput
    val txid = TxId(bindings.operationId)
    val technical = bindings.installed
    private val underlying = Definition.fromTechnical(technical)
    // Preserve the exact incoming request/receipt context and real outcome. Only
    // the first execute ACK is delayed; query still reads the actual persisted PB.
    private val ports = new Definition.Ports {
      val technical = underlying.technical
      val installed = underlying.installed
      val reserve_investor_funds_prepare = new PhasePort[Definition.Args, BankPayment0PrepareReceipt] {
        val receiptCodec = underlying.reserve_investor_funds_prepare.receiptCodec
        val querySafety = underlying.reserve_investor_funds_prepare.querySafety
        def execute(request: OperationRequest[Definition.Args]): Future[PhaseOutcome[BankPayment0PrepareReceipt]] =
          underlying.reserve_investor_funds_prepare.execute(request).flatMap { actual =>
            if (holdOnce.compareAndSet(true, false)) {
              actualPrepare.success(actual)
              releasePrepare.future.map(_ => actual)
            } else Future.successful(actual)
          }
        def query(request: OperationRequest[Definition.Args]): Future[PhaseOutcome[BankPayment0PrepareReceipt]] =
          underlying.reserve_investor_funds_prepare.query(request)
      }
      val reserve_investor_funds_commit = underlying.reserve_investor_funds_commit
      val reserve_investor_funds_compensate = underlying.reserve_investor_funds_compensate
      val credit_fund_collection_prepare = underlying.credit_fund_collection_prepare
      val credit_fund_collection_commit = underlying.credit_fund_collection_commit
      val credit_fund_collection_compensate = underlying.credit_fund_collection_compensate
      val reserve_cash_fund_order_prepare = underlying.reserve_cash_fund_order_prepare
      val reserve_cash_fund_order_commit = underlying.reserve_cash_fund_order_commit
      val reserve_cash_fund_order_compensate = underlying.reserve_cash_fund_order_compensate
    }
    private def spawnCoordinator(): ActorRef[StrictSagaCoordinator.Command] =
      kit.spawn(StrictSagaCoordinator(PersistenceId.ofUniqueId(sagaPid), Definition.definition(ports), new ReconcileAuthorizer {
        def authorize(identity: TransactionIdentity, token: String): Either[String, String] =
          if (identity.transactionId == bindings.operationId && token == "owned-payment-operator") Right("payment-test-operator")
          else Left("not authorized")
      }, StrictSagaCoordinator.Settings(10.seconds, 32)))
    coordinator = spawnCoordinator()
    var host = kit.spawn(Host(hostPid, coordinator, technical))
    private def spawnExecution(): ActorRef[PersistentMonarch.Command[Execution.State]] =
      kit.spawn(Execution.behavior(monarchPid, Execution.install(new Execution.PureStages {}, host), observer))
    var execution = spawnExecution()

    def eventually(body: => Unit): Unit = assertions.awaitAssert(body, 15.seconds, 50.millis)
    def status(): StrictState = {
      coordinator ! StrictSagaCoordinator.GetStatus(statuses.ref)
      statuses.receiveMessage().asInstanceOf[StrictSagaCoordinator.Status].state
    }
    def orderState(actor: ActorRef[FundOrderAggregate.Request] = order): FundOrderState = {
      actor ! FundOrderAggregate.GetState(orderStates.ref)
      orderStates.receiveMessage()
    }
    def balance(actor: ActorRef[CreditBalanceAggregate.Request]): CreditBalanceState = {
      actor ! CreditBalanceAggregate.GetState(balanceStates.ref)
      balanceStates.receiveMessage()
    }
    def start(): Unit = {
      val replies = kit.createTestProbe[PersistentMonarch.RunReply]()
      execution ! PersistentMonarch.StartRun(runId, input, replies.ref)
      assert(replies.receiveMessage() == PersistentMonarch.Accepted(runId))
      assertStart()
    }
    def assertStart(): Unit = {
      val starts = events(monarchPid).collect { case e: PersistentMonarch.RunStarted => e }
      assert(starts.size == 1)
      val start = starts.head
      assert(start.runId == runId && start.stageCursors == Vector(cursor))
      // Equality includes all seven inputs (including occurrence and UTF-8 fundCode)
      // and absence of the output, not merely a hand-picked input field.
      assert(Execution.codec.decode(start.initialSnapshot) == input)
      assert(start.initialSnapshot.toVector == Execution.codec.encode(input).toVector)
      assert(input == Execution.State(Execution.Inputs(original.operationId, original.operationId,
        investorId, original.fundOrderId, collectionId, amount, original.fundCode)))
    }
    def assertDecoy(): Unit = {
      assert(orderState(decoy) == decoyBefore)
      assert(events(decoyPid) == decoyEventsBefore)
    }
    def assertDelivery(expectedKinds: Vector[String]): Unit = {
      eventually {
        assert(events(hostPid).collect { case e: Host.DeliveryAcknowledged => e.kind } == expectedKinds)
      }
      val live = status()
      val identity = live.identity.get
      assert(identity.transactionId == txid.value)
      assert(live.argsBytes == Definition.argsCodec.encode(Host.invocationArgs(input)))
      val expectedHost: Vector[Host.Event] = Vector(
        Host.Associated(ByteString.copyFrom(Execution.codec.encode(input)), live.argsBytes, txid.value),
        Host.AdmissionGranted, Host.IdentityObserved(identity)) ++
        expectedKinds.flatMap(kind => Vector[Host.Event](Host.ResultIntent(kind), Host.DeliveryAcknowledged(kind)))
      assert(events(hostPid).collect { case e: Host.Event => e } == expectedHost)
      val results = events(orderPid).collect {
        case p: FundOrderFundCashPaymentSucceededPB => ("succeeded", p.f0, p.f1)
        case p: FundOrderFundCashPaymentRejectedBeforeEffectsPB => ("rejected-before-effects", p.f0, p.f1)
        case p: FundOrderFundCashPaymentCompensatedPB => ("compensated", p.f0, p.f1)
        case p: FundOrderFundCashPaymentRecoveryRequiredPB => ("recovery-required", p.f0, p.f1)
        case p: FundOrderFundCashPaymentOutcomeUnknownPB => ("outcome-unknown", p.f0, p.f1)
      }
      assert(results == expectedKinds.map(kind => (kind, Some(DomainConverters.encodeTxIdPB(txid)), kind)))
      val retained = orderState()
      assert(retained.id == original.fundOrderId && retained.operationId == original.operationId)
      assert(retained.investorAccountId == investorId && retained.fundCollectionAccountId == collectionId)
      assert(retained.fundCode == original.fundCode && retained.amount == amount)
      assert(retained.cashPaymentResults == Map(txid -> expectedKinds.last))
      assert(retained.cashPaymentFinalResults == (if (Set("succeeded", "rejected-before-effects", "compensated")(expectedKinds.last))
        Map(txid -> expectedKinds.last) else Map.empty[TxId, String]))
      assertDecoy()
    }

    private def normalized(event: Any): Any = event match {
      case p: GeneratedMessage => (p.getClass.getName, p.toByteArray.toVector)
      case e: PersistentMonarch.RunStarted => (e.runId, e.stageCursors, e.initialSnapshot.toVector)
      case e: PersistentMonarch.StageDone => (e.cursor, e.timestamp, e.metadata, e.snapshot.toVector)
      case other => other
    }
    def snapshot(): Map[String, Vector[Any]] = Vector(investorPid, collectionPid, orderPid, decoyPid, sagaPid, hostPid, monarchPid)
      .map(pid => pid -> events(pid).map(normalized)).toMap
    def assertUnchanged(before: Map[String, Vector[Any]]): Unit = assert(snapshot() == before)

    private def authority(kind: String, body: BankPaymentOriginal, context: Technical.CompletionContext): Future[BankPaymentResult] = kind match {
      case "succeeded" => technical.BankPaymentSucceededAuthorityCompletion(body, context)
      case "rejected-before-effects" => technical.BankPaymentRejectedBeforeEffectsAuthorityCompletion(body, context)
      case "compensated" => technical.BankPaymentCompensatedAuthorityCompletion(body, context)
      case "recovery-required" => technical.BankPaymentRecoveryRequiredAuthorityCompletion(body, context)
      case "outcome-unknown" => technical.BankPaymentOutcomeUnknownAuthorityCompletion(body, context)
    }
    private def deliver(kind: String, body: BankPaymentResult, context: Technical.CompletionContext): Future[Boolean] = kind match {
      case "succeeded" => technical.BankPaymentSucceededDeliveryCompletion(body, context)
      case "rejected-before-effects" => technical.BankPaymentRejectedBeforeEffectsDeliveryCompletion(body, context)
      case "compensated" => technical.BankPaymentCompensatedDeliveryCompletion(body, context)
      case "recovery-required" => technical.BankPaymentRecoveryRequiredDeliveryCompletion(body, context)
      case "outcome-unknown" => technical.BankPaymentOutcomeUnknownDeliveryCompletion(body, context)
    }
    private def rejected(call: => Future[_]): Unit = intercept[IllegalArgumentException] { Await.result(call, 5.seconds) }

    def assertAuthorityBoundary(kind: String): Unit = {
      val liveIdentity = status().identity.get // Never replace the authority with a constructed Status.
      val context = Technical.CompletionContext(original, liveIdentity)
      val result = BankPaymentResult(txid)
      val before = snapshot()
      assert(Await.result(authority(kind, original, context), 5.seconds) == result)
      assert(Await.result(deliver(kind, result, context), 5.seconds))
      assert(Await.result(HostIO.deliver(kind, original, liveIdentity, technical), 5.seconds))
      val changedOriginals = Vector(
        original.copy(fundOrderId = decoyOriginal.fundOrderId),
        original.copy(operationId = decoyOriginal.operationId),
        original.copy(investorAccountId = AccountId("other-investor")),
        original.copy(fundCollectionAccountId = AccountId("other-collection")),
        original.copy(fundCode = "OTHER-FUND"), original.copy(amount = Money(BigDecimal("101.00"), "CNY")))
      changedOriginals.foreach { changed =>
        rejected(authority(kind, changed, context))
        rejected(authority(kind, original, context.copy(original = changed)))
        rejected(deliver(kind, result, context.copy(original = changed)))
        // BC939 has no concrete separate-destination Delivery implementation.
        // Its real destination is original.fundOrderId in the completion context.
        rejected(HostIO.deliver(kind, changed, liveIdentity, technical))
      }
      val changedIdentities = Vector(
        liveIdentity.copy(transactionId = "other-transaction"),
        liveIdentity.copy(definitionName = "other-definition"),
        liveIdentity.copy(definitionVersion = liveIdentity.definitionVersion + 1),
        liveIdentity.copy(definitionDigest = "sha256:" + "0" * 64),
        liveIdentity.copy(argsCodec = CodecPin("other-args", 1)),
        liveIdentity.copy(argsDigest = "sha256:" + "0" * 64))
      changedIdentities.foreach { changed =>
        rejected(authority(kind, original, context.copy(identity = changed)))
        rejected(deliver(kind, result, context.copy(identity = changed)))
      }
      rejected(deliver(kind, BankPaymentResult(TxId("other-result-transaction")), context))
      kinds.filterNot(_ == kind).foreach { wrongKind =>
        rejected(authority(wrongKind, original, context))
        rejected(deliver(wrongKind, result, context))
      }
      // Complete parent-body conflicts include the seventh input and occurrence.
      val changedInputs = Vector(
        input.inputs.copy(operation = decoyOriginal.operationId), input.inputs.copy(occurrence = OperationId("other-occurrence")),
        input.inputs.copy(investorAccountId = AccountId("other-investor")), input.inputs.copy(fundOrderId = decoyOriginal.fundOrderId),
        input.inputs.copy(fundCollectionAccountId = AccountId("other-collection")), input.inputs.copy(amount = Money(BigDecimal("101.00"), "CNY")),
        input.inputs.copy(fundCode = "OTHER-FUND"))
      changedInputs.foreach { changed =>
        host ! Host.Invoke(input.copy(inputs = changed), hostReplies.ref)
        assert(hostReplies.receiveMessage().isInstanceOf[Host.Conflict])
      }
      assertUnchanged(before)
      assertDecoy()
    }

    def assertFinancial(kind: String): Unit = {
      def records(pid: String): Vector[(String, TxId, String, Money)] = events(pid).collect {
        case p: CreditBalanceReserveFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceReserveFundsConfirmedPB(p); ("reserve", e.txid, e.resource.value, e.amount)
        case p: CreditBalanceDeductFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceDeductFundsConfirmedPB(p); ("deduct", e.txid, e.resource.value, e.amount)
        case p: CreditBalanceReleaseReservedFundsConfirmedPB => val e = DomainConverters.decodeCreditBalanceReleaseReservedFundsConfirmedPB(p); ("release", e.txid, e.resource.value, e.amount)
        case p: CreditBalanceRecordIncomingCreditsConfirmedPB => val e = DomainConverters.decodeCreditBalanceRecordIncomingCreditsConfirmedPB(p); ("incoming", e.txid, e.resource.value, e.amount)
        case p: CreditBalanceCommitIncomingCreditsConfirmedPB => val e = DomainConverters.decodeCreditBalanceCommitIncomingCreditsConfirmedPB(p); ("credit", e.txid, e.resource.value, e.amount)
        case p: CreditBalanceCancelIncomingCreditConfirmedPB => val e = DomainConverters.decodeCreditBalanceCancelIncomingCreditConfirmedPB(p); ("cancel-incoming", e.txid, e.resource.value, e.amount)
        case p: FundOrderReserveFundSubscriptionConfirmedPB => val e = DomainConverters.decodeFundOrderReserveFundSubscriptionConfirmedPB(p); ("subscribe", e.txid, e.resource.value, e.amount)
        case p: FundOrderFundSubscriptionPaymentConfirmedPB => val e = DomainConverters.decodeFundOrderFundSubscriptionPaymentConfirmedPB(p); ("pay-order", e.txid, e.resource.value, e.amount)
        case p: FundOrderCashFundSubscriptionCanceledPB => val e = DomainConverters.decodeFundOrderCashFundSubscriptionCanceledPB(p); ("cancel-order", e.txid, e.resource.value, e.amount)
      }
      val phases = kind match {
        case "succeeded" => Vector(Vector("reserve", "deduct"), Vector("incoming", "credit"), Vector("subscribe", "pay-order"))
        case "rejected-before-effects" => Vector(Vector("release"), Vector.empty[String], Vector.empty[String])
        case "compensated" => Vector(Vector("reserve", "release"), Vector.empty[String], Vector.empty[String])
        case "recovery-required" | "outcome-unknown" => Vector(Vector("reserve"), Vector.empty[String], Vector.empty[String])
      }
      Vector(investorPid -> investorId.value, collectionPid -> collectionId.value, orderPid -> original.fundOrderId.value)
        .zip(phases).foreach { case ((pid, resource), expected) =>
          assert(records(pid) == expected.map(phase => (phase, txid, resource, amount)))
        }
      val a = balance(investor)
      val b = balance(collection)
      val pending = kind == "recovery-required" || kind == "outcome-unknown"
      assert(a.accountBalance("CNY") == Money(BigDecimal(if (kind == "succeeded" || pending) "900.00" else available), "CNY"))
      assert(b.accountBalance("CNY") == Money(BigDecimal(if (kind == "succeeded") "100.00" else "0.00"), "CNY"))
      assert(a.reservedAmount == (if (pending) Map(txid -> amount) else Map.empty[TxId, Money]))
      assert(a.committedOutgoing == (if (kind == "succeeded") Map(txid -> amount) else Map.empty[TxId, Money]))
      assert(b.committedIncoming == (if (kind == "succeeded") Map(txid -> amount) else Map.empty[TxId, Money]))
      assertDecoy()
    }

    def assertPending(): Unit = {
      assertStart()
      assert(events(monarchPid).size == 1) // No StageDone/StageResolved/RunCompleted/RunFailedEvt.
      checkpoints.expectNoMessage(100.millis)
      finishes.expectNoMessage(100.millis)
      assert(!status().terminal && orderState().cashPaymentFinalResults.isEmpty)
    }
    def assertTerminal(kind: String, expectedDeliveries: Vector[String]): Unit = {
      assertDelivery(expectedDeliveries)
      val live = status()
      assert(live.terminal && live.status == (if (kind == "succeeded") StrictStatus.Succeeded else StrictStatus.Aborted))
      assertFinancial(kind)
      val terminal = if (kind == "succeeded") "completed:" else "failed:"
      assert(finishes.receiveMessage(10.seconds) == terminal + runId)
      assertStart()
      if (kind == "succeeded") {
        val expected = input.copy(pay_cash_purchase_paymentTxid = Some(txid))
        assert(checkpoints.receiveMessage(5.seconds) == ((cursor, Map.empty[String, String], expected)))
        val done = events(monarchPid).collect { case e: PersistentMonarch.StageDone => e }
        assert(done.size == 1)
        assert(done.head.cursor == cursor && done.head.metadata == Map.empty[String, String] && done.head.timestamp > 0L)
        assert(Execution.codec.decode(done.head.snapshot) == expected)
        assert(done.head.snapshot.toVector == Execution.codec.encode(expected).toVector)
        assert(Execution.outputs(Execution.codec.decode(done.head.snapshot)).paymentTxid == txid)
        assert(events(monarchPid).collect { case e: PersistentMonarch.RunCompleted => e.runId } == Vector(runId))
        assert(events(monarchPid).size == 3)
      } else {
        // Frozen runtime records an unhandled stage failure at the pipeline cursor.
        val resultCode = if (kind == "compensated") "Compensated" else "Rejected"
        val failed = events(monarchPid).collect { case e: PersistentMonarch.RunFailedEvt => e }
        assert(failed == Vector(PersistentMonarch.RunFailedEvt("pipeline", "business-rejection: business-rejection:" + resultCode + ":stop")))
        assert(events(monarchPid).size == 2)
        checkpoints.expectNoMessage(100.millis)
      }
      assertAuthorityBoundary(kind)
      replaySamePid(kind)
    }

    def replaySamePid(kind: String): Unit = {
      val before = snapshot()
      val retained = status()
      kit.stop(execution); kit.stop(host); kit.stop(coordinator)
      coordinator = spawnCoordinator()
      host = kit.spawn(Host(hostPid, coordinator, technical))
      execution = spawnExecution()
      assert(status() == retained)
      host ! Host.Invoke(input, hostReplies.ref)
      val expected: Host.Reply = kind match {
        case "succeeded" => Host.Completed(Execution.pay_cash_purchase_Succeeded(txid))
        case "rejected-before-effects" => Host.Completed(Execution.pay_cash_purchase_Rejected)
        case "compensated" => Host.Completed(Execution.pay_cash_purchase_Compensated)
        case "outcome-unknown" | "recovery-required" => Host.Pending(kind)
      }
      assert(hostReplies.receiveMessage(5.seconds) == expected)
      checkpoints.expectNoMessage(100.millis)
      finishes.expectNoMessage(100.millis)
      assertUnchanged(before)
      assertStart()
      assertDecoy()
    }
    def abortAfterRealReserve(): Unit = {
      val actual = Await.result(actualPrepare.future, 5.seconds)
      val before = status()
      assert(!before.commitDecision && !before.terminal && before.pending.exists(_.identity.phase == Phase.Prepare))
      actual match {
        case ConfirmedReceipt(identity, receipt) =>
          assert(before.identity.contains(identity.transaction))
          assert(receipt.transaction == txid && receipt.payloadTxid == txid)
        case other => fail("ACK gate must hold an actual confirmed reserve, not " + other)
      }
      assert(events(investorPid).count(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]) == 1)
      coordinator ! StrictSagaCoordinator.Abort(before.identity.get, "owned pre-decision abort", statuses.ref)
      assert(statuses.receiveMessage().isInstanceOf[StrictSagaCoordinator.Status])
      eventually { assert(status().status == StrictStatus.Aborted) }
      assert(!status().commitDecision)
      val beforeLateAck = snapshot()
      releasePrepare.success(()) // Stale actual callback cannot select commit or add effects.
      eventually { assert(status().terminal) }
      assert(events(investorPid).map(normalized) == beforeLateAck(investorPid))
    }
    def reconcile(budget: Int): Unit = {
      val identity = status().identity.get
      val before = snapshot()
      coordinator ! StrictSagaCoordinator.Reconcile(identity, "denied-token", budget, statuses.ref)
      assert(statuses.receiveMessage().isInstanceOf[StrictSagaCoordinator.Denied])
      assertUnchanged(before)
      coordinator ! StrictSagaCoordinator.Reconcile(identity, "owned-payment-operator", budget, statuses.ref)
      assert(statuses.receiveMessage().isInstanceOf[StrictSagaCoordinator.Status])
    }
  }

  test("PAY delivery succeeded: exact original/PB/authority boundary and complete durable Monarch snapshot") {
    withHarness() { h =>
      h.start()
      h.assertTerminal("succeeded", Vector("succeeded"))
    }
  }

  test("PAY delivery rejected-before-effects: real insufficient balance fence, no completion checkpoint, same-PID replay") {
    withHarness(available = "50.00") { h =>
      h.start()
      h.assertTerminal("rejected-before-effects", Vector("rejected-before-effects"))
      assert(h.status().evidence.values.exists(_.isInstanceOf[Evidence.Absent]))
      assert(!h.status().evidence.values.exists { case Evidence.Confirmed(id, _) => id.phase == Phase.Prepare; case _ => false })
    }
  }

  test("PAY delivery compensated: public Abort after actual reserve ACK, real query and release, no committed debit") {
    withHarness(holdPrepareAck = true) { h =>
      h.start()
      h.abortAfterRealReserve()
      h.assertTerminal("compensated", Vector("compensated"))
      assert(h.status().evidence.values.exists { case Evidence.Confirmed(id, _) => id.phase == Phase.Prepare; case _ => false })
      assert(h.status().evidence.values.exists { case Evidence.Confirmed(id, _) => id.phase == Phase.Compensate; case _ => false })
    }
  }

  test("PAY delivery outcome-unknown then distinct recovery-required: actual receipt query/budget one, same-PID recovery, finish forward once") {
    withHarness(hidePrepareReceipt = true) { h =>
      h.start()
      h.assertDelivery(Vector("outcome-unknown"))
      assert(h.hiddenReads.get() > 0)
      val unknown = h.status()
      assert(unknown.status == StrictStatus.RecoveryRequired && unknown.evidence.values.exists(_.isInstanceOf[Evidence.Uncertain]))
      assert(!unknown.commitDecision)
      h.assertPending()
      h.assertFinancial("outcome-unknown")
      h.assertAuthorityBoundary("outcome-unknown")
      h.replaySamePid("outcome-unknown")
      h.hideReceipts.set(false)
      h.reconcile(1)
      h.eventually {
        val recovered = h.status()
        assert(recovered.status == StrictStatus.RecoveryRequired && recovered.reason == "reconcile interaction budget exhausted")
        assert(!recovered.evidence.values.exists(_.isInstanceOf[Evidence.Uncertain]))
      }
      h.assertDelivery(Vector("outcome-unknown", "recovery-required"))
      val exhausted = h.status()
      assert(exhausted.identity == unknown.identity && !exhausted.commitDecision)
      assert(exhausted.evidence.values.count(_.isInstanceOf[Evidence.Confirmed]) == 1)
      h.assertPending()
      h.assertFinancial("recovery-required")
      h.assertAuthorityBoundary("recovery-required")
      h.replaySamePid("recovery-required")
      h.reconcile(32)
      h.assertTerminal("succeeded", Vector("outcome-unknown", "recovery-required", "succeeded"))
      assert(h.status().identity == unknown.identity)
      assert(h.events(h.sagaPid).collect { case e: StrictEvent.ReconcileAuthorized => e.maxInteractions } == Vector(1, 32))
    }
  }
}
