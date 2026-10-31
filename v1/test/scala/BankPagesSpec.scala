package example.bankwealth.service

import akka.stream.Materializer
import example.bankwealth.domain.values._
import example.bankwealth.integration.BankServiceJson
import example.bankwealth.readside.BankReadsideSchema
import example.bankwealth.service.BankServiceService._
import example.bankwealth.web.{BankPageRenderer, BankPagesController}
import org.scalatest.funsuite.AnyFunSuite
import play.api.libs.json._
import play.api.mvc._
import scala.concurrent.ExecutionContext

final class BankPagesSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  import BankOwnerATestSupport._

  private def html(result: Result)(implicit materializer: Materializer): String = await(result.body.consumeData).utf8String
  private val cashBody = Json.obj("clientRequestId" -> "request", "fundCode" -> "fund",
    "amount" -> Json.obj("minorUnits" -> "10000", "currency" -> "CNY"))
  private def customerHeaders(f: Fixture): Vector[(String, String)] = Vector("Authorization" -> "Bearer alice-token",
    "Origin" -> f.config.origin, "X-CSRF-Token" -> "alice-csrf")
  private def operatorHeaders(f: Fixture): Vector[(String, String)] = Vector("Authorization" -> "Bearer operator-token",
    "Origin" -> f.config.origin, "X-CSRF-Token" -> "operator-csrf")

  test("renderer escapes titles, every object key and nested scalar without script or attribute interpolation") {
    val attack = "</title><script>alert(1)</script><img src=x onerror=alert(2)>&\"'"
    val content = BankPageRenderer.render(attack, Json.obj(attack -> Json.arr(Json.obj("nested" -> attack), attack, JsNull, true, 7)))
    assert(content.startsWith("<!doctype html>"))
    assert(content.contains(BankPageRenderer.escape(attack)))
    assert(!content.contains(attack) && !content.contains("<script") && !content.contains("<img"))
    assert(content.contains("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;"))
    assert(content.contains("&amp;&quot;&#39;"))
    assert(BankPageRenderer.escape("A&B <C> \"D\" 'E'") == "A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;")
    assert(BankPageRenderer.escape("&lt;already&gt;") == "&amp;lt;already&amp;gt;", "pre-escaped input is still data")
  }

  test("all page GETs use the same typed queries and cannot dispatch cash, SIP, recovery or journal work") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val services = new Services
      val controller = new BankPagesController(components, f.authority, f.config, queries, services, services, services)
      val actions = Vector(
        (controller.accountMe, "account", "alice-token"),
        (controller.cashOriginal("request"), "cash", "alice-token"),
        (controller.order("order"), "order", "alice-token"),
        (controller.plans, "plans", "alice-token"),
        (controller.plan("plan"), "plan", "alice-token"),
        (controller.occurrences("plan"), "occurrences", "alice-token"),
        (controller.pending, "pending", "operator-token"))
      val beforeConnections = f.dataSource.connections.get()
      val beforeJournal = f.journal.reads.get()
      actions.foreach { case (action, name, token) =>
        queries.calls.clear()
        assert(await(action(request())).header.status == 401)
        assert(queries.calls.isEmpty && services.calls.isEmpty)
        val result = await(action(request(headers = Vector("Authorization" -> ("Bearer " + token)))))
        assert(result.header.status == 200)
        assert(result.body.contentType.contains("text/html; charset=utf-8"))
        assert(result.header.headers.get("Cache-Control").contains("no-store"))
        assert(result.header.headers.get("X-Content-Type-Options").contains("nosniff"))
        assert(result.header.headers.get("Content-Security-Policy").exists(_.contains("frame-ancestors 'none'")))
        assert(queries.calls.size == 1 && queries.calls.head._1 == name && services.calls.isEmpty)
      }
      assert(f.dataSource.connections.get() == beforeConnections && f.journal.reads.get() == beforeJournal)
    }
  }

  test("page output preserves exact money, TA text and separate payment/TA/refund/unknown metadata") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      implicit val materializer: Materializer = f.materializer
      val queries = new Queries
      val services = new Services
      val controller = new BankPagesController(components, f.authority, f.config, queries, services, services, services)
      val hostilePid = "pid</dd><script>bad()</script>&\"'"
      val metadata = BankReadMetadata(BankReadsideSchema.version, "unknown",
        Vector(BankProjectionWatermark(hostilePid, 7L, None, "unknown")))
      val order = BankOrderView(FundOrderId("order"), OperationId("operation"), f.investor, f.collection, "fund",
        MoneyWire("12345678901234567890123456789012345678", "CNY"), Some(TxId("selected-payment")), "succeeded",
        Some(TaRequestId("ta-request")), "accepted", None, None, None, None, "not-required")
      queries.orderResponse = BankOrderResponse(metadata, Some(order))
      val pending = await(controller.order("order")(request(headers = Vector("Authorization" -> "Bearer alice-token"))))
      val pendingHtml = html(pending)
      assert(pending.header.status == 200 && pendingHtml.contains("12345678901234567890123456789012345678"))
      assert(pendingHtml.contains("<dt>paymentStatus</dt><dd><span>succeeded</span>"))
      assert(pendingHtml.contains("<dt>taStatus</dt><dd><span>accepted</span>"))
      assert(pendingHtml.contains("Payment success, TA acceptance and technical effect confirmation are not investment success."))
      assert(pendingHtml.contains(BankPageRenderer.escape(hostilePid)) && !pendingHtml.contains(hostilePid))
      assert(pendingHtml.contains("unknown") && !pendingHtml.contains("<script"))
      val shares = BankTaSharesView("fund", TaExactText("1.230000"), TaExactText("2.340000"))
      val sharesHtml = BankPageRenderer.render("TA details", BankServiceJson.bankTaSharesViewWrites.writes(shares))
      assert(sharesHtml.contains("1.230000") && sharesHtml.contains("2.340000"))
      queries.orderResponse = BankOrderResponse(metadata, Some(order.copy(taStatus = "rejected", refundStatus = "refund-in-progress")))
      val rejected = html(await(controller.order("order")(request(headers = Vector("Authorization" -> "Bearer alice-token")))))
      assert(rejected.contains("<dt>taStatus</dt><dd><span>rejected</span>"))
      assert(rejected.contains("<dt>refundStatus</dt><dd><span>refund-in-progress</span>"))
      assert(services.calls.isEmpty)
    }
  }

  test("page query decoding and role checks reject identity injection before query dispatch") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val services = new Services
      val controller = new BankPagesController(components, f.authority, f.config, queries, services, services, services)
      assert(await(controller.accountMe(request(query = Map("accountId" -> Seq("bob-account")), headers = customerHeaders(f)))).header.status == 400)
      assert(await(controller.plans(request(query = Map("limit" -> Seq("1", "2")), headers = customerHeaders(f)))).header.status == 400)
      assert(await(controller.pending(request(headers = customerHeaders(f)))).header.status == 403)
      assert(await(controller.accountMe(request(headers = operatorHeaders(f)))).header.status == 403)
      assert(await(controller.accountMe(request(method = "POST", headers = customerHeaders(f)))).header.status == 400)
      assert(queries.calls.isEmpty && services.calls.isEmpty)
    }
  }

  test("all seven page POSTs require authentication, exact Origin and CSRF before invoking existing business ports") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val services = new Services
      val controller = new BankPagesController(components, f.authority, f.config, queries, services, services, services)
      val cases = Vector(
        (controller.submitCash, cashBody, "submit", false),
        (controller.createPlan, cashBody ++ Json.obj("effectiveSlot" -> 0, "dueSlots" -> Json.arr(10, 20)), "create", false),
        (controller.revisePlan("plan"), Json.obj("revision" -> "revision-2", "effectiveSlot" -> 20, "fundCode" -> "fund",
          "amount" -> Json.obj("minorUnits" -> "10000", "currency" -> "CNY")), "revise", false),
        (controller.pausePlan("plan"), Json.obj(), "pause", false),
        (controller.resumePlan("plan"), Json.obj(), "resume", false),
        (controller.reconcile("operation"), Json.obj(), "reconcile", true),
        (controller.tick, Json.obj("slot" -> 10), "tick", true))
      cases.foreach { case (action, body, method, operatorOnly) =>
        services.calls.clear()
        val correct = if (operatorOnly) operatorHeaders(f) else customerHeaders(f)
        val wrongRole = if (operatorOnly) customerHeaders(f) else operatorHeaders(f)
        val attempts = Vector(
          Vector.empty[(String, String)] -> 401,
          correct.filterNot(_._1 == "Origin") -> 403,
          correct.filterNot(_._1 == "X-CSRF-Token") -> 403,
          (correct.filterNot(_._1 == "Origin") :+ ("Origin" -> "http://127.0.0.1:18082")) -> 403,
          (correct :+ ("X-CSRF-Token" -> "duplicate")) -> 403,
          wrongRole -> 403)
        attempts.foreach { case (headers, status) =>
          assert(await(action(request(method = "POST", headers = headers, body = AnyContentAsJson(body)))).header.status == status)
          assert(services.calls.isEmpty && queries.calls.isEmpty)
        }
        val result = await(action(request(method = "POST", headers = correct, body = AnyContentAsJson(body))))
        assert(result.header.status == 503, "the recording port returns Unavailable, not fabricated business success")
        assert(services.calls.size == 1 && services.calls.head._1 == method)
        assert(services.calls.head._2 == (if (operatorOnly) f.operator else f.alice))
        assert(queries.calls.isEmpty)
      }
    }
  }

  test("page writes use the API's closed JSON decoder and never accept form, owner, outcome or method bypasses") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val services = new Services
      val controller = new BankPagesController(components, f.authority, f.config, queries, services, services, services)
      val injected = Vector("principalId", "investorAccountId", "roles", "forcedResult", "refundDestination", "receipt")
        .map(key => cashBody + (key -> JsString("injected")))
      val invalid = injected ++ Vector(cashBody + ("amount" -> Json.obj("minorUnits" -> 10000, "currency" -> "CNY")),
        cashBody + ("amount" -> Json.obj("minorUnits" -> "10000", "currency" -> "USD")))
      invalid.foreach { body =>
        assert(await(controller.submitCash(request(method = "POST", headers = customerHeaders(f), body = AnyContentAsJson(body)))).header.status == 400)
        assert(services.calls.isEmpty)
      }
      assert(await(controller.submitCash(request(method = "POST", query = Map("accountId" -> Seq("bob-account")),
        headers = customerHeaders(f), body = AnyContentAsJson(cashBody)))).header.status == 400)
      assert(await(controller.submitCash(request(method = "POST", headers = customerHeaders(f),
        body = AnyContentAsFormUrlEncoded(Map("clientRequestId" -> Seq("request")))))).header.status == 400)
      assert(await(controller.submitCash(request(method = "GET", headers = customerHeaders(f), body = AnyContentAsJson(cashBody)))).header.status == 400)
      assert(services.calls.isEmpty && queries.calls.isEmpty)
      assert(await(controller.submitCash(request(method = "POST", headers = customerHeaders(f), body = AnyContentAsJson(cashBody)))).header.status == 503)
      assert(services.calls.toVector == Vector(("submit", f.alice, BankCashSubmit("request", "fund", MoneyWire("10000", "CNY")))))
    }
  }

  test("unknown/empty results stay successful progress pages, while failures retain status and do not reflect request secrets") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      implicit val materializer: Materializer = f.materializer
      val queries = new Queries
      val services = new Services
      val controller = new BankPagesController(components, f.authority, f.config, queries, services, services, services)
      val unknown = await(controller.order("missing")(request(headers = customerHeaders(f))))
      assert(unknown.header.status == 200 && html(unknown).contains("unknown"))
      val denied = await(controller.submitCash(request(method = "POST", headers = Vector("Authorization" -> "Bearer secret-invalid-token"), body = AnyContentAsJson(cashBody))))
      val deniedHtml = html(denied)
      assert(denied.header.status == 401 && deniedHtml.contains(NotAuthenticated.code))
      assert(!deniedHtml.contains("secret-invalid-token") && !deniedHtml.contains("alice-csrf"))
      val unavailable = await(controller.submitCash(request(method = "POST", headers = customerHeaders(f), body = AnyContentAsJson(cashBody))))
      assert(unavailable.header.status == 503 && html(unavailable).contains(Unavailable.code))
      assert(unavailable.header.headers.get("Cache-Control").contains("no-store"))
    }
  }
}
