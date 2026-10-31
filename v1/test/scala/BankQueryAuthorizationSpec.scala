package example.bankwealth.service

import akka.stream.Materializer
import example.bankwealth.domain.values._
import example.bankwealth.integration._
import example.bankwealth.readside.BankReadsideSchema
import example.bankwealth.service.BankServiceService._
import example.bankwealth.web.BankQueryController
import org.scalatest.funsuite.AnyFunSuite
import play.api.libs.json._
import play.api.mvc._
import scala.concurrent.{ExecutionContext, Future}

final class BankQueryAuthorizationSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  import BankOwnerATestSupport._

  private def json(result: Result)(implicit materializer: Materializer): JsValue =
    Json.parse(await(result.body.consumeData).utf8String)

  test("all seven query actions authenticate before input decoding and port dispatch") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val controller = new BankQueryController(components, f.authority, f.config, queries)
      val actions = Vector(controller.accountMe, controller.cashOriginal("bad id"), controller.order("bad id"),
        controller.plans, controller.plan("bad id"), controller.occurrences("bad id"), controller.pending)
      val beforeConnections = f.dataSource.connections.get()
      val beforeReads = f.journal.reads.get()
      actions.foreach { action =>
        assert(await(action(request(query = Map("unexpected" -> Seq("value"))))).header.status == 401)
        assert(queries.calls.isEmpty)
      }
      assert(f.dataSource.connections.get() == beforeConnections && f.journal.reads.get() == beforeReads)
    }
  }

  test("the configured customer/operator split is enforced and a GET needs neither Origin nor CSRF") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val controller = new BankQueryController(components, f.authority, f.config, queries)
      val customers = Vector(controller.accountMe, controller.cashOriginal("request"), controller.order("order"),
        controller.plans, controller.plan("plan"), controller.occurrences("plan"))
      customers.foreach { action =>
        queries.calls.clear()
        assert(await(action(request(headers = Vector("Authorization" -> "Bearer operator-token")))).header.status == 403)
        assert(queries.calls.isEmpty)
        assert(await(action(request(headers = Vector("Authorization" -> "Bearer alice-token")))).header.status == 200)
        assert(queries.calls.size == 1 && queries.calls.head._2 == f.alice)
      }
      queries.calls.clear()
      assert(await(controller.pending(request(headers = Vector("Authorization" -> "Bearer alice-token")))).header.status == 403)
      assert(queries.calls.isEmpty)
      assert(await(controller.pending(request(headers = Vector("Authorization" -> "Bearer operator-token")))).header.status == 200)
      assert(queries.calls.toVector == Vector(("pending", f.operator, BankPendingPageKey(50L, 0L))))
      assert(f.journal.reads.get() == 0)
    }
  }

  test("unknown or role-forged authority identities fail closed before any query") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      for ((id, roles) <- Vector("unknown" -> Set("customer"), "alice" -> Set("customer", "operator"), "operator" -> Set("customer"))) {
        val authority = new Authority {
          def authenticate(header: RequestHeader): Future[Option[(String, Set[String])]] = Future.successful(Some(id -> roles))
          def csrf(header: RequestHeader): Future[Boolean] = Future.successful(true)
        }
        val queries = new Queries
        val controller = new BankQueryController(components, authority, f.config, queries)
        assert(await(controller.accountMe(request())).header.status == 403)
        assert(queries.calls.isEmpty)
      }
      val brokenAuthority = new Authority {
        def authenticate(header: RequestHeader): Future[Option[(String, Set[String])]] = Future.failed(new IllegalStateException("private-authority-details"))
        def csrf(header: RequestHeader): Future[Boolean] = Future.successful(true)
      }
      val queries = new Queries
      val controller = new BankQueryController(components, brokenAuthority, f.config, queries)
      implicit val materializer: Materializer = f.materializer
      val result = await(controller.accountMe(request()))
      assert(result.header.status == 503 && json(result) == Json.obj("code" -> Unavailable.code))
      assert(queries.calls.isEmpty)
    }
  }

  test("closed query decoding rejects owner injection, duplicate scalars, bad pagination and invalid path IDs") {
    BankOwnerATestSupport.withFixture { f =>
      implicit val ec: ExecutionContext = f.ec
      val queries = new Queries
      val controller = new BankQueryController(components, f.authority, f.config, queries)
      val headers = Vector("Authorization" -> "Bearer alice-token")
      val cases = Vector(
        controller.accountMe -> Map("accountId" -> Seq("bob-account")),
        controller.plans -> Map("limit" -> Seq("1", "2")),
        controller.plans -> Map("limit" -> Seq("0")),
        controller.plans -> Map("limit" -> Seq("101")),
        controller.plans -> Map("after" -> Seq("-1")),
        controller.plans -> Map("after" -> Seq(Int.MaxValue.toString)),
        controller.order("bad id") -> Map.empty[String, Seq[String]],
        controller.plan("bad id") -> Map.empty[String, Seq[String]],
        controller.cashOriginal("bad id") -> Map.empty[String, Seq[String]])
      cases.foreach { case (action, query) =>
        assert(await(action(request(query = query, headers = headers))).header.status == 400)
        assert(queries.calls.isEmpty)
      }
      val result = await(controller.accountMe(request(headers = headers)))
      assert(result.header.status == 200 && result.header.headers.get("Cache-Control").contains("no-store"))
      assert(queries.calls.toVector == Vector(("account", f.alice, BankAccountKey(BankReadsideSchema.version))))
    }
  }

  test("all direct readside methods reject untrusted principals before acquiring JDBC or reading the journal") {
    BankOwnerATestSupport.withFixture { f =>
      val customerQueries: Vector[Principal => Future[Any]] = Vector(
        p => f.readside.accountMe(p, BankAccountKey(BankReadsideSchema.version)),
        p => f.readside.cashOriginal(p, BankCashRequestKey("request")),
        p => f.readside.order(p, BankOrderKey(FundOrderId("order"))),
        p => f.readside.plans(p, BankPlanPageKey(50L, 0L)),
        p => f.readside.plan(p, BankPlanKey(PlanId("plan"))),
        p => f.readside.occurrences(p, BankOccurrencePageKey(PlanId("plan"), 50L, 0L)))
      val principals = Vector[Principal](null, Principal("unconfigured", Set("customer")),
        Principal("alice", Set("customer", "operator")), f.operator)
      val before = f.dataSource.connections.get()
      val beforeJournal = f.journal.reads.get()
      for (run <- customerQueries; principal <- principals)
        assert(await(run(principal)) == Left(if (principal == null) NotAuthenticated else NotAuthorized))
      for (principal <- Vector[Principal](null, f.alice, f.bob, Principal("operator", Set("operator", "customer"))))
        assert(await(f.readside.pending(principal, BankPendingPageKey(50L, 0L))) == Left(if (principal == null) NotAuthenticated else NotAuthorized))
      assert(f.dataSource.connections.get() == before && f.journal.reads.get() == beforeJournal)
    }
  }

  test("resource ownership is checked before fetching a foreign order/plan payload or its watermarks") {
    BankOwnerATestSupport.withFixture { f =>
      val original = f.cashOriginal("same-client-key", "bob")
      f.catchUp(f.orderEvents(original.payment, Some(original)))
      val (planEvents, _) = f.planEvents("private-plan", "bob")
      f.catchUp(planEvents)
      val planId = BankRequestIdentity.plan("bob", "private-plan")
      f.dataSource.failOnSql = Some("SELECT * FROM bank_read_stream")
      assert(await(f.readside.order(f.alice, BankOrderKey(original.payment.fundOrderId))) == Left(NotAuthorized))
      assert(await(f.readside.plan(f.alice, BankPlanKey(planId))) == Left(NotAuthorized))
      assert(await(f.readside.occurrences(f.alice, BankOccurrencePageKey(planId, 50L, 0L))) == Left(NotAuthorized))
      assert(f.dataSource.failOnSql.isDefined, "foreign resource payload query must never execute")
      f.dataSource.failOnSql = None
      val BankCashRequestResponse(metadata, mine) = success(await(f.readside.cashOriginal(f.alice, BankCashRequestKey(original.clientRequestId))))
      assert(mine.isEmpty && disposition(metadata) == "unknown" && watermarks(metadata).isEmpty)
      val BankCashRequestResponse(_, theirs) = success(await(f.readside.cashOriginal(f.bob, BankCashRequestKey(original.clientRequestId))))
      assert(theirs.exists { case BankCashRequestView(source, _, _, _) => source == original })
      val BankSipPlanPage(_, myPlans, _) = success(await(f.readside.plans(f.alice, BankPlanPageKey(50L, 0L))))
      assert(myPlans.isEmpty)
      assert(await(f.readside.pending(f.alice, BankPendingPageKey(50L, 0L))) == Left(NotAuthorized))
      val BankPendingResponse(pendingMetadata, pending, _) = success(await(f.readside.pending(f.operator, BankPendingPageKey(50L, 0L))))
      assert(pending.nonEmpty && disposition(pendingMetadata) == "unknown")
    }
  }

  test("account identity comes from configuration and typed page/schema bounds are still validated") {
    BankOwnerATestSupport.withFixture { f =>
      f.catchUp(f.accountEvents(f.investor, "123.45"))
      f.catchUp(f.accountEvents(f.otherInvestor, "987.65"))
      val BankAccountResponse(_, Some(BankAccountView(account, _, available, _))) =
        success(await(f.readside.accountMe(f.alice, BankAccountKey(BankReadsideSchema.version))))
      assert(account == f.investor && available == MoneyWire("12345", "CNY"))
      assert(await(f.readside.accountMe(f.alice, BankAccountKey("wrong-version"))) == Left(InvalidRequest))
      assert(await(f.readside.plans(f.alice, BankPlanPageKey(0L, 0L))) == Left(InvalidRequest))
      assert(await(f.readside.occurrences(f.alice, BankOccurrencePageKey(PlanId("plan"), 101L, 0L))) == Left(InvalidRequest))
      assert(await(f.readside.pending(f.operator, BankPendingPageKey(50L, Int.MaxValue.toLong))) == Left(InvalidRequest))
    }
  }
}
