// ═══════════════════════════════════════════════════════════════════════════
// DO NOT EDIT: Generated from compiled/saga-ir.json & tree/aggregates/fund-order
// Definition Digest: bc773fd698f998e0210ac239e6d06eb9a414da49820fc3a876c9e5ecc995f292
// ═══════════════════════════════════════════════════════════════════════════
package fixture.wealth.generated

import fixture.types.{AccountId, FundOrderId, FundShare, Money, OperationId, TxId}

sealed trait FundOrderCommand
final case class ReserveFundSubscription(txid: TxId, resource: FundOrderId, amount: Money) extends FundOrderCommand
final case class ConfirmFundSubscriptionPayment(txid: TxId, resource: FundOrderId) extends FundOrderCommand
final case class CancelFundSubscription(txid: TxId, resource: FundOrderId) extends FundOrderCommand

sealed trait FundOrderEvent
final case class ReserveFundSubscriptionConfirmed(txid: TxId, amount: Money) extends FundOrderEvent
final case class FundSubscriptionPaymentConfirmed(txid: TxId) extends FundOrderEvent
final case class FundSubscriptionCanceled(txid: TxId) extends FundOrderEvent

/**
 * Generated Pure Guard & State Fold Kernel.
 * All business invariants (IR-FO-RESERVE-001, IR-FO-RESERVE-002, IR-FO-COMMIT-001, IR-FO-CANCEL-001)
 * are compiled directly from truthsrc slices. Adapters MUST NOT add ad-hoc business state mutations.
 */
trait FundOrderIsolationPort {
  def encodeCommand(cmd: FundOrderCommand): Array[Byte]
  def decodeReceipt(bytes: Array[Byte]): Either[String, FundOrderEvent]
}
