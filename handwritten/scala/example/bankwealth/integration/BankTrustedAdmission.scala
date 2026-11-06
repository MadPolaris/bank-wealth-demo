package example.bankwealth.integration

import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.security.BankDemoConfiguration
import example.bankwealth.service.BankServiceService._
import scala.util.control.NonFatal

final class BankTrustedAdmission(config: BankDemoConfiguration) {
  def cash(principal: Principal, request: BankCashSubmit): Outcome[BankCashOriginal] = {
    config.customer(principal) match {
      case None => Left(NotAuthorized)
      case Some(customer) => config.fund(request.fundCode) match {
        case None => Left(InvalidRequest)
        case Some(fund) => checked {
          val amount = DomainConverters.MoneyFromWire(request.amount)
          require(amount.currency == "CNY" && amount.amount > 0 && customer.accountId != fund.collectionAccountId)
          val original = BankCashOriginal(customer.id, request.clientRequestId, config.version, request,
            BankPaymentOriginal(BankRequestIdentity.operation(customer.id, request.clientRequestId),
              BankRequestIdentity.order(customer.id, request.clientRequestId), customer.accountId, fund.collectionAccountId, request.fundCode, amount))
          validateCash(original)
          original
        }
      }
    }
  }
  def sip(principal: Principal, request: BankSipCreate): Outcome[BankSipCreateIntent] = {
    config.customer(principal) match {
      case None => Left(NotAuthorized)
      case Some(customer) => config.fund(request.fundCode) match {
        case None => Left(InvalidRequest)
        case Some(fund) => checked {
          val amount = DomainConverters.MoneyFromWire(request.amount)
          val planId = BankRequestIdentity.plan(customer.id, request.clientRequestId)
          val intent = BankSipCreateIntent(customer.id, request.clientRequestId, config.version, request, planId,
            SipRevisionConfig(RevisionId("initial"), request.effectiveSlot, customer.accountId, fund.collectionAccountId, request.fundCode, amount))
          validateSip(intent)
          intent
        }
      }
    }
  }
  def validateCash(original: BankCashOriginal): Unit = {
    require(original != null && original.request != null && original.payment != null)
    require(original.authorityVersion == config.version && original.clientRequestId == original.request.clientRequestId)
    val customer = config.principals.find(p => p.id == original.principalId && p.roles.contains("customer")).get
    val fund = config.fund(original.request.fundCode).get
    val payment = original.payment
    require(payment.operationId == BankRequestIdentity.operation(customer.id, original.clientRequestId) && payment.fundOrderId == BankRequestIdentity.order(customer.id, original.clientRequestId))
    require(payment.investorAccountId == customer.accountId && payment.fundCollectionAccountId == fund.collectionAccountId && payment.investorAccountId != payment.fundCollectionAccountId)
    require(payment.fundCode == original.request.fundCode && payment.amount == DomainConverters.MoneyFromWire(original.request.amount))
    require(payment.amount.currency == "CNY" && payment.amount.amount > 0)
  }
  def validateSip(intent: BankSipCreateIntent): Unit = {
    require(intent != null && intent.request != null && intent.config != null)
    require(intent.authorityVersion == config.version && intent.clientRequestId == intent.request.clientRequestId)
    val customer = config.principals.find(p => p.id == intent.principalId && p.roles.contains("customer")).get
    val fund = config.fund(intent.request.fundCode).get
    require(intent.planId == BankRequestIdentity.plan(customer.id, intent.clientRequestId))
    require(intent.config.investorAccountId == customer.accountId && intent.config.fundCollectionAccountId == fund.collectionAccountId && customer.accountId != fund.collectionAccountId)
    require(intent.config.fundCode == intent.request.fundCode && intent.config.amount == DomainConverters.MoneyFromWire(intent.request.amount))
    require(intent.config.amount.currency == "CNY" && intent.config.amount.amount > 0 && intent.config.effectiveSlot == intent.request.effectiveSlot && intent.config.revision == RevisionId("initial"))
    val due = intent.request.dueSlots
    require(due != null && due.nonEmpty && due.size <= 1024 && intent.request.effectiveSlot >= 0)
    require(due.forall(_ >= intent.request.effectiveSlot) && due.sliding(2).forall(pair => pair.size < 2 || pair.head < pair.last), "finite strictly increasing complete schedule required")
  }
  private def checked[A](body: => A): Outcome[A] = try Right(body) catch { case NonFatal(_) => Left(InvalidRequest) }
}
