package example.bankwealth.service

import example.bankwealth.web.{BankBrowserPages, BankPageRenderer}
import org.scalatest.funsuite.AnyFunSuite
import play.api.libs.json._

/** Pure renderer checks; HTTP/browser integration is run separately by the owner. */
final class BankBrowserPagesSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  private final case class Form(id: String, method: String, path: String, audience: String, fields: Set[String])
  private val forms = Vector(
    Form("account-me", "GET", "/bank/v1/accounts/me", "customer", Set.empty),
    Form("cash-submit", "POST", "/bank/v1/cash-requests", "customer", Set("clientRequestId", "fundCode", "minorUnits", "currency")),
    Form("cash-original", "GET", "/bank/v1/cash-requests/:clientRequestId", "customer", Set("clientRequestId")),
    Form("order-detail", "GET", "/bank/v1/orders/:orderId", "customer", Set("orderId")),
    Form("sip-create", "POST", "/bank/v1/sip-plans", "customer", Set("clientRequestId", "fundCode", "minorUnits", "currency", "effectiveSlot", "dueSlots")),
    Form("sip-list", "GET", "/bank/v1/sip-plans", "customer", Set("limit", "after")),
    Form("sip-detail", "GET", "/bank/v1/sip-plans/:planId", "customer", Set("planId")),
    Form("sip-revise", "POST", "/bank/v1/sip-plans/:planId/revisions", "customer", Set("planId", "revision", "effectiveSlot", "fundCode", "minorUnits", "currency")),
    Form("sip-pause", "POST", "/bank/v1/sip-plans/:planId/pause", "customer", Set("planId")),
    Form("sip-resume", "POST", "/bank/v1/sip-plans/:planId/resume", "customer", Set("planId")),
    Form("sip-occurrences", "GET", "/bank/v1/sip-plans/:planId/occurrences", "customer", Set("planId", "limit", "after")),
    Form("operations-pending", "GET", "/bank/v1/operations/pending", "operator", Set("limit", "after")),
    Form("operation-reconcile", "POST", "/bank/v1/operations/:operationId/reconcile", "operator", Set("operationId")),
    Form("business-tick", "POST", "/bank/v1/business-clock/tick", "operator", Set("slot")))

  test("implements the generated optional PageRenderer with exact installed identity") {
    val renderer: BankServiceService.PageRenderer = BankBrowserPages
    assert(renderer.implementation == "example.bankwealth.web.BankBrowserPages")
    assert(renderer.version == "1")
    assert(renderer.shell == BankBrowserPages.shell && renderer.script == BankBrowserPages.script)
  }

  test("static shell declares exactly fourteen fixed forms and navigation identities with closed DTO fields") {
    val shell = BankBrowserPages.shell
    val pattern = "(?s)<form id=\"bank-form-([^\"]+)\"(.*?)</form>".r
    val actual = pattern.findAllMatchIn(shell).map(m => m.group(1) -> m.group(0)).toVector
    assert(actual.size == 14 && actual.map(_._1).distinct.size == 14)
    assert(actual.map(_._1).toSet == forms.map(_.id).toSet)
    forms.foreach { expected =>
      val html = actual.find(_._1 == expected.id).get._2
      assert(html.contains("data-endpoint=\"" + expected.id + "\""))
      assert(html.contains("data-method=\"" + expected.method + "\""))
      assert(html.contains("data-path=\"" + expected.path + "\""))
      assert(html.contains("data-audience=\"" + expected.audience + "\""))
      assert(" name=\"([^\"]+)\"".r.findAllMatchIn(html).map(_.group(1)).toSet == expected.fields)
      assert(shell.contains("id=\"bank-nav-" + expected.id + "\""))
      assert(BankBrowserPages.script.contains("\"path\":\"" + expected.path + "\""))
      assert(!html.contains("type=\"number\""), "wire integers must remain text")
    }
    assert(shell.contains("<script src=\"/bank/v1/client-script\" defer></script>"))
    assert(!shell.contains("<script>") && !shell.contains("onclick="))
    assert(shell.contains("id=\"bank-workspace\" hidden") && shell.contains("id=\"bank-login-form\""))
    val roles = "<option value=\"([^\"]+)\"".r.findAllMatchIn(shell).map(_.group(1)).toVector
    assert(roles == Vector("customer", "operator"))
    assert(!shell.contains("name=\"accountId\"") && !shell.contains("name=\"principalId\"") && !shell.contains("name=\"roles\""))
  }

  test("static assets contain no issued credentials, persistence mechanism, raw HTML insertion or inline business code") {
    val assets = BankBrowserPages.shell + BankBrowserPages.script
    Vector("alice-token", "alice-csrf", "operator-token", "operator-csrf", "localStorage", "sessionStorage",
      "document.cookie", "console.", "innerHTML", "outerHTML", "insertAdjacentHTML", "eval(").foreach { forbidden =>
      assert(!assets.contains(forbidden), forbidden)
    }
    assert(BankBrowserPages.script.contains("let session = null;"))
    assert(BankBrowserPages.script.contains("tokenInput.value = '';"))
    assert(BankBrowserPages.script.contains("csrfInput.value = '';"))
    assert(BankBrowserPages.script.contains("credentials: 'omit'"))
    assert(BankBrowserPages.script.contains("redirect: 'error'"))
    assert(BankBrowserPages.script.contains("window.addEventListener('pagehide', clearSession)"))
    assert(BankBrowserPages.script.contains("response.status === 401 || response.status === 403"))
    assert(BankBrowserPages.script.contains("response.status !== 200"))
    assert(BankBrowserPages.script.contains("role === 'customer' ? 'account-me' : 'operations-pending'"))
    assert(BankBrowserPages.script.contains("controller.signal") && BankBrowserPages.script.contains("current !== generation"))
    assert(BankBrowserPages.script.contains("querySelectorAll('form[data-endpoint]')"))
    assert(!BankBrowserPages.script.contains("querySelectorAll('[data-endpoint]')"))
  }

  test("client keeps Money and signed-Long fields exact and copies only attribute-free response structures") {
    val script = BankBrowserPages.script
    Vector("Number(", "parseInt(", "parseFloat(", "response.json(", "JSON.parse(").foreach { forbidden =>
      assert(!script.contains(forbidden), forbidden)
    }
    assert(script.contains("9223372036854775807"))
    assert(script.contains("['effectiveSlot', longField(form, 'effectiveSlot')]"))
    assert(script.contains("['slot', longField(form, 'slot')]"))
    assert(script.contains("'[' + slots.join(',') + ']'"))
    assert(script.contains("['minorUnits', JSON.stringify(minor)]"))
    assert(script.contains("['revision', stringField(form, 'revision', 128)]"))
    assert(script.contains("BigInt(after) + BigInt(limit)"))
    assert(script.contains("new DOMParser()") && script.contains("document.createTextNode(node.textContent)"))
    assert(script.contains("responseTags.has(node.tagName)") && script.contains("results.replaceChildren(fragment)"))
    assert(!script.contains("node.attributes") && !script.contains("importNode("))
  }

  test("response renderer escapes endpoint titles, every nested key and scalar, and preserves the real status label") {
    val attack = "</title><script>alert(1)</script><img src=x onerror=alert(2)>&\"'"
    val value = Json.obj(attack -> Json.arr(Json.obj("nested" -> attack), attack, JsNull, true, 7))
    Vector(200, 400, 401, 403, 409, 503).foreach { status =>
      val html = BankBrowserPages.render(attack, status, value)
      assert(html.startsWith("<!doctype html>"))
      assert(html.contains("HTTP " + status))
      assert(html.contains(BankPageRenderer.escape(attack)))
      assert(!html.contains(attack) && !html.contains("<script") && !html.contains("<img"))
      assert(html.contains("&amp;&quot;&#39;"))
    }
    val rendered = BankBrowserPages.render("cash-submit", 409, Json.obj("status" -> "succeeded", "code" -> "request-conflict"))
    assert(rendered.contains("Submit cash request (HTTP 409)") && rendered.contains("request-conflict"))
  }

  test("response pages retain independent investment statuses, exact numeric text and per-PID projection watermarks") {
    val pid = "pid</dd><script>bad()</script>&\"'"
    val exactMoney = "12345678901234567890123456789012345678"
    val value = Json.obj("metadata" -> Json.obj("progress" -> "unknown", "watermarks" -> Json.arr(
      Json.obj("persistenceId" -> pid, "journalSequenceNr" -> JsNumber(BigDecimal("9007199254740993")),
        "projectedSequenceNr" -> JsNull, "progress" -> "unknown"))),
      "order" -> Json.obj("amount" -> Json.obj("minorUnits" -> exactMoney, "currency" -> "CNY"),
        "paymentStatus" -> "succeeded", "taStatus" -> "rejected", "refundStatus" -> "refund-in-progress",
        "shares" -> "1.230000", "nav" -> "2.340000"))
    val html = BankBrowserPages.render("order-detail", 200, value)
    assert(html.contains(exactMoney) && html.contains("9007199254740993"))
    assert(html.contains("1.230000") && html.contains("2.340000"))
    assert(html.contains("<dt>paymentStatus</dt><dd><span>succeeded</span>"))
    assert(html.contains("<dt>taStatus</dt><dd><span>rejected</span>"))
    assert(html.contains("<dt>refundStatus</dt><dd><span>refund-in-progress</span>"))
    assert(html.contains("watermarks") && html.contains("projectedSequenceNr") && html.contains("unknown"))
    assert(html.contains(BankPageRenderer.escape(pid)) && !html.contains(pid))
    val disclaimer = "Payment success, TA acceptance and technical effect confirmation are not investment success."
    assert(html.contains(disclaimer) && BankBrowserPages.shell.contains(disclaimer))
    assert(html.contains("Unknown projection progress is not proof that a resource does not exist."))
  }
}
