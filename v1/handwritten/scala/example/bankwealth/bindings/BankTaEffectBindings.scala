package example.bankwealth.bindings

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import example.bankwealth.application.{bank_ta_effectEffectHost => Host, bank_ta_submission_v1Execution => Execution}
import example.bankwealth.domain.{FundOrderAggregate, FundOrderState}
import example.bankwealth.domain.values._
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

object BankTaEffectBindings {
  /** Constructor input for BankRuntime.taBindings. Both host paths resolve the
    * scenario from the same trusted deployment function, never an HTTP field.
    */
  def forOrders(client: MockTAClient, scenarioForOrder: FundOrderId => String)
      (implicit system: ActorSystem[_]): ActorRef[FundOrderAggregate.Request] => Host.Installed = {
    require(client != null && !client.usesLegacyConfiguration && scenarioForOrder != null,
      "explicit MockTA configuration and trusted per-order scenarios required")
    order => {
      val bridge = new BankTaBridge(order, client)
      def bindings(operation: BankTaEffectOperation): Host.Installed = {
        val scenario = scenarioForOrder(operation.request.fundOrderId)
        require(scenario != null && scenario.nonEmpty, "trusted TA scenario required")
        new BankTaEffectBindings(order, client, bridge, scenario).installed
      }
      Host.install(Host.Bindings(
        Host.Implementation("bankwealth.BankTaEffectExecute", "bank-v1-1", (operation: BankTaEffectOperation) =>
          bindings(operation).execute(operation)),
        Host.Implementation("bankwealth.BankTaEffectQuery", "bank-v1-1", (operation: BankTaEffectOperation) =>
          bindings(operation).query(operation)),
        Host.Implementation("bankwealth.BankTaEffectReconcilePort", "bank-v1-1", (_: BankTaEffectReconcile) => Future.successful(false))
      ))
    }
  }
}

final class BankTaEffectBindings(order: ActorRef[FundOrderAggregate.Request], client: MockTAClient, bridge: BankTaBridge,
    scenario: String)(implicit system: ActorSystem[_]) {
  require(order != null && client != null && bridge != null && scenario != null && scenario.nonEmpty,
    "complete trusted TA effect binding required")
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)
  private def verify(operation: BankTaEffectOperation): Future[FundOrderState] = {
    val request = operation.request
    val parent = Execution.State(Execution.Inputs(request.taRequestId, request.fundOrderId, request.paymentTxId))
    require(operation.operation == Host.operationIdentity(parent), "TA effect operation identity mismatch")
    order.ask[FundOrderState](FundOrderAggregate.GetState).map { state =>
      require(state.id == request.fundOrderId && state.selectedPaymentTxId == request.paymentTxId && state.taRequestId == request.taRequestId &&
        state.cashPaymentFinalResults.get(request.paymentTxId).contains("succeeded"), "TA effect requires exact retained paid request")
      state
    }
  }
  private def observation(operation: BankTaEffectOperation, response: com.fasterxml.jackson.databind.JsonNode): BankTaEffectObservation = {
    require(response.path("requestId").asText() == operation.request.taRequestId.value && response.path("canonicalReceipts").isArray, "TA response association mismatch")
    val known = response.path("request").isObject && response.get("canonicalReceipts").size() > 0
    BankTaEffectObservation(operation.operation, operation.request, if (known) "confirmed" else "unknown", response.toString,
      if (known) Some(BankTaEffectResult(operation.request.taRequestId)) else None)
  }
  val installed: Host.Installed = Host.install(Host.Bindings(
    Host.Implementation("bankwealth.BankTaEffectExecute", "bank-v1-1", (operation: BankTaEffectOperation) =>
      verify(operation).flatMap(_ => bridge.submit(scenario)).map(observation(operation, _))),
    Host.Implementation("bankwealth.BankTaEffectQuery", "bank-v1-1", (operation: BankTaEffectOperation) =>
      verify(operation).flatMap(_ => bridge.reconcile(scenario)).map(response => Some(observation(operation, response)))),
    Host.Implementation("bankwealth.BankTaEffectReconcilePort", "bank-v1-1", (_: BankTaEffectReconcile) => Future.successful(false))
  ))
}
