package example.bankwealth.web

import example.bankwealth.integration._
import example.bankwealth.security.BankDemoConfiguration
import example.bankwealth.service.BankReadHttpIdentity
import example.bankwealth.service.BankServiceService._
import play.api.libs.json._
import play.api.mvc._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Explicit handwritten page routes. The generated API remains unchanged.
  * GET delegates only to BankReadQueries; POST uses the same closed JSON inputs and
  * application ports as the API. Authentication is still the generated Authority boundary.
  * The current demo authority requires Bearer authentication and X-CSRF-Token + Origin;
  * these routes do not introduce cookies, a second login mechanism, or form-only bypasses.
  */
final class BankPagesController(cc: ControllerComponents, authority: Authority,
    config: BankDemoConfiguration, queries: BankReadQueries, cash: BankCashRequestService,
    sip: BankSipApplicationService, recovery: BankRecoveryService)(implicit ec: ExecutionContext)
    extends AbstractController(cc) {
  require(authority != null && config != null && queries != null && cash != null && sip != null && recovery != null)
  import BankServiceJson._

  private def page(status: Int, title: String, value: JsValue): Result =
    Status(status)(BankPageRenderer.render(title, value)).as("text/html; charset=utf-8").withHeaders(
      "Cache-Control" -> "no-store",
      "X-Content-Type-Options" -> "nosniff",
      "Content-Security-Policy" -> "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy" -> "no-referrer")

  private def failure(error: Failure): Result = page(error.status, "Request unavailable", Json.obj("code" -> error.code))

  private def action[I, O](role: String, title: String, path: JsObject, reads: Reads[I], writes: Writes[O],
      write: Boolean)(run: (Principal, I) => Future[Outcome[O]]): Action[AnyContent] = Action.async { request =>
    BankReadHttpIdentity.authenticate(authority, config, request, role).flatMap {
      case Left(error) => Future.successful(failure(error))
      case Right(principal) =>
        // Reject a method mismatch even when an Action is called directly, outside the router.
        if (request.method != (if (write) "POST" else "GET")) Future.successful(failure(InvalidRequest))
        else {
          val admitted = if (write) authority.csrf(request) else Future.successful(true)
          admitted.flatMap {
            case false => Future.successful(failure(NotAuthorized))
            case true =>
              val body = if (write) request.body.asJson else Some(JsNull)
              body match {
                case None => Future.successful(failure(InvalidRequest))
                case Some(value) =>
                  val input = Json.obj("path" -> path, "query" -> JsObject(request.queryString.toVector.map {
                    case (key, values) => key -> JsArray(values.map(JsString.apply))
                  }), "body" -> value)
                  reads.reads(input) match {
                    case JsSuccess(inputValue, _) => run(principal, inputValue).map {
                      case Left(error) => failure(error)
                      case Right(response) => page(200, title, writes.writes(response))
                    }
                    case _ => Future.successful(failure(InvalidRequest))
                  }
              }
          }
        }
    }.recover { case NonFatal(_) => failure(Unavailable) }
  }

  def accountMe: Action[AnyContent] = action("customer", "My account", Json.obj(),
    bankAccountKeyReads, bankAccountResponseWrites, write = false)(queries.accountMe)
  def cashOriginal(clientRequestId: String): Action[AnyContent] = action("customer", "Original cash request",
    Json.obj("clientRequestId" -> clientRequestId), bankCashRequestKeyReads, bankCashRequestResponseWrites, write = false)(queries.cashOriginal)
  def order(orderId: String): Action[AnyContent] = action("customer", "Fund order", Json.obj("orderId" -> orderId),
    bankOrderKeyReads, bankOrderResponseWrites, write = false)(queries.order)
  def plans: Action[AnyContent] = action("customer", "My SIP plans", Json.obj(),
    bankPlanPageKeyReads, bankSipPlanPageWrites, write = false)(queries.plans)
  def plan(planId: String): Action[AnyContent] = action("customer", "SIP plan", Json.obj("planId" -> planId),
    bankPlanKeyReads, bankSipPlanResponseWrites, write = false)(queries.plan)
  def occurrences(planId: String): Action[AnyContent] = action("customer", "SIP installments", Json.obj("planId" -> planId),
    bankOccurrencePageKeyReads, bankSipOccurrencePageWrites, write = false)(queries.occurrences)
  def pending: Action[AnyContent] = action("operator", "Pending operations", Json.obj(),
    bankPendingPageKeyReads, bankPendingResponseWrites, write = false)(queries.pending)

  // JSON POSTs, not new business commands or client-supplied owner/phase/result fields.
  def submitCash: Action[AnyContent] = action("customer", "Cash request acknowledgement", Json.obj(),
    bankCashSubmitReads, bankCashAcknowledgementWrites, write = true)(cash.submit)
  def createPlan: Action[AnyContent] = action("customer", "SIP acknowledgement", Json.obj(),
    bankSipCreateReads, bankSipAcknowledgementWrites, write = true)(sip.create)
  def revisePlan(planId: String): Action[AnyContent] = action("customer", "SIP acknowledgement", Json.obj("planId" -> planId),
    bankSipRevisionInputReads, bankSipAcknowledgementWrites, write = true)(sip.revise)
  def pausePlan(planId: String): Action[AnyContent] = action("customer", "SIP acknowledgement", Json.obj("planId" -> planId),
    bankPlanActionReads, bankSipAcknowledgementWrites, write = true)(sip.pause)
  def resumePlan(planId: String): Action[AnyContent] = action("customer", "SIP acknowledgement", Json.obj("planId" -> planId),
    bankPlanActionReads, bankSipAcknowledgementWrites, write = true)(sip.resume)
  def reconcile(operationId: String): Action[AnyContent] = action("operator", "Recovery acknowledgement",
    Json.obj("operationId" -> operationId), bankOperationActionReads, bankRecoveryAcknowledgementWrites, write = true)(recovery.reconcileExisting)
  def tick: Action[AnyContent] = action("operator", "Business clock acknowledgement", Json.obj(),
    bankTickReads, bankTickAcknowledgementWrites, write = true)(sip.tick)
}

