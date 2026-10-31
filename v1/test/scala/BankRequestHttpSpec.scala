package example.bankwealth.service

import example.bankwealth.integration._
import example.bankwealth.domain.values._
import example.bankwealth.security._
import org.scalatest.funsuite.AnyFunSuite
import play.api.libs.json._
import play.api.mvc.{Headers, RequestHeader}
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

final class BankRequestHttpSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  private def envelope(body: JsValue, path: JsObject = Json.obj(), query: JsObject = Json.obj()): JsObject = Json.obj("path" -> path, "query" -> query, "body" -> body)
  test("cash DTO is closed and exact minor-unit strings cannot carry identity or authority") {
    val valid = Json.obj("clientRequestId" -> "one", "fundCode" -> "fund", "amount" -> Json.obj("minorUnits" -> "10000", "currency" -> "CNY"))
    assert(BankServiceJson.bankCashSubmitReads.reads(envelope(valid)).isSuccess)
    for (key <- Vector("principalId", "investorAccountId", "fundCollectionAccountId", "receipt", "forcedResult", "refundDestination", "roles"))
      assert(BankServiceJson.bankCashSubmitReads.reads(envelope(valid + (key -> JsString("injected")))).isError)
    for (amount <- Vector(Json.obj("minorUnits" -> 10000, "currency" -> "CNY"), Json.obj("minorUnits" -> "100.00", "currency" -> "CNY"), Json.obj("minorUnits" -> "0", "currency" -> "CNY"), Json.obj("minorUnits" -> "1", "currency" -> "USD")))
      assert(BankServiceJson.bankCashSubmitReads.reads(envelope(valid + ("amount" -> amount))).isError)
  }
  test("account queries do not accept customer identity and pages reject duplicate scalar parameters") {
    assert(BankServiceJson.bankAccountKeyReads.reads(envelope(JsNull)).isSuccess)
    assert(BankServiceJson.bankAccountKeyReads.reads(envelope(JsNull, query = Json.obj("accountId" -> Json.arr("other")))).isError)
    assert(BankServiceJson.bankPlanPageKeyReads.reads(envelope(JsNull, query = Json.obj("limit" -> Json.arr("10", "20")))).isError)
    assert(BankServiceJson.bankPlanPageKeyReads.reads(envelope(JsNull, query = Json.obj("limit" -> Json.arr("100000")))).isError)
    assert(BankServiceJson.bankPlanPageKeyReads.reads(envelope(JsNull, query = Json.obj("after" -> Json.arr("-1")))).isError)
  }
  test("typed bank endpoints install all fourteen pinned implementation bindings") {
    val method = classOf[BankReadQueries].getMethods.map(_.getName).toSet
    assert(Set("accountMe", "cashOriginal", "order", "plans", "plan", "occurrences", "pending").subsetOf(method))
    assert(BankServiceEndpoints.Version == "bank-v1-service-1")
    assert(BankServiceService.RequestConflict.status == 409)
  }
}
