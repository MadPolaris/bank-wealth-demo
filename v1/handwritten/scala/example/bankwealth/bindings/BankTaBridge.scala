package example.bankwealth.bindings

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import example.bankwealth.domain.{FundOrderAggregate, FundOrderProtocol, FundOrderState}
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.serialization.DomainConverters
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._

final class BankTaBridge(order: ActorRef[FundOrderAggregate.Request], ta: MockTAClient)(implicit system: ActorSystem[_]) {
  private val mapper = new ObjectMapper()
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)
  private def state(): Future[FundOrderState] = order.ask[FundOrderState](FundOrderAggregate.GetState)
  private def execute(command: FundOrderProtocol.Command): Future[Unit] =
    order.ask[FundOrderAggregate.Reply](reply => FundOrderAggregate.Execute(command, reply)).map {
      case FundOrderAggregate.Accepted(_) => ()
      case FundOrderAggregate.Refused(code) => throw new IllegalArgumentException(code)
    }
  private def fields(node: JsonNode, expected: Set[String]): Unit =
    require(node != null && node.isObject && node.fieldNames().asScala.toSet == expected, "TA receipt fields differ from exact contract")
  private def text(node: JsonNode, name: String): String = {
    val value = node.get(name)
    require(value != null && value.isTextual && value.textValue().nonEmpty && value.textValue().getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 4096, "TA nonempty bounded text required: " + name)
    value.textValue()
  }
  private def exactPositive(node: JsonNode, name: String): TaExactText = {
    val value = text(node, name)
    require(value.matches("(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?") && value.exists(c => c >= '1' && c <= '9'), "positive exact TA decimal text required")
    TaExactText(value)
  }
  private def paid(s: FundOrderState): Unit =
    require(s.selectedPaymentTxId.value.nonEmpty && s.cashPaymentFinalResults.get(s.selectedPaymentTxId).contains("succeeded"), "TA requires guarded payment success")
  private def request(s: FundOrderState, scenario: String): JsonNode = {
    paid(s); require(s.taRequestId.value.nonEmpty, "durable TA request identity required")
    val wire = DomainConverters.MoneyToWire(s.amount)
    val result = mapper.createObjectNode().put("requestId", s.taRequestId.value).put("orderId", s.id.value)
      .put("paymentTxId", s.selectedPaymentTxId.value).put("investorAccountId", s.investorAccountId.value)
      .put("fundCollectionAccountId", s.fundCollectionAccountId.value).put("fundCode", s.fundCode).put("scenario", scenario)
    result.set[JsonNode]("amount", mapper.createObjectNode().put("minorUnits", wire.minorUnits).put("currency", wire.currency))
    result
  }
  def register(): Future[BankTaEffectRequest] = for {
    before <- state()
    _ = paid(before)
    _ <- if (before.taRequestId.value.isEmpty)
      execute(FundOrderProtocol.RegisterFundTASubmission(before.id, before.selectedPaymentTxId))
      else {
        require(before.taRequestId == StableOrderIdentity.StableTaRequestId(before,
          FundOrderProtocol.RegisterFundTASubmission(before.id, before.selectedPaymentTxId)), "retained TA identity is not the original")
        Future.successful(())
      }
    retained <- state()
    _ = require(retained.id == before.id && retained.selectedPaymentTxId == before.selectedPaymentTxId &&
      retained.taRequestId == StableOrderIdentity.StableTaRequestId(retained,
        FundOrderProtocol.RegisterFundTASubmission(retained.id, retained.selectedPaymentTxId)), "registered TA original changed")
  } yield BankTaEffectRequest(retained.taRequestId, retained.id, retained.selectedPaymentTxId)

  def submit(scenario: String): Future[JsonNode] = for {
    original <- register()
    registered <- state()
    _ = require(registered.taRequestId == original.taRequestId, "registered TA identity changed")
    response <- ta.submit(request(registered, scenario))
    _ <- applyResponse(response)
  } yield response
  def reconcile(): Future[JsonNode] = reconcileWithScenario(None)
  def reconcile(scenario: String): Future[JsonNode] = {
    require(scenario != null && scenario.nonEmpty, "trusted TA scenario required")
    reconcileWithScenario(Some(scenario))
  }
  private def reconcileWithScenario(scenario: Option[String]): Future[JsonNode] = for {
    s <- state()
    _ = paid(s)
    _ = require(s.taRequestId.value.nonEmpty, "no durable TA request to recover")
    response <- ta.query(s.taRequestId.value)
    _ = require(!response.path("request").isObject || scenario.forall(_ == response.path("request").path("scenario").asText()),
      "TA scenario differs from trusted deployment selection")
    _ <- applyResponse(response)
  } yield response
  def requestRefund(): Future[BankRefundOriginal] = state().flatMap { before =>
    paid(before)
    require(before.taStatus == "rejected" && before.taRequestId.value.nonEmpty, "related TA rejection required")
    // The original persisted intent is sufficient to reattach the independent parent,
    // even when the external TA is now unavailable. Never mint an attempt identity.
    if (before.refundOperationId.value.nonEmpty) Future.successful(refundOriginal(before))
    else for {
      response <- ta.query(before.taRequestId.value)
      _ = responseAssociation(response, before)
      rejected = response.get("canonicalReceipts").elements().asScala.toVector.filter(r => r.path("outcome").asText() == "rejected")
      _ = require(rejected.size == 1, "unique authoritative TA rejection required")
      _ <- ingest(rejected.head)
      _ <- execute(FundOrderProtocol.RequestFundPurchaseRefund(before.id, before.selectedPaymentTxId))
      retained <- state()
      _ = require(retained.id == before.id && retained.selectedPaymentTxId == before.selectedPaymentTxId && retained.refundOperationId.value.nonEmpty,
        "durable independent refund intent missing or changed")
    } yield refundOriginal(retained)
  }
  private def refundOriginal(s: FundOrderState): BankRefundOriginal =
    BankRefundOriginal(s.id, s.selectedPaymentTxId, s.investorAccountId, s.fundCollectionAccountId, s.amount, s.refundOperationId)

  private def responseAssociation(response: JsonNode, s: FundOrderState): Unit = {
    require(response != null && response.isObject && text(response, "requestId") == s.taRequestId.value &&
      response.path("canonicalReceipts").isArray, "complete same-request authoritative TA response required")
    val original = response.get("request")
    if (original != null) {
      fields(original, Set("requestId", "orderId", "paymentTxId", "investorAccountId", "fundCollectionAccountId", "fundCode", "amount", "scenario"))
      val expected = request(s, text(original, "scenario"))
      require(original == expected, "TA retained financial original differs from paid order")
    } else require(response.get("canonicalReceipts").size() == 0 && response.path("status").asText() == "unknown",
      "unknown query without original must not contain receipts or a terminal result")
  }
  private def applyResponse(response: JsonNode): Future[Unit] = state().flatMap { s =>
    responseAssociation(response, s)
    response.get("canonicalReceipts").elements().asScala.toVector.foldLeft(Future.successful(()))((done, receipt) => done.flatMap(_ => ingest(receipt)))
  }
  def ingest(receipt: JsonNode): Future[Unit] = {
    val requestId = text(receipt, "requestId")
    for {
      s <- state()
      _ = paid(s)
      decoded = decode(receipt, s)
      authoritative <- ta.query(requestId)
      _ = responseAssociation(authoritative, s)
      _ = require(authoritative.get("canonicalReceipts").elements().asScala.exists(_ == receipt), "receipt body is not authoritative for this TA request")
      _ <- execute(command(decoded))
    } yield ()
  }
  private def decode(receipt: JsonNode, s: FundOrderState): TaReceipt = {
    val outcome = text(receipt, "outcome")
    require(Set("accepted", "confirmed", "rejected", "unknown")(outcome), "unknown TA outcome")
    val base = Set("receiptId", "requestId", "orderId", "paymentTxId", "taReference", "investorAccountId", "fundCollectionAccountId", "fundCode", "amount", "outcome", "businessTick")
    fields(receipt, base ++ (if (outcome == "confirmed") Set("shares") else if (outcome == "rejected") Set("reason") else Set.empty[String]))
    val tick = receipt.get("businessTick")
    require(tick.isIntegralNumber && tick.canConvertToLong && tick.longValue() >= 0 && tick.longValue() <= 9007199254740991L, "exact bounded TA tick required")
    require(text(receipt, "requestId") == s.taRequestId.value && text(receipt, "orderId") == s.id.value &&
      text(receipt, "paymentTxId") == s.selectedPaymentTxId.value && text(receipt, "investorAccountId") == s.investorAccountId.value &&
      text(receipt, "fundCollectionAccountId") == s.fundCollectionAccountId.value && text(receipt, "fundCode") == s.fundCode, "TA original association mismatch")
    val amount = receipt.get("amount"); fields(amount, Set("minorUnits", "currency"))
    val minor = text(amount, "minorUnits"); val currency = text(amount, "currency")
    val money = DomainConverters.MoneyFromWire(MoneyWire(minor, currency))
    require(money == s.amount && minor.matches("[1-9][0-9]*"), "TA amount differs from paid principal")
    val principal = DomainConverters.AmountDecimalFromWire(AmountDecimalWire(minor))
    val share = if (outcome == "confirmed") {
      val shares = receipt.get("shares"); fields(shares, Set("fundCode", "shares", "nav"))
      require(text(shares, "fundCode") == s.fundCode, "TA share fund mismatch")
      FundShare(s.fundCode, exactPositive(shares, "shares"), exactPositive(shares, "nav"))
    } else FundShare(s.fundCode, TaExactText(""), TaExactText(""))
    TaReceipt(s.id, s.selectedPaymentTxId, s.taRequestId, s.investorAccountId, s.fundCollectionAccountId, s.fundCode,
      money, principal, text(receipt, "receiptId"), mapper.writeValueAsString(receipt), text(receipt, "taReference"), outcome,
      share.shares, share.nav, if (outcome == "rejected") text(receipt, "reason") else "")
  }
  private def command(r: TaReceipt): FundOrderProtocol.Command = {
    import FundOrderProtocol._
    r.status match {
      case "accepted" => RecordFundTAAccepted(r.fundOrderId, r.paymentTxId, r.taRequestId, r.taReference, r.receiptId, r.receiptBody, r.fundCode, r.amount.currency)
      case "unknown" => RecordFundTAUnknown(r.fundOrderId, r.paymentTxId, r.taRequestId, r.taReference, r.receiptId, r.receiptBody, r.fundCode, r.amount.currency)
      case "rejected" => RecordFundTARejected(r.fundOrderId, r.paymentTxId, r.taRequestId, r.taReference, r.receiptId, r.receiptBody, r.fundCode, r.amount.currency, r.reason)
      case "confirmed" => RecordFundTAConfirmed(r.fundOrderId, r.paymentTxId, r.taRequestId, r.taReference, r.receiptId, r.receiptBody, r.fundCode, r.amount.currency, FundShare(r.fundCode, r.shares, r.nav))
    }
  }
}
