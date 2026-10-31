import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.BankBalanceComputations
import example.bankwealth.domain._
import example.bankwealth.domain.CreditBalanceProtocol._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.infrastructure.proto.{AmountDecimalPB, MoneyPB}
import org.scalatest.funsuite.AnyFunSuite

// Real aggregate phase tests, not a substitute for the still-pending Saga/Monarch joint.
final class BankBalanceStateSpec extends AnyFunSuite {
  private val money = Money(BigDecimal("100.00"), "CNY")
  test("actual debit and credit actors conserve principal through payment and independent refund phases") {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    try {
      val journal = PersistenceTestKit(kit.system)
      val investorId = AccountId("investor")
      val collectionId = AccountId("collection")
      var investor = kit.spawn(CreditBalanceAggregateFactory.create("balance-investor", CreditBalanceState.empty.copy(id = investorId), BankBalanceComputations))
      val collection = kit.spawn(CreditBalanceAggregateFactory.create("balance-collection", CreditBalanceState.empty.copy(id = collectionId), BankBalanceComputations))
      val replies = kit.createTestProbe[CreditBalanceAggregate.Reply]()
      val states = kit.createTestProbe[CreditBalanceState]()
      def send(actor: akka.actor.typed.ActorRef[CreditBalanceAggregate.Request], command: Command): CreditBalanceAggregate.Reply = {
        actor ! CreditBalanceAggregate.Execute(command, replies.ref); replies.receiveMessage()
      }
      def accepted(actor: akka.actor.typed.ActorRef[CreditBalanceAggregate.Request], command: Command): Vector[Event] = send(actor, command) match {
        case CreditBalanceAggregate.Accepted(events) => events
        case other => fail(command + " -> " + other)
      }
      def state(actor: akka.actor.typed.ActorRef[CreditBalanceAggregate.Request]): CreditBalanceState = {
        actor ! CreditBalanceAggregate.GetState(states.ref); states.receiveMessage()
      }
      accepted(investor, InitializeAccount(investorId, "CNY", Money(BigDecimal("1000.00"), "CNY")))
      accepted(collection, InitializeAccount(collectionId, "CNY", Money(BigDecimal("0.00"), "CNY")))
      val canceled = TxId("cancel-before-prepare")
      accepted(investor, ReleaseReservedFunds(canceled, investorId, money))
      assert(state(investor).accountBalance("CNY").amount == BigDecimal("1000.00"))
      assert(accepted(investor, ReserveFunds(canceled, investorId, money)).isEmpty)
      val payment = TxId("payment")
      accepted(investor, ReserveFunds(payment, investorId, money))
      assert(accepted(investor, ReserveFunds(payment, investorId, money)).isEmpty)
      assert(send(investor, ReserveFunds(payment, investorId, Money(BigDecimal("101.00"), "CNY"))) == CreditBalanceAggregate.Refused("LEDGER_RESERVEDAMOUNT_MATCH"))
      assert(send(investor, ReserveFunds(TxId("wrong"), collectionId, money)) == CreditBalanceAggregate.Refused("LEDGER_RESOURCE"))
      accepted(collection, RecordIncomingCredits(payment, collectionId, money))
      accepted(investor, DeductFunds(payment, investorId, money))
      accepted(collection, CommitIncomingCredits(payment, collectionId, money))
      assert(state(investor).accountBalance("CNY").amount == BigDecimal("900.00"))
      assert(state(collection).accountBalance("CNY").amount == BigDecimal("100.00"))
      val count = journal.persistedInStorage("balance-investor").size
      kit.stop(investor)
      investor = kit.spawn(CreditBalanceAggregateFactory.create("balance-investor", CreditBalanceState.empty.copy(id = investorId), BankBalanceComputations))
      assert(accepted(investor, DeductFunds(payment, investorId, money)).isEmpty)
      assert(journal.persistedInStorage("balance-investor").size == count)
      val refund = TxId("independent-refund")
      accepted(collection, ReserveFunds(refund, collectionId, money))
      accepted(investor, RecordIncomingCredits(refund, investorId, money))
      accepted(collection, DeductFunds(refund, collectionId, money))
      accepted(investor, CommitIncomingCredits(refund, investorId, money))
      assert(state(investor).accountBalance("CNY").amount == BigDecimal("1000.00"))
      assert(state(collection).accountBalance("CNY").amount == BigDecimal("0.00"))
      assert(state(investor).committedOutgoing.keySet == Set(payment))
      assert(state(investor).committedIncoming.keySet == Set(refund))
    } finally kit.shutdownTestKit()
  }

  test("Money and AmountDecimal preserve all 38 digits through real wire PO and protobuf boundaries") {
    val major = "999999999999999999999999999999999999.99"
    val minor = "99999999999999999999999999999999999999"
    val amount = new scala.math.BigDecimal(new java.math.BigDecimal(major), java.math.MathContext.UNLIMITED)
    val value = Money(amount, "CNY")
    assert(DomainConverters.MoneyToWire(value).minorUnits == minor)
    assert(DomainConverters.MoneyToPO(value).minorUnits == minor)
    assert(DomainConverters.MoneyFromWire(MoneyWire(minor, "CNY")).amount.bigDecimal.toPlainString == major)
    assert(DomainConverters.MoneyFromPO(MoneyPO(minor, "CNY")).amount.bigDecimal.toPlainString == major)
    assert(DomainConverters.decodeMoneyPB(MoneyPB.parseFrom(DomainConverters.encodeMoneyPB(value).toByteArray)) == value)
    val decimal = AmountDecimal(amount)
    assert(DomainConverters.AmountDecimalToWire(decimal).value == minor)
    assert(DomainConverters.AmountDecimalFromPO(AmountDecimalPO(minor)).value.bigDecimal.toPlainString == major)
    assert(DomainConverters.decodeAmountDecimalPB(AmountDecimalPB.parseFrom(DomainConverters.encodeAmountDecimalPB(decimal).toByteArray)) == decimal)
    intercept[IllegalArgumentException](value.plus(Money(BigDecimal("0.01"), "CNY")))
    intercept[ArithmeticException](Money(BigDecimal("0.001"), "CNY"))
    intercept[IllegalArgumentException](Money(BigDecimal("1.00"), "USD"))
    for (bad <- Vector("01", "-0", "1.0", "1e2", "100000000000000000000000000000000000000")) {
      intercept[IllegalArgumentException](DomainConverters.MoneyFromWire(MoneyWire(bad, "CNY")))
    }
  }
}