/** No raw HTML slot, script/JSON embedding, dynamic attributes, or external assets.
  * The recursively typed BankServiceJson encoders supply all business fields unchanged,
  * including separate payment/TA/refund statuses and per-PID projection metadata.
  */
private[bankwealth] object BankPageRenderer {
  def escape(value: String): String = value.flatMap {
    case '&' => "&amp;"
    case '<' => "&lt;"
    case '>' => "&gt;"
    case '"' => "&quot;"
    case '\'' => "&#39;"
    case c => c.toString
  }

  private def fields(value: JsValue): String = value match {
    case obj: JsObject => obj.fields.map { case (key, item) =>
      "<dt>" + escape(key) + "</dt><dd>" + fields(item) + "</dd>"
    }.mkString("<dl>", "", "</dl>")
    case JsArray(items) => items.map(item => "<li>" + fields(item) + "</li>").mkString("<ul>", "", "</ul>")
    case JsString(text) => "<span>" + escape(text) + "</span>"
    case JsNull => "<span>none</span>"
    case scalar => "<span>" + escape(Json.stringify(scalar)) + "</span>"
  }

  def render(title: String, response: JsValue): String = {
    val safeTitle = escape(title)
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + safeTitle +
      "</title><style>body{font-family:system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem}" +
      "dt{font-weight:600}dd{margin-bottom:.6rem;overflow-wrap:anywhere}dl dl{border-left:2px solid #ddd;padding-left:1rem}" +
      "aside{padding:1rem;background:#f3f5f7}</style></head><body><main><h1>" + safeTitle +
      "</h1><aside>Payment success, TA acceptance and technical effect confirmation are not investment success. " +
      "Only a correlated TA confirmation confirms the investment. A TA rejection without a completed refund remains refund in progress. " +
      "Unknown projection progress is not proof that a resource does not exist.</aside>" + fields(response) +
      "</main></body></html>"
  }
}
