// ═══════════════════════════════════════════════════════════════════════════
// HANDWRITTEN ISOLATION ZONE — AI Agent / Engineer Editable Surface
// Bound to: fixture.CommandMapper, fixture.ReceiptMapper, fixture.ExactMoneyCodec
// ═══════════════════════════════════════════════════════════════════════════
package fixture.wealth.adapter

import fixture.wealth.generated._
import fixture.types.{FundOrderId, Money, TxId}

final class FundOrderIsolationAdapter extends FundOrderIsolationPort {

  override def encodeCommand(cmd: FundOrderCommand): Array[Byte] = cmd match {
    case ReserveFundSubscription(txid, resource, amount) =>
      // Exact minor-unit string serialization (never IEEE-754 Double)
      s"PREPARE|${txid.value}|${resource.value}|${amount.currency}:${amount.minorUnits}".getBytes("UTF-8")

    case ConfirmFundSubscriptionPayment(txid, resource) =>
      s"COMMIT|${txid.value}|${resource.value}".getBytes("UTF-8")

    case CancelFundSubscription(txid, resource) =>
      s"COMPENSATE|${txid.value}|${resource.value}".getBytes("UTF-8")
  }

  override def decodeReceipt(bytes: Array[Byte]): Either[String, FundOrderEvent] = {
    val parts = new String(bytes, "UTF-8").split("\\|")
    parts.headOption match {
      case Some("PREPARED") if parts.length == 4 =>
        Right(ReserveFundSubscriptionConfirmed(TxId(parts(1)), Money.fromMinorUnitString(parts(2), parts(3))))
      case Some("COMMITTED") if parts.length == 2 =>
        Right(FundSubscriptionPaymentConfirmed(TxId(parts(1))))
      case Some("COMPENSATED") if parts.length == 2 =>
        Right(FundSubscriptionCanceled(TxId(parts(1))))
      case other =>
        Left(s"Unrecognized durable receipt frame: $other")
    }
  }
}
