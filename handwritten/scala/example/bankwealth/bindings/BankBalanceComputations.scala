package example.bankwealth.bindings

import example.bankwealth.domain.{CreditBalanceComputations, CreditBalanceProtocol, CreditBalanceState}
import example.bankwealth.domain.values.Money

object BankBalanceComputations extends CreditBalanceComputations {
  private def available(state: CreditBalanceState, currency: String): Money =
    state.accountBalance.getOrElse(currency, throw new IllegalArgumentException("initialized currency balance required"))

  def BalanceAfterReserveFunds(state: CreditBalanceState, p: CreditBalanceProtocol.ReserveFunds): Money =
    available(state, p.amount.currency).minus(p.amount)

  def BalanceAfterCommitIncomingCredits(state: CreditBalanceState, p: CreditBalanceProtocol.CommitIncomingCredits): Money =
    available(state, p.amount.currency).plus(p.amount)

  def BalanceAfterReleaseReservedFunds(state: CreditBalanceState, p: CreditBalanceProtocol.ReleaseReservedFunds): Money =
    state.reservedAmount.get(p.txid) match {
      case Some(reserved) => available(state, p.amount.currency).plus(reserved)
      case None => available(state, p.amount.currency)
    }
}
