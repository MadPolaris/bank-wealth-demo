package example.bankwealth.service {
  import example.bankwealth.security.BankDemoConfiguration
  import example.bankwealth.service.BankServiceService._
  import play.api.mvc.RequestHeader
  import scala.concurrent.{ExecutionContext, Future}

  /** Implementation-local adapter for additional handwritten routes. Principal construction
    * remains in the generated service package and ALWAYS follows the shared Authority.
    */
  private[bankwealth] object BankReadHttpIdentity {
    def authenticate(authority: Authority, config: BankDemoConfiguration, request: RequestHeader,
        role: String)(implicit ec: ExecutionContext): Future[Outcome[Principal]] =
      authority.authenticate(request).map {
        case None => Left(NotAuthenticated)
        case Some((id, roles)) if id != null && id.nonEmpty && roles != null && roles.contains(role) =>
          val principal = Principal(id, roles)
          val configured = if (role == "customer") config.customer(principal).isDefined else config.operator(principal)
          if (configured) Right(principal) else Left(NotAuthorized)
        case _ => Left(NotAuthorized)
      }
  }
}

package example.bankwealth.web {
  import example.bankwealth.integration.{BankReadQueries, BankServiceJson}
  import example.bankwealth.security.BankDemoConfiguration
  import example.bankwealth.service.{BankReadHttpIdentity, BankServiceService}
  import example.bankwealth.service.BankServiceService._
  import play.api.libs.json._
  import play.api.mvc._
  import scala.concurrent.{ExecutionContext, Future}
  import scala.util.control.NonFatal

  /** Optional explicit Play query routes; the generated API already uses these same ports.
    * GET is deliberately only an authorized JDBC query: no catch-up, actor ensure, or start.
    */
  final class BankQueryController(cc: ControllerComponents, authority: Authority,
      config: BankDemoConfiguration, queries: BankReadQueries)(implicit ec: ExecutionContext)
      extends AbstractController(cc) {
    import BankServiceJson._

    private def failure(error: Failure): Result = Status(error.status)(Json.obj("code" -> error.code))
    private def get[I, O](role: String, path: JsObject, reads: Reads[I], writes: Writes[O])
        (run: (Principal, I) => Future[Outcome[O]]): Action[AnyContent] = Action.async { request =>
      BankReadHttpIdentity.authenticate(authority, config, request, role).flatMap {
        case Left(error) => Future.successful(failure(error))
        case Right(principal) =>
          val input = Json.obj("path" -> path, "query" -> JsObject(request.queryString.toVector.map {
            case (key, values) => key -> JsArray(values.map(JsString.apply))
          }), "body" -> JsNull)
          reads.reads(input) match {
            case JsSuccess(value, _) => run(principal, value).map {
              case Left(error) => failure(error)
              case Right(response) => Ok(writes.writes(response)).withHeaders("Cache-Control" -> "no-store")
            }
            case _ => Future.successful(failure(InvalidRequest))
          }
      }.recover { case NonFatal(_) => failure(Unavailable) }
    }

    def accountMe: Action[AnyContent] = get("customer", Json.obj(), bankAccountKeyReads, bankAccountResponseWrites)(queries.accountMe)
    def cashOriginal(clientRequestId: String): Action[AnyContent] =
      get("customer", Json.obj("clientRequestId" -> clientRequestId), bankCashRequestKeyReads, bankCashRequestResponseWrites)(queries.cashOriginal)
    def order(orderId: String): Action[AnyContent] =
      get("customer", Json.obj("orderId" -> orderId), bankOrderKeyReads, bankOrderResponseWrites)(queries.order)
    def plans: Action[AnyContent] = get("customer", Json.obj(), bankPlanPageKeyReads, bankSipPlanPageWrites)(queries.plans)
    def plan(planId: String): Action[AnyContent] =
      get("customer", Json.obj("planId" -> planId), bankPlanKeyReads, bankSipPlanResponseWrites)(queries.plan)
    def occurrences(planId: String): Action[AnyContent] =
      get("customer", Json.obj("planId" -> planId), bankOccurrencePageKeyReads, bankSipOccurrencePageWrites)(queries.occurrences)
    def pending: Action[AnyContent] = get("operator", Json.obj(), bankPendingPageKeyReads, bankPendingResponseWrites)(queries.pending)
  }
}
