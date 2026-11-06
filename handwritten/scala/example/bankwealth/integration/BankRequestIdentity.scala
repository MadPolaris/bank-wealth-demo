package example.bankwealth.integration

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import example.bankwealth.domain.values._

object BankRequestIdentity {
  private def digest(kind: String, principalId: String, requestId: String): String = {
    require(principalId != null && principalId.nonEmpty && principalId.length <= 256, "bounded principal required")
    require(requestId != null && requestId.nonEmpty && requestId.length <= 128, "bounded client request identity required")
    val fields = Vector("bank-request-v1", kind, principalId, requestId).map(_.getBytes(StandardCharsets.UTF_8))
    val hash = MessageDigest.getInstance("SHA-256")
    fields.foreach { bytes =>
      hash.update(java.nio.ByteBuffer.allocate(4).putInt(bytes.length).array())
      hash.update(bytes)
    }
    hash.digest().map(b => f"${b & 0xff}%02x").mkString
  }
  def order(principalId: String, clientRequestId: String): FundOrderId =
    FundOrderId("cash-" + digest("cash", principalId, clientRequestId))
  def operation(principalId: String, clientRequestId: String): OperationId =
    OperationId("cash-" + digest("cash", principalId, clientRequestId))
  def plan(principalId: String, clientRequestId: String): PlanId =
    PlanId("sip-" + digest("sip", principalId, clientRequestId))
}

final class BankPersistenceIds(val namespace: String) {
  require(namespace != null && namespace.matches("[A-Za-z][A-Za-z0-9_-]{0,63}"), "explicit persistence namespace required")
  val prefix: String = namespace + "/"
  private def key(kind: String, value: String): String = {
    require(value != null && value.nonEmpty && value.length <= 1024, "bounded resource identity required")
    val encoded = java.util.Base64.getUrlEncoder.withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8))
    prefix + kind + "/" + encoded
  }
  def account(id: AccountId): String = key("account", id.value)
  def order(id: FundOrderId): String = key("order", id.value)
  def plan(id: PlanId): String = key("plan", id.value)
  def paymentSaga(id: OperationId): String = key("payment-saga", id.value)
  def paymentHost(id: OperationId): String = key("payment-host", id.value)
  def paymentRun(id: OperationId): String = key("payment-run", id.value)
  def refundSaga(id: OperationId): String = key("refund-saga", id.value)
  def refundHost(id: OperationId): String = key("refund-host", id.value)
  def refundRun(id: OperationId): String = key("refund-run", id.value)
  def taHost(id: TaRequestId): String = key("ta-host", id.value)
  def taRun(id: TaRequestId): String = key("ta-run", id.value)
  def sipHost(id: OccurrenceId): String = key("sip-host", id.value)
  def sipRun(id: OccurrenceId): String = key("sip-run", id.value)
  def owns(persistenceId: String): Boolean = persistenceId != null && persistenceId.startsWith(prefix)
}
