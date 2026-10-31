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
import example.bankwealth.application.{bank_independent_refund_v1Execution => RefundExecution, bank_refund_hostDefinition => RefundDefinition, bank_refund_hostHost => RefundHost}
import example.bankwealth.application.{bank_ta_submission_v1Execution => TaExecution, bank_ta_effectEffectHost => TaHost}
import example.bankwealth.application.{bank_sip_dispatch_v1Execution => SipDispatch, bank_sip_dispatchEffectHost => SipHost}
import example.bankwealth.bindings.{BankBalanceComputations, BankPaymentBindings, StableOrderIdentity, MockTAClient, BankTaBridge, BankRefundBindings, BankTaEffectBindings, StableSipIdentity, BankSipDispatchBindings, BankSipTerminalBridge}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.{DurableRunObserver, PersistentMonarch}
import org.scalatest.funsuite.AnyFunSuite
import scalapb.GeneratedMessage
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

final class BankPaymentJointSpec extends AnyFunSuite {
  private def runCase(available: String, expectedKind: String, loseReceipt: Boolean = false, taScenario: Option[String] = None, sip: Boolean = false, refundUnknown: Boolean = false, taUnknown: Boolean = false, loseCommitReceipt: Boolean = false, refundCanceled: Option[Int] = None): Unit = {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: scala.concurrent.ExecutionContext = system.executionContext
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    try {
      val journal = PersistenceTestKit(system)
      val query = PersistenceQuery(system).readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
      val hideReceipt = new java.util.concurrent.atomic.AtomicBoolean(loseReceipt || loseCommitReceipt)
      def read(pid: String): Future[Vector[GeneratedMessage]] = query.currentEventsByPersistenceId(pid, 0L, Long.MaxValue)
        .runWith(Sink.seq).map { envelopes =>
          val messages = envelopes.map(_.event).collect { case p: GeneratedMessage => p }.toVector
          val lostPhaseWritten = if (loseCommitReceipt) messages.exists(_.isInstanceOf[CreditBalanceDeductFundsConfirmedPB])
            else messages.exists(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB])
          if (pid == "joint-investor" && hideReceipt.get() && lostPhaseWritten)
            throw new java.io.IOException("injected read transport failure after durable debit")
          messages
        }
      val investorId = AccountId("investor"); val collectionId = AccountId("collection")
      val amount = Money(BigDecimal("100.00"), "CNY")
      var sipPlan = kit.spawn(SipPlanAggregate("joint-sip", SipPlanState.empty, StableSipIdentity))
      val sipReplies = kit.createTestProbe[SipPlanAggregate.Reply]()
      val sipStates = kit.createTestProbe[SipPlanState]()
      def sipCommand(command: SipPlanProtocol.Command): Unit = { sipPlan ! SipPlanAggregate.Execute(command, sipReplies.ref); assert(sipReplies.receiveMessage().isInstanceOf[SipPlanAggregate.Accepted]) }
      def sipState(): SipPlanState = { sipPlan ! SipPlanAggregate.GetState(sipStates.ref); sipStates.receiveMessage() }
      val occurrence = if (sip) {
        val config = SipRevisionConfig(RevisionId("revision"), 0L, investorId, collectionId, "FUND-中文-001", amount)
        sipCommand(SipPlanProtocol.CreateSipPlan(PlanId("plan"), config))
        sipCommand(SipPlanProtocol.AppendSipDueSlot(0L, 10L)); sipCommand(SipPlanProtocol.SealSipSchedule())
        sipCommand(SipPlanProtocol.AdvanceSipClock(10L)); sipCommand(SipPlanProtocol.ObserveSipDueSlot(0L, 10L))
        sipCommand(SipPlanProtocol.TriggerSipInstallment(0L, 10L, config.revision, config))
        Some(sipState().occurrences(10L))
      } else None
      val orderId = occurrence.map(_.fundOrderId).getOrElse(FundOrderId("order"))
      val original = BankPaymentOriginal(occurrence.map(_.operationId).getOrElse(OperationId("cash-operation")), orderId, investorId, collectionId, "FUND-中文-001", amount)
      val investor = kit.spawn(CreditBalanceAggregate("joint-investor", CreditBalanceState.empty.copy(id = investorId), BankBalanceComputations))
      val collection = kit.spawn(CreditBalanceAggregate("joint-collection", CreditBalanceState.empty.copy(id = collectionId), BankBalanceComputations))
      val order = kit.spawn(FundOrderAggregate("joint-order", FundOrderState.empty.copy(id = orderId), StableOrderIdentity,
        new FundOrderAggregate.ExternalAuthority {
          def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false
        }))
      val ledgerReplies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
      def ledger(actor: ActorRef[CreditBalanceAggregate.Request], command: CreditBalanceProtocol.Command): Unit = {
        actor ! CreditBalanceAggregate.Execute(command, ledgerReplies.ref)
        assert(ledgerReplies.receiveMessage().isInstanceOf[CreditBalanceAggregate.Accepted])
      }
      ledger(investor, CreditBalanceProtocol.InitializeAccount(investorId, "CNY", Money(BigDecimal(available), "CNY")))
      ledger(collection, CreditBalanceProtocol.InitializeAccount(collectionId, "CNY", Money(BigDecimal("0.00"), "CNY")))
      val orderReplies = kit.createTestProbe[FundOrderAggregate.Reply]()
      if (!sip) {
        order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(original.operationId, orderId, investorId, collectionId, original.fundCode, amount), orderReplies.ref)
        assert(orderReplies.receiveMessage().isInstanceOf[FundOrderAggregate.Accepted])
      }
      val beforePrematureTa = journal.persistedInStorage("joint-order").size
      order ! FundOrderAggregate.Execute(FundOrderProtocol.RegisterFundTASubmission(orderId, TxId("unpaid")), orderReplies.ref)
      assert(orderReplies.receiveMessage().isInstanceOf[FundOrderAggregate.Refused])
      assert(journal.persistedInStorage("joint-order").size == beforePrematureTa)
      if (!sip && taScenario.nonEmpty) {
        val root = java.nio.file.Paths.get("/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p24-p25-bank-joint-fkcd3jwe")
        val directory = java.nio.file.Files.createTempDirectory(root, "mock-ta-joint-").toRealPath()
        val unpaidClient = new MockTAClient(directory.resolve("ta.jsonl"), directory.resolve("worker.jsonl"), directory.resolve("worker.stderr.log"))
        try {
          assert(Await.result(unpaidClient.query("unpaid-observation"), 5.seconds).path("status").asText() == "unknown")
          val before = java.nio.file.Files.readAllBytes(directory.resolve("ta.jsonl")).toVector
          val premature = new BankTaBridge(order, unpaidClient)
          intercept[IllegalArgumentException](Await.result(premature.submit("confirmed"), 5.seconds))
          intercept[IllegalArgumentException](Await.result(premature.reconcile(), 5.seconds))
          assert(java.nio.file.Files.readAllBytes(directory.resolve("ta.jsonl")).toVector == before)
          assert(journal.persistedInStorage("joint-order").size == beforePrematureTa)
        } finally unpaidClient.close()
      }
      @volatile var coordinator: ActorRef[StrictSagaCoordinator.Command] = null
      val bindings = new BankPaymentBindings(original, investor, "joint-investor", collection, "joint-collection", order, "joint-order", read, () => coordinator)
      def spawnCoordinator(): ActorRef[StrictSagaCoordinator.Command] = kit.spawn(Definition.coordinator("joint-saga", Definition.fromTechnical(bindings.installed), new ReconcileAuthorizer {
        def authorize(id: TransactionIdentity, token: String): Either[String, String] =
          if ((loseReceipt || loseCommitReceipt) && id.transactionId == bindings.operationId && token == "owned-test-operator") Right("bank-demo-operator-v1") else Left("not authorized")
      }))
      coordinator = spawnCoordinator()
      var host = kit.spawn(Host("joint-host", coordinator, bindings.installed))
      val checkpoints = kit.createTestProbe[Execution.State]()
      val completed = kit.createTestProbe[String]()
      val observer = new DurableRunObserver[Execution.State] {
        override def onCheckpointCommitted(cursor: String, metadata: Map[String, String], state: Execution.State): Unit = checkpoints.ref ! state
        override def onCompleted(id: String): Unit = completed.ref ! "succeeded"
        override def onFailed(id: String, cursor: String, reason: String): Unit = completed.ref ! "failed"
      }
      def spawnExecution(): ActorRef[PersistentMonarch.Command[Execution.State]] = kit.spawn(Execution.behavior("joint-monarch", Execution.install(new Execution.PureStages {}, host), observer))
      var execution = spawnExecution()
      val starts = kit.createTestProbe[PersistentMonarch.RunReply]()
      if (sip) {
        def allEvents(pid: String): Future[Vector[Any]] = query.currentEventsByPersistenceId(pid, 0L, Long.MaxValue).runWith(Sink.seq).map(_.map(_.event).toVector)
        val dispatchBindings = new BankSipDispatchBindings(sipPlan, "joint-sip", order, execution, "joint-monarch", allEvents)
        val dispatchHost = kit.spawn(SipHost("joint-sip-dispatch-host", dispatchBindings.installed))
        val dispatchDone = kit.createTestProbe[String]()
        val dispatch = kit.spawn(SipDispatch.behavior("joint-sip-dispatch", SipDispatch.install(new SipDispatch.PureStages {}, dispatchHost), new DurableRunObserver[SipDispatch.State] {
          override def onCompleted(id: String): Unit = dispatchDone.ref ! id
        }))
        val o = occurrence.get
        dispatch ! PersistentMonarch.StartRun("sip-dispatch", SipDispatch.State(SipDispatch.Inputs(o.occurrenceId, o)), starts.ref)
        assert(starts.receiveMessage().isInstanceOf[PersistentMonarch.Accepted])
        assert(dispatchDone.receiveMessage(10.seconds) == "sip-dispatch")
        assert(sipState().successTotal == 0L && sipState().failureTotal == 0L)
        sipCommand(SipPlanProtocol.PauseSipPlan(10L))
      } else {
        execution ! PersistentMonarch.StartRun("cash-run", bindings.parentInput, starts.ref)
        assert(starts.receiveMessage().isInstanceOf[PersistentMonarch.Accepted])
      }
      val statuses = kit.createTestProbe[StrictSagaCoordinator.Reply]()
      def status(): StrictState = { coordinator ! StrictSagaCoordinator.GetStatus(statuses.ref); statuses.receiveMessage().asInstanceOf[StrictSagaCoordinator.Status].state }
      val orders = kit.createTestProbe[FundOrderState]()
      def orderState(): FundOrderState = { order ! FundOrderAggregate.GetState(orders.ref); orders.receiveMessage() }
      if (loseReceipt || loseCommitReceipt) {
        orders.awaitAssert(assert(orderState().cashPaymentResults.get(TxId(bindings.operationId)).contains("outcome-unknown")), 15.seconds, 100.millis)
        val unknown = status()
        assert(unknown.status == StrictStatus.RecoveryRequired && !unknown.terminal)
        assert(unknown.commitDecision == loseCommitReceipt)
        if (loseCommitReceipt) {
          assert(journal.persistedInStorage("joint-investor").count(_.isInstanceOf[CreditBalanceDeductFundsConfirmedPB]) == 1)
          assert(!journal.persistedInStorage("joint-investor").exists(_.isInstanceOf[CreditBalanceReleaseReservedFundsConfirmedPB]))
        }
        if (sip) {
          val retained = sipState()
          Await.result(new BankSipTerminalBridge(sipPlan, order, "joint-order", read).record(occurrence.get), 5.seconds)
          assert(sipState().successTotal == 0L && sipState().failureTotal == 0L)
          kit.stop(sipPlan)
          sipPlan = kit.spawn(SipPlanAggregate("joint-sip", SipPlanState.empty, StableSipIdentity))
          assert(sipState().occurrences == retained.occurrences)
          assert(sipState().successTotal == 0L && sipState().failureTotal == 0L)
        }
        assert(orderState().cashPaymentFinalResults.isEmpty)
        assert(journal.persistedInStorage("joint-investor").count(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]) == 1)
        assert(!journal.persistedInStorage("joint-monarch").exists(_.isInstanceOf[PersistentMonarch.StageDone]))
        assert(!journal.persistedInStorage("joint-monarch").exists(_.isInstanceOf[PersistentMonarch.RunFailedEvt]))
        completed.expectNoMessage(200.millis)
        kit.stop(execution); kit.stop(host); kit.stop(coordinator)
        coordinator = spawnCoordinator()
        host = kit.spawn(Host("joint-host", coordinator, bindings.installed))
        execution = spawnExecution()
        assert(status().identity == unknown.identity)
        hideReceipt.set(false)
        coordinator ! StrictSagaCoordinator.Reconcile(unknown.identity.get, "denied", 32, statuses.ref)
        assert(statuses.receiveMessage().isInstanceOf[StrictSagaCoordinator.Denied])
        coordinator ! StrictSagaCoordinator.Reconcile(unknown.identity.get, "owned-test-operator", 32, statuses.ref)
        assert(statuses.receiveMessage().isInstanceOf[StrictSagaCoordinator.Status])
        statuses.awaitAssert(assert(status().status == StrictStatus.Succeeded), 15.seconds, 100.millis)
      }
      orders.awaitAssert(assert(orderState().cashPaymentFinalResults.get(TxId(bindings.operationId)).contains(expectedKind)), 15.seconds, 100.millis)
      assert(status().terminal)
      val balances = kit.createTestProbe[CreditBalanceState]()
      def balance(actor: ActorRef[CreditBalanceAggregate.Request]): CreditBalanceState = { actor ! CreditBalanceAggregate.GetState(balances.ref); balances.receiveMessage() }
      if (expectedKind == "succeeded") {
        assert(balance(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
        assert(balance(collection).accountBalance("CNY").amount == BigDecimal("100.00"))
        assert(checkpoints.receiveMessage(5.seconds).pay_cash_purchase_paymentTxid.contains(TxId(bindings.operationId)))
        assert(completed.receiveMessage(5.seconds) == "succeeded")
        assert(!journal.persistedInStorage("joint-monarch").exists(_.isInstanceOf[PersistentMonarch.RunFailedEvt]))
        assert(journal.persistedInStorage("joint-investor").count(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]) == 1)
        assert(journal.persistedInStorage("joint-collection").count(_.isInstanceOf[CreditBalanceCommitIncomingCreditsConfirmedPB]) == 1)
        assert(journal.persistedInStorage("joint-saga").nonEmpty && journal.persistedInStorage("joint-monarch").nonEmpty)
        val before = Vector("joint-investor", "joint-collection", "joint-order", "joint-saga", "joint-host").map(p => p -> journal.persistedInStorage(p).size).toMap
        val replies = kit.createTestProbe[Host.Reply]()
        host ! Host.Invoke(bindings.parentInput, replies.ref)
        assert(replies.receiveMessage().isInstanceOf[Host.Completed])
        before.foreach { case (pid, count) => assert(journal.persistedInStorage(pid).size == count) }
        val retainedOrder = orderState()
        for ((who, sum) <- Vector((investorId, amount), (AccountId("other-investor"), amount), (investorId, Money(BigDecimal("101.00"), "CNY")))) {
          order ! FundOrderAggregate.Execute(FundOrderProtocol.RequestFundPurchaseSettlement(original.operationId, orderId, who, collectionId, original.fundCode, sum), orderReplies.ref)
          val reply = orderReplies.receiveMessage()
          if (who == investorId && sum == amount) assert(reply == FundOrderAggregate.Accepted(Vector.empty))
          else assert(reply == FundOrderAggregate.Refused("ORDER_REPLAY_CONFLICT"))
        }
        assert(orderState() == retainedOrder)
        before.foreach { case (pid, count) => assert(journal.persistedInStorage(pid).size == count) }
        host ! Host.Invoke(bindings.parentInput.copy(inputs = bindings.parentInput.inputs.copy(fundCode = "OTHER")), replies.ref)
        assert(replies.receiveMessage().isInstanceOf[Host.Conflict])
        taScenario.foreach { scenario =>
          val root = java.nio.file.Paths.get("/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo/.scratch/p24-p25-bank-joint-fkcd3jwe")
          val directory = java.nio.file.Files.createTempDirectory(root, "mock-ta-joint-").toRealPath()
          var client = new MockTAClient(directory.resolve("ta.jsonl"), directory.resolve("worker.jsonl"), directory.resolve("worker.stderr.log"))
          try {
            var ta = new BankTaBridge(order, client)
            order ! FundOrderAggregate.Execute(FundOrderProtocol.RegisterFundTASubmission(orderId, TxId(bindings.operationId)), orderReplies.ref)
            assert(orderReplies.receiveMessage().isInstanceOf[FundOrderAggregate.Accepted])
            val taId = orderState().taRequestId
            val taInput = TaExecution.State(TaExecution.Inputs(taId, orderId, TxId(bindings.operationId)))
            val taBinding = new BankTaEffectBindings(order, client, ta, scenario)
            val loseTaReply = new java.util.concurrent.atomic.AtomicBoolean(taUnknown)
            val installedTa = if (!taUnknown) taBinding.installed else TaHost.install(TaHost.Bindings(
              TaHost.Implementation("bankwealth.BankTaEffectExecute", "bank-v1-1", (op: BankTaEffectOperation) =>
                taBinding.installed.execute(op).flatMap { actual => if (loseTaReply.get()) Future.failed(new java.io.IOException("TA reply lost after durable submission")) else Future.successful(actual) }),
              TaHost.Implementation("bankwealth.BankTaEffectQuery", "bank-v1-1", (op: BankTaEffectOperation) =>
                if (loseTaReply.get()) Future.failed(new java.io.IOException("TA query transport unavailable")) else taBinding.installed.query(op)),
              TaHost.Implementation("bankwealth.BankTaEffectReconcilePort", "bank-v1-1", (op: BankTaEffectReconcile) => taBinding.installed.reconcile(op))))
            var taHost = kit.spawn(TaHost("joint-ta-host", installedTa))
            val taDone = kit.createTestProbe[String]()
            val taCheckpoint = kit.createTestProbe[TaExecution.State]()
            val taRun = kit.spawn(TaExecution.behavior("joint-ta-monarch", TaExecution.install(new TaExecution.PureStages {}, taHost), new DurableRunObserver[TaExecution.State] {
              override def onCheckpointCommitted(cursor: String, metadata: Map[String, String], snapshot: TaExecution.State): Unit = taCheckpoint.ref ! snapshot
              override def onCompleted(id: String): Unit = taDone.ref ! id
            }))
            taRun ! PersistentMonarch.StartRun("ta-run", taInput, starts.ref)
            assert(starts.receiveMessage().isInstanceOf[PersistentMonarch.Accepted])
            if (taUnknown) {
              orders.awaitAssert(assert(orderState().taStatus == "accepted"), 10.seconds, 100.millis)
              taDone.expectNoMessage(200.millis)
              assert(!journal.persistedInStorage("joint-ta-monarch").exists(_.isInstanceOf[PersistentMonarch.StageDone]))
              assert(Await.result(client.query(taId.value), 5.seconds).get("canonicalReceipts").size() == 1)
              loseTaReply.set(false)
            }
            assert(taDone.receiveMessage(10.seconds) == "ta-run")
            assert(taCheckpoint.receiveMessage().submit_ta_taRequestId.contains(taId))
            val accepted = Await.result(client.query(taId.value), 8.seconds)
            assert(accepted.path("status").asText() == "accepted")
            val taHostCount = journal.persistedInStorage("joint-ta-host").size
            kit.stop(taHost)
            taHost = kit.spawn(TaHost("joint-ta-host", taBinding.installed))
            val taReplies = kit.createTestProbe[TaHost.Reply]()
            taHost ! TaHost.Invoke(taInput, taReplies.ref)
            assert(taReplies.receiveMessage().isInstanceOf[TaHost.Completed])
            assert(journal.persistedInStorage("joint-ta-host").size == taHostCount)
            val broken = accepted.deepCopy[com.fasterxml.jackson.databind.node.ObjectNode]()
            if (taUnknown) {
              val firstReceipt = broken.get("canonicalReceipts").get(0).deepCopy[com.fasterxml.jackson.databind.node.ObjectNode]()
              firstReceipt.put("outcome", "unknown")
              intercept[IllegalArgumentException](Await.result(ta.ingest(firstReceipt), 5.seconds))
              assert(orderState().taStatus == "accepted")
            }
            assert(orderState().taStatus == "accepted" && orderState().taConfirmedShares.shares.value.isEmpty)
            val afterAccepted = journal.persistedInStorage("joint-order").size
            Await.result(ta.submit(scenario), 8.seconds)
            assert(journal.persistedInStorage("joint-order").size == afterAccepted)
            if (scenario == "delayed") {
              client.close()
              client = new MockTAClient(directory.resolve("ta.jsonl"), directory.resolve("worker-reopened.jsonl"), directory.resolve("worker-reopened.stderr.log"))
              ta = new BankTaBridge(order, client)
              assert(Await.result(client.query(taId.value), 8.seconds).path("status").asText() == "accepted")
            }
            Await.result(client.advance(if (scenario == "delayed") 3 else 1), 8.seconds)
            val response = Await.result(ta.reconcile(), 8.seconds)
            if (scenario == "accepted") {
              assert(orderState().taStatus == "accepted")
              assert(orderState().taConfirmedShares.shares.value.isEmpty)
              intercept[IllegalArgumentException](Await.result(ta.requestRefund(), 5.seconds))
              assert(orderState().refundOperationId.value.isEmpty)
            } else if (scenario == "rejected") {
              assert(orderState().taStatus == "rejected")
              assert(orderState().taRejectionReason == "TA_DEMO_REJECTED")
              assert(orderState().refundOperationId.value.isEmpty)
              if (sip) {
                val terminal = new BankSipTerminalBridge(sipPlan, order, "joint-order", read)
                Await.result(terminal.record(occurrence.get), 5.seconds)
                assert(sipState().failureTotal == 0L && sipState().successTotal == 0L)
              }
              val intent = Await.result(ta.requestRefund(), 8.seconds)
              val intentCount = journal.persistedInStorage("joint-order").size
              assert(Await.result(ta.requestRefund(), 8.seconds) == intent)
              assert(journal.persistedInStorage("joint-order").size == intentCount)
              val hideRefund = new java.util.concurrent.atomic.AtomicBoolean(refundUnknown)
              def refundRead(pid: String): Future[Vector[GeneratedMessage]] = read(pid).map { events =>
                if (pid == "joint-collection" && hideRefund.get() && events.exists(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]))
                  throw new java.io.IOException("injected refund receipt transport failure")
                events
              }
              @volatile var refundCoordinator: ActorRef[StrictSagaCoordinator.Command] = null
              val refund = new BankRefundBindings(intent, investor, "joint-investor", collection, "joint-collection", order, "joint-order", refundRead, () => refundCoordinator)
              assert(refund.operationId != bindings.operationId)
              assert(!Await.result(refund.installed.BankRefundEntry(intent.copy(amount = Money(BigDecimal("101.00"), "CNY"))), 5.seconds))
              refundCanceled.foreach {
                case 0 => ledger(collection, CreditBalanceProtocol.ReleaseReservedFunds(TxId(refund.operationId), collectionId, amount))
                case 1 => ledger(investor, CreditBalanceProtocol.CancelIncomingCredit(TxId(refund.operationId), investorId, amount))
                case _ => fail("unknown cancellation participant")
              }
              refundCoordinator = kit.spawn(RefundDefinition.coordinator("joint-refund-saga", RefundDefinition.fromTechnical(refund.installed), new ReconcileAuthorizer {
                def authorize(id: TransactionIdentity, token: String): Either[String, String] =
                  if (refundUnknown && id.transactionId == refund.operationId && token == "owned-refund-recovery") Right("bank-refund-operator-v1")
                  else Left("operator cannot start or substitute refunds")
              }))
              val refundHost = kit.spawn(RefundHost("joint-refund-host", refundCoordinator, refund.installed))
              val refundDone = kit.createTestProbe[String]()
              val refundCheckpoint = kit.createTestProbe[RefundExecution.State]()
              val refundRun = kit.spawn(RefundExecution.behavior("joint-refund-monarch", RefundExecution.install(new RefundExecution.PureStages {}, refundHost), new DurableRunObserver[RefundExecution.State] {
                override def onCheckpointCommitted(cursor: String, metadata: Map[String, String], snapshot: RefundExecution.State): Unit = refundCheckpoint.ref ! snapshot
                override def onCompleted(id: String): Unit = refundDone.ref ! id
              }))
              refundRun ! PersistentMonarch.StartRun("refund-run", refund.parentInput, starts.ref)
              assert(starts.receiveMessage().isInstanceOf[PersistentMonarch.Accepted])
              if (refundUnknown) {
                orders.awaitAssert(assert(orderState().refundOutcome == "outcome-unknown"), 10.seconds, 100.millis)
                assert(orderState().refundFinalResults.isEmpty)
                refundDone.expectNoMessage(200.millis)
                if (sip) {
                  Await.result(new BankSipTerminalBridge(sipPlan, order, "joint-order", read).record(occurrence.get), 5.seconds)
                  assert(sipState().failureTotal == 0L)
                }
                val refundStatuses = kit.createTestProbe[StrictSagaCoordinator.Reply]()
                refundCoordinator ! StrictSagaCoordinator.GetStatus(refundStatuses.ref)
                val state = refundStatuses.receiveMessage().asInstanceOf[StrictSagaCoordinator.Status].state
                assert(state.status == StrictStatus.RecoveryRequired)
                hideRefund.set(false)
                refundCoordinator ! StrictSagaCoordinator.Reconcile(state.identity.get, "owned-refund-recovery", 32, refundStatuses.ref)
                assert(refundStatuses.receiveMessage().isInstanceOf[StrictSagaCoordinator.Status])
              }
              if (refundCanceled.nonEmpty) {
                val kind = if (refundCanceled.contains(0)) "rejected-before-effects" else "compensated"
                orders.awaitAssert(assert(orderState().refundOutcome == kind), 10.seconds, 100.millis)
                assert(orderState().refundFinalResults.get(TxId(refund.operationId)).contains(kind))
                assert(orderState().cashPaymentFinalResults.get(TxId(bindings.operationId)).contains("succeeded"))
                assert(balance(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
                assert(balance(collection).accountBalance("CNY").amount == BigDecimal("100.00"))
                assert(!journal.persistedInStorage("joint-collection").exists(_.isInstanceOf[CreditBalanceDeductFundsConfirmedPB]))
                val beforeNoncompletion = journal.persistedInStorage("joint-sip").size
                val terminal = new BankSipTerminalBridge(sipPlan, order, "joint-order", read)
                Await.result(terminal.record(occurrence.get), 5.seconds)
                assert(sipState().failureTotal == 0L && sipState().successTotal == 0L && sipState().firstTerminals.isEmpty)
                val afterObservation = journal.persistedInStorage("joint-sip").size
                Await.result(terminal.record(occurrence.get), 5.seconds)
                assert(journal.persistedInStorage("joint-sip").size == afterObservation && afterObservation >= beforeNoncompletion)
                val refundReplies = kit.createTestProbe[RefundHost.Reply]()
                val beforeRepeat = Vector("joint-investor", "joint-collection", "joint-order", "joint-refund-saga").map(p => p -> journal.persistedInStorage(p).size).toMap
                refundHost ! RefundHost.Invoke(refund.parentInput, refundReplies.ref)
                assert(refundReplies.receiveMessage().isInstanceOf[RefundHost.Completed])
                beforeRepeat.foreach { case (pid, count) => assert(journal.persistedInStorage(pid).size == count) }
              } else {
              assert(refundDone.receiveMessage(10.seconds) == "refund-run")
              assert(refundCheckpoint.receiveMessage().return_principal_refundTxid.contains(TxId(refund.operationId)))
              assert(orderState().refundOutcome == "succeeded")
              val terminalState = orderState()
              val noConflictWrites = journal.persistedInStorage("joint-order").size
              val receipt = terminalState.refundResultReceipts.head
              order ! FundOrderAggregate.Execute(FundOrderProtocol.RecordFundRefundCompensated(TxId(refund.operationId), intent.refundOperationId,
                receipt._1, receipt._2), orderReplies.ref)
              assert(orderReplies.receiveMessage().isInstanceOf[FundOrderAggregate.Refused])
              assert(journal.persistedInStorage("joint-order").size == noConflictWrites)
              assert(balance(investor).accountBalance("CNY").amount == BigDecimal("1000.00"))
              assert(balance(collection).accountBalance("CNY").amount == BigDecimal("0.00"))
              val afterRefund = Vector("joint-investor", "joint-collection", "joint-order", "joint-refund-saga").map(p => p -> journal.persistedInStorage(p).size).toMap
              val refundReplies = kit.createTestProbe[RefundHost.Reply]()
              refundHost ! RefundHost.Invoke(refund.parentInput, refundReplies.ref)
              assert(refundReplies.receiveMessage().isInstanceOf[RefundHost.Completed])
              afterRefund.foreach { case (pid, count) => assert(journal.persistedInStorage(pid).size == count) }
              refundHost ! RefundHost.Invoke(refund.parentInput.copy(inputs = refund.parentInput.inputs.copy(paymentTxId = TxId("other-payment"))), refundReplies.ref)
              assert(refundReplies.receiveMessage().isInstanceOf[RefundHost.Conflict])
              }
            } else {
              assert(orderState().taStatus == "confirmed")
              assert(orderState().taConfirmedShares.shares.value == "80.0000")
              assert(orderState().taConfirmedShares.nav.value == "1.2345")
              val receipts = response.get("receipts")
              val good = receipts.get(1)
              val beforeReceipt = journal.persistedInStorage("joint-order").size
              Await.result(ta.ingest(good), 8.seconds)
              assert(journal.persistedInStorage("joint-order").size == beforeReceipt)
              val bad = good.deepCopy[com.fasterxml.jackson.databind.node.ObjectNode]()
              bad.put("fundCollectionAccountId", "substitute-account")
              intercept[IllegalArgumentException](Await.result(ta.ingest(bad), 8.seconds))
              if (scenario == "duplicate-conflicting") intercept[IllegalArgumentException](Await.result(ta.ingest(receipts.get(2)), 8.seconds))
              assert(journal.persistedInStorage("joint-order").size == beforeReceipt)
            }
            if (sip) {
              val terminal = new BankSipTerminalBridge(sipPlan, order, "joint-order", read)
              Await.result(terminal.record(occurrence.get), 5.seconds)
              val expectedSuccess = if (scenario == "accepted" || scenario == "rejected") 0L else 1L
              val expectedFailure = if (scenario == "rejected" && refundCanceled.isEmpty) 1L else 0L
              assert(sipState().successTotal == expectedSuccess && sipState().failureTotal == expectedFailure)
              val beforeTerminal = journal.persistedInStorage("joint-sip").size
              Await.result(terminal.record(occurrence.get), 5.seconds)
              assert(journal.persistedInStorage("joint-sip").size == beforeTerminal)
              if (expectedSuccess + expectedFailure > 0L) {
                sipCommand(SipPlanProtocol.RecordSipInstallmentOutcomeUnknown(occurrence.get))
                assert(journal.persistedInStorage("joint-sip").size == beforeTerminal)
                if (expectedSuccess == 1L) {
                  sipPlan ! SipPlanAggregate.Execute(SipPlanProtocol.RecordSipInstallmentFailed(occurrence.get, "payment-compensated", "late-conflict", "late-body"), sipReplies.ref)
                  assert(sipReplies.receiveMessage() == SipPlanAggregate.Refused("SIP_TERMINAL_CONFLICT"))
                  assert(sipState().occurrenceProgress(occurrence.get.occurrenceId) == "succeeded")
                  assert(journal.persistedInStorage("joint-sip").size == beforeTerminal)
                }
              }
              assert(sipState().paused)
            }
            val principalReturned = scenario == "rejected" && refundCanceled.isEmpty
            assert(balance(investor).accountBalance("CNY").amount == BigDecimal(if (principalReturned) "1000.00" else "900.00"))
            assert(balance(collection).accountBalance("CNY").amount == BigDecimal(if (principalReturned) "0.00" else "100.00"))
          } finally client.close()
        }
        val bytes = Execution.codec.encode(bindings.parentInput)
        assert(Execution.codec.decode(bytes).inputs.fundCode == "FUND-中文-001")
      } else {
        assert(expectedKind == "rejected-before-effects")
        assert(balance(investor).accountBalance("CNY").amount == BigDecimal(available))
        assert(balance(collection).accountBalance("CNY").amount == BigDecimal("0.00"))
        assert(status().evidence.values.exists(_.isInstanceOf[Evidence.Absent]))
        assert(!journal.persistedInStorage("joint-investor").exists(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]))
        assert(journal.persistedInStorage("joint-investor").exists(_.isInstanceOf[CreditBalanceReleaseReservedFundsConfirmedPB]))
        ledger(investor, CreditBalanceProtocol.ReserveFunds(TxId(bindings.operationId), investorId, amount))
        assert(!journal.persistedInStorage("joint-investor").exists(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]))
        assert(completed.receiveMessage(5.seconds) == "failed")
        if (sip) {
          val terminal = new BankSipTerminalBridge(sipPlan, order, "joint-order", read)
          Await.result(terminal.record(occurrence.get), 5.seconds)
          assert(sipState().successTotal == 0L && sipState().failureTotal == 1L)
          Await.result(terminal.record(occurrence.get), 5.seconds)
          assert(sipState().failureTotal == 1L)
        }
      }
    } finally kit.shutdownTestKit()
  }
  test("PAY-success/repeat/conflict: real Saga and Monarch drive generated bank actors and guarded result delivery") {
    runCase("1000.00", "succeeded")
  }
  test("PAY-unknown-recover: unavailable receipt after debit reattaches and reconciles without another debit") {
    runCase("1000.00", "succeeded", loseReceipt = true)
  }
  test("PAY-unknown-recover after durable commit decision: same parent and Saga finish forward without compensation") {
    runCase("1000.00", "succeeded", loseCommitReceipt = true)
  }
  test("SIP-refund-count-boundary rejected-before-effects: real canceled first participant never returns principal or counts failure") {
    runCase("1000.00", "succeeded", taScenario = Some("rejected"), sip = true, refundCanceled = Some(0))
  }
  test("SIP-refund-count-boundary compensated: real second participant cancellation restores collection without counting refund completion") {
    runCase("1000.00", "succeeded", taScenario = Some("rejected"), sip = true, refundCanceled = Some(1))
  }
  test("TA-confirm/repeat/wrong-resource/conflicting-body: paid order consumes authoritative MockTA exact receipts") {
    runCase("1000.00", "succeeded", taScenario = Some("duplicate-conflicting"))
  }
  test("TA delayed confirmation survives actual MockTA process close and journal reopen with the same request") {
    runCase("1000.00", "succeeded", taScenario = Some("delayed"))
  }
  test("TA-unknown-confirm: lost submission response is queried without duplicate submission before shares confirm") {
    runCase("1000.00", "succeeded", taScenario = Some("confirmed"), taUnknown = true)
  }
  test("TA-accepted-only: accepted submission is not share confirmation") {
    runCase("1000.00", "succeeded", taScenario = Some("accepted"))
  }
  test("TA-rejected/REFUND-success/repeat/substitute: authoritative rejection creates one independent full-principal refund") {
    runCase("1000.00", "succeeded", taScenario = Some("rejected"))
  }
  test("SIP-success/inflight-pause/late-terminal: durable occurrence drives cash and TA before first terminal count") {
    runCase("1000.00", "succeeded", taScenario = Some("duplicate-conflicting"), sip = true)
  }
  test("SIP-refund-count-boundary: TA rejection counts failure only after independent refund completion") {
    runCase("1000.00", "succeeded", taScenario = Some("rejected"), sip = true)
  }
  test("REFUND-unknown-recover/SIP-refund-count-boundary: missing refund evidence never counts failure early") {
    runCase("1000.00", "succeeded", taScenario = Some("rejected"), sip = true, refundUnknown = true)
  }
  test("SIP-no-effects-failure: real payment early rejection counts a single failed occurrence") {
    runCase("50.00", "rejected-before-effects", sip = true)
  }
  test("SIP-unknown-recover: pending payment recovery does not count a terminal until TA confirms") {
    runCase("1000.00", "succeeded", loseReceipt = true, taScenario = Some("confirmed"), sip = true)
  }
  test("PAY-early-reject/cancel-before-prepare: durable participant cancellation fences late debit") {
    runCase("50.00", "rejected-before-effects")
  }
}
