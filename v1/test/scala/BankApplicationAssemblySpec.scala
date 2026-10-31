import akka.actor.typed.ActorSystem
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.{StableOrderIdentity, StableSipIdentity}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.integration._
import example.bankwealth.security._
import example.bankwealth.service.UnitConfigurationCheck
import org.scalatest.funsuite.AnyFunSuite
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

final class BankApplicationAssemblySpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  private val investor = AccountId("investor")
  private val collection = AccountId("collection")
  private val config = BankDemoConfiguration("demo-v1", "http://127.0.0.1:18081", Vector(
    BankDemoPrincipal("alice", investor, Set("customer"), "test-token", "test-csrf")), Vector(BankFund("fund", collection)),
    Vector(BankSeed(investor, "CNY", Money(BigDecimal("1000.00"), "CNY")), BankSeed(collection, "CNY", Money(BigDecimal("0.00"), "CNY"))))
  private val admission = new BankTrustedAdmission(config)
  private def original(key: String): BankCashOriginal = BankCashOriginal("alice", key, config.version,
    BankCashSubmit(key, "fund", MoneyWire("10000", "CNY")),
    BankPaymentOriginal(BankRequestIdentity.operation("alice", key), BankRequestIdentity.order("alice", key), investor, collection, "fund", Money(BigDecimal("100.00"), "CNY")))
  private def intent(key: String): BankSipCreateIntent = BankSipCreateIntent("alice", key, config.version,
    BankSipCreate(key, "fund", MoneyWire("10000", "CNY"), 0L, Vector(10L, 20L)), BankRequestIdentity.plan("alice", key),
    SipRevisionConfig(RevisionId("initial"), 0L, investor, collection, "fund", Money(BigDecimal("100.00"), "CNY")))

  test("trusted admission rejects wire mismatch and non-increasing full schedules") {
    val cash = original("cash")
    admission.validateCash(cash)
    intercept[IllegalArgumentException](admission.validateCash(cash.copy(request = cash.request.copy(amount = MoneyWire("20000", "CNY")))))
    val sip = intent("plan")
    admission.validateSip(sip)
    for (slots <- Vector(Vector.empty[Long], Vector(20L, 10L), Vector(10L, 10L), Vector(-1L, 10L))) {
      intercept[IllegalArgumentException](admission.validateSip(sip.copy(request = sip.request.copy(dueSlots = slots))))
    }
    intercept[IllegalArgumentException](admission.validateSip(sip.copy(request = sip.request.copy(amount = MoneyWire("9999", "CNY")))))
  }

  test("generated order persists the full source before payment and rejects conflicting replay after recovery") {
    val kit = ActorTestKit(ConfigFactory.load())
    implicit val system: ActorSystem[_] = kit.system
    implicit val timeout: Timeout = Timeout(3.seconds)
    def await[A](f: Future[A]): A = Await.result(f, 5.seconds)
    val o = original("source")
    admission.validateCash(o)
    def behavior = FundOrderAggregate("source/order", FundOrderState.empty.copy(id = o.payment.fundOrderId), StableOrderIdentity,
      new FundOrderAggregate.ExternalAuthority { def authorize(p: String, a: String, i: Vector[String]): Boolean = false })
    try {
      var actor = kit.spawn(behavior)
      def send(c: FundOrderProtocol.Command) = await(actor.ask[FundOrderAggregate.Reply](r => FundOrderAggregate.Execute(c, r)))
      assert(send(FundOrderProtocol.RecordCashRequestSource(o, Some(o))).isInstanceOf[FundOrderAggregate.Accepted])
      assert(await(actor.ask[FundOrderState](FundOrderAggregate.GetState)).status == "new")
      kit.stop(actor); actor = kit.spawn(behavior)
      val state = await(actor.ask[FundOrderState](FundOrderAggregate.GetState))
      assert(state.cashRequestSource.contains(o))
      assert(send(FundOrderProtocol.RecordCashRequestSource(o, Some(o))) == FundOrderAggregate.Accepted(Vector.empty))
      val changed = o.copy(request = o.request.copy(amount = MoneyWire("20000", "CNY")))
      assert(send(FundOrderProtocol.RecordCashRequestSource(changed, Some(changed))).isInstanceOf[FundOrderAggregate.Refused])
      val p = o.payment
      assert(send(FundOrderProtocol.RequestFundPurchaseSettlement(p.operationId, p.fundOrderId, p.investorAccountId, p.fundCollectionAccountId, p.fundCode, Money(BigDecimal("99.00"), "CNY"))).isInstanceOf[FundOrderAggregate.Refused])
      assert(send(FundOrderProtocol.RequestFundPurchaseSettlement(p.operationId, p.fundOrderId, p.investorAccountId, p.fundCollectionAccountId, p.fundCode, p.amount)).isInstanceOf[FundOrderAggregate.Accepted])
    } finally kit.shutdownTestKit()
  }

  test("generated SIP retains the full schedule across partial append and seals only complete intent") {
    val kit = ActorTestKit(ConfigFactory.load())
    implicit val system: ActorSystem[_] = kit.system
    implicit val timeout: Timeout = Timeout(3.seconds)
    def await[A](f: Future[A]): A = Await.result(f, 5.seconds)
    val i = intent("schedule")
    admission.validateSip(i)
    def behavior = SipPlanAggregate("source/plan", SipPlanState.empty.copy(id = i.planId), StableSipIdentity)
    try {
      var actor = kit.spawn(behavior)
      def send(c: SipPlanProtocol.Command) = await(actor.ask[SipPlanAggregate.Reply](r => SipPlanAggregate.Execute(c, r)))
      assert(send(SipPlanProtocol.RecordSipCreateIntent(i, Some(i))).isInstanceOf[SipPlanAggregate.Accepted])
      assert(send(SipPlanProtocol.CreateSipPlan(i.planId, i.config)).isInstanceOf[SipPlanAggregate.Accepted])
      assert(send(SipPlanProtocol.AppendSipDueSlot(0L, 10L)).isInstanceOf[SipPlanAggregate.Accepted])
      assert(send(SipPlanProtocol.SealSipSchedule()).isInstanceOf[SipPlanAggregate.Refused])
      kit.stop(actor); actor = kit.spawn(behavior)
      assert(await(actor.ask[SipPlanState](SipPlanAggregate.GetState)).createIntent.contains(i))
      assert(send(SipPlanProtocol.RecordSipCreateIntent(i, Some(i))) == SipPlanAggregate.Accepted(Vector.empty))
      assert(send(SipPlanProtocol.AppendSipDueSlot(1L, 99L)).isInstanceOf[SipPlanAggregate.Refused])
      assert(send(SipPlanProtocol.AppendSipDueSlot(1L, 20L)).isInstanceOf[SipPlanAggregate.Accepted])
      assert(send(SipPlanProtocol.SealSipSchedule()).isInstanceOf[SipPlanAggregate.Accepted])
      val changed = i.copy(request = i.request.copy(dueSlots = Vector(10L, 30L)))
      assert(send(SipPlanProtocol.RecordSipCreateIntent(changed, Some(changed))).isInstanceOf[SipPlanAggregate.Refused])
    } finally kit.shutdownTestKit()
  }
}
