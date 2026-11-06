package example.bankwealth.service

import akka.stream.Materializer
import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.typesafe.config.ConfigFactory
import example.bankwealth.domain.values._
import example.bankwealth.integration._
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import example.bankwealth.web.BankBrowserPages
import org.scalatest.funsuite.AnyFunSuite
import play.api.{ApplicationLoader, Configuration, Environment, Mode}
import play.api.inject.DefaultApplicationLifecycle
import play.api.libs.json._
import play.api.mvc._
import play.api.test.FakeRequest
import java.io.File
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration._

final class BankPageRouterSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  private val origin = "http://127.0.0.1:18081"
  private val config = BankDemoConfiguration("router-v1", origin, Vector(
    BankDemoPrincipal("alice", AccountId("alice"), Set("customer"), "router-customer", "router-customer-csrf"),
    BankDemoPrincipal("operator", AccountId("operator"), Set("operator"), "router-operator", "router-operator-csrf")),
    Vector(BankFund("fund", AccountId("collection"))),
    Vector("alice", "operator", "collection").map(id => BankSeed(AccountId(id), "CNY", Money(BigDecimal("1000.00"), "CNY"))))
  private def await[A](value: Future[A]): A = Await.result(value, 8.seconds)

  private final class Fixture(readiness: Future[Unit] = Future.successful(())) {
    val queries = new BankOwnerATestSupport.Queries
    val services = new BankOwnerATestSupport.Services
    @volatile var cashFailure: Failure = Unavailable
    val composition = new Composition {
      val authority = new BankDemoAuthority(config)
      private val installed = BankServiceEndpoints.build(services, queries, services, services)
      val bindings = installed.copy(BankCashSubmitPort = installed.BankCashSubmitPort.copy(run = (principal, input) =>
        services.submit(principal, input).map(_ => Left(cashFailure))(scala.concurrent.ExecutionContext.global)))
      override val pages = Some(BankBrowserPages)
      val ready = readiness
      def close(): Unit = ()
    }
    val lifecycle = new DefaultApplicationLifecycle
    val context = ApplicationLoader.Context(Environment(new File("."), getClass.getClassLoader, Mode.Test),
      Configuration(ConfigFactory.parseString("play.http.secret.key=router-test-only-not-production").withFallback(ConfigFactory.load())), lifecycle, None)
    requireInstalled(composition)
    val components = new BankServiceComponents(context, composition)
    implicit val materializer: Materializer = components.materializer
    def send(method: String, path: String, body: String = "", role: Option[String] = Some("customer"), csrf: Boolean = true): Future[Result] = {
      val authentication = role.toVector.flatMap(r => Vector("Authorization" -> ("Bearer router-" + r)))
      val protection = if (csrf) role.toVector.flatMap(r => Vector("Origin" -> origin, "X-CSRF-Token" -> ("router-" + r + "-csrf"))) else Vector.empty
      val request = FakeRequest(method, path).withHeaders((authentication ++ protection): _*)
      val action = components.router.routes.lift(request).get.asInstanceOf[EssentialAction]
      action(request).run(Source.single(ByteString(body)))
    }
    def text(result: Result): String = await(result.body.consumeData).utf8String
    def close(): Unit = { await(lifecycle.stop()); await(components.actorSystem.terminate()); () }
  }
  private def withFixture[A](run: Fixture => A): A = {
    val fixture = new Fixture
    try run(fixture) finally fixture.close()
  }

  test("public shell and script expose no protected business data and only explicit paths route") {
    val ready = Promise[Unit]()
    val f = new Fixture(ready.future)
    try {
      val shell = await(f.send("GET", "/bank/v1", role = None))
      assert(shell.header.status == 200 && shell.body.contentType.exists(_.startsWith("text/html")))
      val text = f.text(shell)
      assert(!text.contains("router-customer") && !text.contains("router-operator"))
      assert(shell.header.headers("Cache-Control") == "no-store")
      assert(shell.header.headers("Content-Security-Policy").contains("frame-ancestors 'none'"))
      val script = await(f.send("GET", "/bank/v1/client-script", role = None))
      assert(script.header.status == 200 && script.body.contentType.exists(_.contains("javascript")))
      assert(f.queries.calls.isEmpty && f.services.calls.isEmpty)
      assert(f.components.router.routes.lift(FakeRequest("GET", "/bank/v1/arbitrary")).isEmpty)
      assert(f.components.router.routes.lift(FakeRequest("POST", "/bank/v1")).isEmpty)
    } finally { ready.trySuccess(()); f.close() }
  }

  test("page aliases and API share authentication role and exact closed DTO admission") {
    withFixture { f =>
      assert(await(f.send("GET", "/bank/v1/accounts/me", role = None)).header.status == 401)
      assert(await(f.send("GET", "/bank/v1/operations/pending")).header.status == 403)
      assert(f.queries.calls.isEmpty && f.services.calls.isEmpty)
      val page = await(f.send("GET", "/bank/v1/accounts/me"))
      val api = await(f.send("GET", "/api/v1/accounts/me"))
      assert(page.header.status == 200 && api.header.status == 200)
      assert(page.body.contentType.exists(_.startsWith("text/html")))
      assert(api.body.contentType.exists(_.startsWith("application/json")))
      assert(f.queries.calls.map(_._1).toVector == Vector("account", "account"))
      assert(await(f.send("GET", "/bank/v1/sip-plans?limit=1&limit=2")).header.status == 400)
      assert(f.queries.calls.size == 2)
      val body = """{"clientRequestId":"one","fundCode":"fund","amount":{"minorUnits":"10000","currency":"CNY"}}"""
      assert(await(f.send("POST", "/bank/v1/cash-requests", body, csrf = false)).header.status == 403)
      assert(await(f.send("POST", "/bank/v1/cash-requests", body.dropRight(1) + ",\"roles\":[]}")).header.status == 400)
      assert(await(f.send("POST", "/bank/v1/cash-requests", body.replace("\"one\"", "\"one\",\"clientRequestId\":\"two\""))).header.status == 400)
      assert(await(f.send("POST", "/bank/v1/cash-requests", "x" * 65537)).header.status == 413)
      assert(f.services.calls.isEmpty)
      val response = await(f.send("POST", "/bank/v1/cash-requests", body))
      assert(response.header.status == 503 && f.text(response).contains("service-unavailable"))
      assert(f.services.calls.size == 1)
      f.cashFailure = RequestConflict
      val conflict = await(f.send("POST", "/bank/v1/cash-requests", body))
      assert(conflict.header.status == 409 && f.text(conflict).contains("request-conflict"))
      val apiConflict = await(f.send("POST", "/api/v1/cash-requests", body))
      assert(apiConflict.header.status == 409 && apiConflict.body.contentType.exists(_.startsWith("application/json")))
    }
  }

  test("all fourteen aliases dispatch the corresponding existing endpoint without changing status") {
    withFixture { f =>
      val gets = Vector("/accounts/me", "/cash-requests/request", "/orders/order", "/sip-plans", "/sip-plans/plan", "/sip-plans/plan/occurrences")
      gets.foreach(path => assert(await(f.send("GET", "/bank/v1" + path)).header.status == 200))
      assert(await(f.send("GET", "/bank/v1/operations/pending", role = Some("operator"))).header.status == 200)
      val amount = """"amount":{"minorUnits":"10000","currency":"CNY"}"""
      val posts = Vector(
        ("/cash-requests", "{" + "\"clientRequestId\":\"request\",\"fundCode\":\"fund\"," + amount + "}", "customer"),
        ("/sip-plans", "{" + "\"clientRequestId\":\"request\",\"fundCode\":\"fund\"," + amount + ",\"effectiveSlot\":0,\"dueSlots\":[10]}", "customer"),
        ("/sip-plans/plan/revisions", "{" + "\"revision\":\"r2\",\"effectiveSlot\":10,\"fundCode\":\"fund\"," + amount + "}", "customer"),
        ("/sip-plans/plan/pause", "{}", "customer"), ("/sip-plans/plan/resume", "{}", "customer"),
        ("/operations/op/reconcile", "{}", "operator"), ("/business-clock/tick", "{\"slot\":9007199254740993}", "operator"))
      posts.foreach { case (path, body, role) => assert(await(f.send("POST", "/bank/v1" + path, body, Some(role))).header.status == 503) }
      assert(f.queries.calls.size == 7 && f.services.calls.size == 7)
      assert(f.services.calls.last._3 == BankTick(9007199254740993L))
    }
  }

  test("missing and mismatched renderer pins are rejected before router installation") {
    withFixture { f =>
      def candidate(renderer: Option[PageRenderer]): Composition = new Composition {
        val authority = f.composition.authority
        val bindings = f.composition.bindings
        val ready = Future.successful(())
        override val pages = renderer
        def close(): Unit = ()
      }
      intercept[IllegalArgumentException](requireInstalled(candidate(None)))
      intercept[IllegalArgumentException](requireInstalled(candidate(Some(null))))
      val wrong = new PageRenderer {
        val implementation = "example.wrong.Pages"
        val version = "1"
        val shell = ""
        val script = ""
        def render(id: String, status: Int, value: JsValue): String = ""
      }
      intercept[IllegalArgumentException](requireInstalled(candidate(Some(wrong))))
      assert(f.queries.calls.isEmpty && f.services.calls.isEmpty)
    }
  }

  test("pending or failed readiness dispatches no page or API endpoint") {
    val ready = Promise[Unit]()
    val f = new Fixture(ready.future)
    try {
      val page = f.send("GET", "/bank/v1/accounts/me")
      val api = f.send("GET", "/api/v1/accounts/me")
      assert(!page.isCompleted && !api.isCompleted && f.queries.calls.isEmpty)
      ready.failure(new IllegalStateException("synthetic-startup-failure"))
      assert(await(page).header.status == 503 && await(api).header.status == 503)
      assert(f.queries.calls.isEmpty && f.services.calls.isEmpty)
    } finally { ready.trySuccess(()); f.close() }
  }
}
