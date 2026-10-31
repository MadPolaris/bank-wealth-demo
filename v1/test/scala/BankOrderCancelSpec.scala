import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.persistence.testkit.PersistenceTestKitPlugin
import akka.persistence.testkit.scaladsl.PersistenceTestKit
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.StableOrderIdentity
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import org.scalatest.funsuite.AnyFunSuite

final class BankOrderCancelSpec extends AnyFunSuite {
  test("PAY-cancel-before-prepare: original order cancellation survives same-PID recovery and fences late order Prepare") {
    val kit = ActorTestKit(ConfigFactory.parseString("akka.actor.provider = local")
      .withFallback(PersistenceTestKitPlugin.config).withFallback(ConfigFactory.load()))
    try {
      val journal = PersistenceTestKit(kit.system)
      val id = FundOrderId("cancel-order")
      val operation = OperationId("cancel-operation")
      val tx = TxId("cancel-transaction")
      val amount = Money(BigDecimal("100.00"), "CNY")
      def spawn() = kit.spawn(FundOrderAggregate("order-cancel-pid", FundOrderState.empty.copy(id = id), StableOrderIdentity,
        new FundOrderAggregate.ExternalAuthority {
          def authorize(producer: String, authorization: String, identity: Vector[String]): Boolean = false
        }))
      var actor = spawn()
      val replies = kit.createTestProbe[FundOrderAggregate.Reply]()
      val states = kit.createTestProbe[FundOrderState]()
      def send(c: FundOrderProtocol.Command): FundOrderAggregate.Reply = {
        actor ! FundOrderAggregate.Execute(c, replies.ref)
        replies.receiveMessage()
      }
      def state(): FundOrderState = { actor ! FundOrderAggregate.GetState(states.ref); states.receiveMessage() }
      assert(send(FundOrderProtocol.RequestFundPurchaseSettlement(operation, id, AccountId("investor"), AccountId("collection"), "fund", amount)).isInstanceOf[FundOrderAggregate.Accepted])
      assert(send(FundOrderProtocol.CancelCashFundSubscription(tx, id, amount)).isInstanceOf[FundOrderAggregate.Accepted])
      val retained = state()
      val before = journal.persistedInStorage("order-cancel-pid")
      assert(before.count(_.isInstanceOf[FundOrderCashFundSubscriptionCanceledPB]) == 1)
      kit.stop(actor); actor = spawn()
      assert(state() == retained)
      assert(send(FundOrderProtocol.ReserveFundSubscription(tx, id, amount)).isInstanceOf[FundOrderAggregate.Accepted])
      assert(journal.persistedInStorage("order-cancel-pid") == before)
      assert(!before.exists(_.isInstanceOf[FundOrderReserveFundSubscriptionConfirmedPB]))
      assert(state().operationId == operation && state().compensatedSubscriptions.get(tx).contains(amount))
      assert(state().reservedSubscriptions.isEmpty && state().committedSubscriptions.isEmpty)
    } finally kit.shutdownTestKit()
  }
}
