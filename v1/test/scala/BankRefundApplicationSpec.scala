import akka.actor.typed.scaladsl.AskPattern._
import example.bankwealth.bindings.BankRefundBindings
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import net.imadz.infra.saga.strict._
import net.imadz.monarch.persistence.PersistentMonarch
import org.scalatest.funsuite.AnyFunSuite
import scala.concurrent.{Future, ExecutionContext}
import scala.jdk.CollectionConverters._

final class BankRefundApplicationSpec extends AnyFunSuite {
  import BankTaApplicationFixture._

  private def reject(h: Harness): example.bankwealth.ta.BankTaRefundApplication = {
    h.pay()
    val app = h.application()
    h.accepted(app)
    h.await(h.client.advance(1L))
    assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
    h.eventually(assert(h.state.taStatus == "rejected" && h.state.refundOperationId.value.nonEmpty))
    app
  }

  test("REFUND-application-success: one independent reverse Saga returns original principal and conflicting/repeated resumes cannot refund twice") {
    withHarness("rejected") { h =>
      implicit val ec: ExecutionContext = h.ec
      val app = reject(h)
      val graph = h.refundRuntime
      val ta = h.taRuntime
      val original = h.refundOriginal
      val paymentTx = h.state.selectedPaymentTxId
      assert(graph.transactionId != paymentTx.value && original.paymentTxId == paymentTx)
      h.eventually {
        assert(h.state.refundOutcome == "succeeded" && h.state.refundFinalResults.get(TxId(graph.transactionId)).contains("succeeded"))
        assert(h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 1)
        assert(h.eventCount[PersistentMonarch.StageDone](ta.parent.persistenceId) == 1)
        assert(!h.terminalCalls.isEmpty)
      }
      assert(h.balance(h.investor) == BigDecimal("1000.00") && h.balance(h.collection) == BigDecimal("0.00"))
      assert(h.state.cashPaymentFinalResults.get(paymentTx).contains("succeeded"))
      assert(h.eventCount[FundOrderFundPurchaseRefundRequestedPB](h.order.persistenceId) == 1)
      assert(h.eventCount[FundOrderFundRefundSucceededPB](h.order.persistenceId) == 1)
      assert(h.eventCount[CreditBalanceDeductFundsConfirmedPB](h.ids.account(h.collection)) == 1)
      assert(h.eventCount[CreditBalanceCommitIncomingCreditsConfirmedPB](h.ids.account(h.investor)) == 1)
      val investor = h.await(h.runtime.account(h.investor))
      val collection = h.await(h.runtime.account(h.collection))
      val binding = new BankRefundBindings(original, investor.ref, investor.persistenceId, collection.ref,
        collection.persistenceId, h.order.ref, h.order.persistenceId, pid => h.journal.readPb(pid), () => graph.coordinator.ref)(h.system)
      assert(!h.await(binding.installed.BankRefundEntry(original.copy(amount = Money(BigDecimal("101.00"), "CNY")))))
      intercept[IllegalArgumentException](h.await(h.runtime.ensureRefund(original.copy(paymentTxId = TxId("substitute-payment")))))
      val observed = Vector(h.order.persistenceId, investor.persistenceId, collection.persistenceId,
        graph.coordinator.persistenceId, graph.host.persistenceId, graph.parent.persistenceId, ta.host.persistenceId, ta.parent.persistenceId)
      val before = observed.map(pid => pid -> h.storage.persistedInStorage(pid).size).toMap
      assert(h.await(Future.sequence(Vector.fill(8)(app.resumeExisting(h.payment.fundOrderId)))).forall(_ == Right(())))
      before.foreach { case (pid, size) => assert(h.storage.persistedInStorage(pid).size == size) }
      assert(h.terminalCalls.asScala.forall(_ == h.payment.fundOrderId))
      // Recovery is authorized by durable originals, not availability of the TA process.
      app.close()
      h.client.close()
      h.restartRuntime()
      val recovered = h.application()
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.refundOriginal == original && h.refundRuntime.transactionId == graph.transactionId)
      assert(h.eventCount[PersistentMonarch.RunStarted](graph.parent.persistenceId) == 1)
      assert(h.eventCount[FundOrderFundPurchaseRefundRequestedPB](h.order.persistenceId) == 1)
      assert(h.eventCount[CreditBalanceDeductFundsConfirmedPB](h.ids.account(h.collection)) == 1)
      assert(h.balance(h.investor) == BigDecimal("1000.00") && h.balance(h.collection) == BigDecimal("0.00"))
    }
  }

  test("REFUND-application-UNKNOWN-recover: lost real prepare evidence preserves the original parent and authorized reconciliation never debits twice") {
    withHarness("rejected", hideRefundReceipt = true) { h =>
      implicit val timeout: akka.util.Timeout = h.timeout
      implicit val system: akka.actor.typed.ActorSystem[_] = h.system
      val app = reject(h)
      val graph = h.refundRuntime
      h.taRuntime // include the live generated TA graph in the bounded actor restart
      h.eventually {
        assert(h.state.refundOutcome == "outcome-unknown")
        assert(h.hiddenRefundReads.get() > 0)
        assert(h.refundStatus.status == StrictStatus.RecoveryRequired)
      }
      val unknown = h.refundStatus
      val original = h.refundOriginal
      val paymentTx = h.state.selectedPaymentTxId
      assert(!unknown.terminal && unknown.identity.exists(_.transactionId == graph.transactionId))
      assert(h.state.refundFinalResults.isEmpty && h.terminalCalls.isEmpty)
      assert(h.eventCount[PersistentMonarch.StageDone](graph.parent.persistenceId) == 0)
      assert(h.eventCount[PersistentMonarch.RunFailedEvt](graph.parent.persistenceId) == 0)
      assert(h.eventCount[CreditBalanceReserveFundsConfirmedPB](h.ids.account(h.collection)) == 1)
      assert(h.eventCount[CreditBalanceDeductFundsConfirmedPB](h.ids.account(h.collection)) == 0)
      assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.refundOriginal == original && h.eventCount[FundOrderFundPurchaseRefundRequestedPB](h.order.persistenceId) == 1)
      h.restartRuntime()
      h.hideRefundEvidence.set(false)
      val recovered = h.application()
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      val retained = h.refundRuntime
      assert(h.refundStatus.identity == unknown.identity && retained.transactionId == graph.transactionId)
      assert(h.await(retained.coordinator.ref.ask[StrictSagaCoordinator.Reply](r =>
        StrictSagaCoordinator.Reconcile(unknown.identity.get, "denied", 32, r))).isInstanceOf[StrictSagaCoordinator.Denied])
      assert(h.await(retained.coordinator.ref.ask[StrictSagaCoordinator.Reply](r =>
        StrictSagaCoordinator.Reconcile(unknown.identity.get, "owned-b-refund-recovery", 32, r))).isInstanceOf[StrictSagaCoordinator.Status])
      h.eventually {
        assert(h.refundStatus.status == StrictStatus.Succeeded)
        assert(h.state.refundOutcome == "succeeded")
        assert(h.eventCount[PersistentMonarch.StageDone](retained.parent.persistenceId) == 1)
      }
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(!h.terminalCalls.isEmpty && h.state.cashPaymentFinalResults.get(paymentTx).contains("succeeded"))
      assert(h.refundOriginal == original && h.eventCount[PersistentMonarch.RunStarted](retained.parent.persistenceId) == 1)
      assert(h.eventCount[CreditBalanceReserveFundsConfirmedPB](h.ids.account(h.collection)) == 1)
      assert(h.eventCount[CreditBalanceDeductFundsConfirmedPB](h.ids.account(h.collection)) == 1)
      assert(h.eventCount[CreditBalanceCommitIncomingCreditsConfirmedPB](h.ids.account(h.investor)) == 1)
      assert(h.eventCount[FundOrderFundPurchaseRefundRequestedPB](h.order.persistenceId) == 1)
      assert(h.eventCount[FundOrderFundRefundSucceededPB](h.order.persistenceId) == 1)
      assert(h.balance(h.investor) == BigDecimal("1000.00") && h.balance(h.collection) == BigDecimal("0.00"))
    }
  }

  private def canceledRefund(index: Int, expected: String): Unit = {
    withHarness("rejected") { h =>
      h.pay()
      h.await(h.bridge.submit("rejected"))
      h.await(h.client.advance(1L))
      h.await(h.bridge.reconcile("rejected"))
      assert(h.state.taStatus == "rejected" && h.state.refundOperationId.value.isEmpty)
      val intent = h.await(h.bridge.requestRefund())
      val graph = h.refundRuntime // assemble only; the persisted parent has not started
      assert(h.eventCount[PersistentMonarch.RunStarted](graph.parent.persistenceId) == 0)
      if (index == 0) h.ledger(h.collection, CreditBalanceProtocol.ReleaseReservedFunds(TxId(graph.transactionId), h.collection, intent.amount))
      else h.ledger(h.investor, CreditBalanceProtocol.CancelIncomingCredit(TxId(graph.transactionId), h.investor, intent.amount))
      val app = h.application()
      assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
      h.taRuntime
      h.eventually {
        assert(h.state.refundOutcome == expected && h.state.refundFinalResults.get(TxId(graph.transactionId)).contains(expected))
        assert(h.refundStatus.terminal)
      }
      assert(h.terminalCalls.isEmpty && h.state.cashPaymentFinalResults.get(intent.paymentTxId).contains("succeeded"))
      assert(h.balance(h.investor) == BigDecimal("900.00") && h.balance(h.collection) == BigDecimal("100.00"))
      assert(h.eventCount[FundOrderFundRefundSucceededPB](h.order.persistenceId) == 0)
      assert(h.eventCount[CreditBalanceDeductFundsConfirmedPB](h.ids.account(h.collection)) == 0)
      assert(h.await(app.resumeExisting(h.payment.fundOrderId)) == Right(()))
      h.restartRuntime()
      val recovered = h.application()
      assert(h.await(recovered.resumeExisting(h.payment.fundOrderId)) == Right(()))
      assert(h.state.refundOutcome == expected && h.refundOriginal == intent && h.terminalCalls.isEmpty)
      assert(h.eventCount[FundOrderFundPurchaseRefundRequestedPB](h.order.persistenceId) == 1)
      assert(h.eventCount[PersistentMonarch.RunStarted](graph.parent.persistenceId) == 1)
      assert(h.balance(h.investor) == BigDecimal("900.00") && h.balance(h.collection) == BigDecimal("100.00"))
    }
  }

  test("REFUND-application-rejected-before-effects: canceled collection prepare never returns principal or creates another refund") {
    canceledRefund(0, "rejected-before-effects")
  }

  test("REFUND-application-compensated: canceled investor prepare restores collection but is not completed refund or terminal delivery") {
    canceledRefund(1, "compensated")
  }
}
