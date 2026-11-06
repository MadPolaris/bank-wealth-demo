package example.bankwealth.service

import com.typesafe.config.ConfigFactory
import example.bankwealth.domain.values._
import example.bankwealth.integration.BankServiceEndpoints
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import example.bankwealth.web.BankBrowserPages
import play.api.{ApplicationLoader, Configuration, Environment, Mode}
import play.api.inject.DefaultApplicationLifecycle
import play.api.libs.json.Json
import play.api.mvc.RequestHeader
import play.core.server.{AkkaHttpServer, ServerConfig}
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths, StandardOpenOption}
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

/** HTTP transport fixture only: read stubs return unknown projections, writes refuse.
  * No funds, journal, TA process or production Factory are exercised here.
  */
object BankBrowserHttpFixture {
  def main(args: Array[String]): Unit = {
    require(args.length == 1)
    val owned = Paths.get(args(0)).toRealPath()
    require(owned.isAbsolute && !Files.exists(owned.resolve("server.json")) && !Files.exists(owned.resolve("stop")))
    val raw = ConfigFactory.load()
    require(raw.getString("service.test-tier") == "http-transport")
    require(raw.getString("akka.persistence.journal.plugin") == "akka.persistence.testkit.journal")
    require(raw.getString("akka.persistence.snapshot-store.plugin") == "akka.persistence.testkit.snapshotstore.pluginid")
    val lifecycle = new DefaultApplicationLifecycle
    val context = ApplicationLoader.Context(Environment(new File("."), getClass.getClassLoader, Mode.Test),
      Configuration(ConfigFactory.parseString("play.http.secret.key=browser-synthetic-fixture-only").withFallback(raw)), lifecycle, None)
    @volatile var configured: Option[BankDemoAuthority] = None
    val queries = new BankOwnerATestSupport.Queries
    val services = new BankOwnerATestSupport.Services
    val composition = new Composition {
      val authority = new Authority {
        def authenticate(request: RequestHeader) = configured.map(_.authenticate(request)).getOrElse(Future.successful(None))
        def csrf(request: RequestHeader) = configured.map(_.csrf(request)).getOrElse(Future.successful(false))
      }
      val bindings = BankServiceEndpoints.build(services, queries, services, services)
      override val pages = Some(BankBrowserPages)
      val ready = Future.successful(())
      def close(): Unit = ()
    }
    val components = new BankServiceComponents(context, composition)
    var server: Option[AkkaHttpServer] = None
    try {
      val running = AkkaHttpServer.fromApplication(components.application, ServerConfig(port = Some(0), address = "127.0.0.1", mode = Mode.Test))
      server = Some(running)
      val origin = "http://127.0.0.1:" + running.mainAddress.getPort
      val config = BankDemoConfiguration("browser-synthetic-v1", origin, Vector(
        BankDemoPrincipal("customer", AccountId("customer"), Set("customer"), "browser-customer", "browser-customer-csrf"),
        BankDemoPrincipal("operator", AccountId("operator"), Set("operator"), "browser-operator", "browser-operator-csrf")),
        Vector(BankFund("fund", AccountId("collection"))),
        Vector("customer", "operator", "collection").map(id => BankSeed(AccountId(id), "CNY", Money(BigDecimal("1000.00"), "CNY"))))
      configured = Some(new BankDemoAuthority(config))
      Files.write(owned.resolve("server.json"), Json.stringify(Json.obj("origin" -> origin, "pid" -> ProcessHandle.current().pid(), "scope" -> "HTTP boundary with refusing business stubs, not financial integration")).getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW)
      val deadline = System.nanoTime() + 180.seconds.toNanos
      while (!Files.exists(owned.resolve("stop")) && System.nanoTime() < deadline) Thread.sleep(100)
      require(Files.exists(owned.resolve("stop")), "browser fixture deadline exceeded")
      require(queries.calls.nonEmpty && services.calls.size == 7, "fourteen-route transport traversal incomplete")
      require(services.calls.last._3 == BankTick(9007199254740993L), "wide Long wire must reach typed endpoint exactly")
      Files.write(owned.resolve("server-result.json"), Json.stringify(Json.obj("readCalls" -> queries.calls.size, "writeCalls" -> services.calls.size, "exactWideLong" -> true)).getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW)
    } finally {
      server.foreach(_.stop())
      Await.result(lifecycle.stop(), 15.seconds)
      Await.result(components.actorSystem.terminate(), 15.seconds)
    }
  }
}
