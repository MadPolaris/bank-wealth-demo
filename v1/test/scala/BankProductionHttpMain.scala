package example.bankwealth.service

import com.typesafe.config.ConfigFactory
import play.api.{Application, ApplicationLoader, Configuration, Environment, Mode}
import play.api.inject.DefaultApplicationLifecycle
import play.api.libs.json.Json
import play.core.server.{AkkaHttpServer, ServerConfig}
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths, StandardOpenOption}
import scala.concurrent.Await
import scala.concurrent.duration._

/** Explicit integration entry point; never discovered by the unit test runner. */
object BankProductionHttpMain {
  def main(args: Array[String]): Unit = {
    require(args.length == 2)
    val owned = Paths.get(args(0)).toRealPath()
    val input = Paths.get(args(1)).toRealPath()
    require(input.startsWith(owned) && !Files.exists(owned.resolve("server.json")) && !Files.exists(owned.resolve("stop")))
    val raw = ConfigFactory.parseFile(input.toFile).withFallback(ConfigFactory.load()).resolve()
    require(raw.getString("service.test-tier") == "database-integration")
    BankServiceConfiguration.validate(Configuration(raw))
    val port = raw.getInt("bank.integration.httpPort")
    require(port > 1024 && port < 65536 && !Set(9000, 2551, 27017, 3306)(port))
    require(raw.getString("bank.demo.origin") == "http://127.0.0.1:" + port)
    val lifecycle = new DefaultApplicationLifecycle
    val context = ApplicationLoader.Context(Environment(new File("."), getClass.getClassLoader, Mode.Prod),
      Configuration(raw), lifecycle, None)
    var app = Option.empty[Application]
    var server = Option.empty[AkkaHttpServer]
    try {
      val loaded = new BankServiceLoader().load(context)
      app = Some(loaded)
      val running = AkkaHttpServer.fromApplication(loaded, ServerConfig(port = Some(port), address = "127.0.0.1", mode = Mode.Prod))
      server = Some(running)
      Files.write(owned.resolve("server.json"), Json.stringify(Json.obj(
        "origin" -> ("http://127.0.0.1:" + running.mainAddress.getPort),
        "pid" -> ProcessHandle.current().pid(), "scope" -> "production Loader and Factory with Mongo/MySQL")).getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW)
      val deadline = System.nanoTime() + 240.seconds.toNanos
      while (!Files.exists(owned.resolve("stop")) && System.nanoTime() < deadline) Thread.sleep(100)
      require(Files.exists(owned.resolve("stop")), "integration deadline exceeded")
    } finally {
      try server.foreach(_.stop())
      finally {
        try Await.result(lifecycle.stop(), 45.seconds)
        finally app.foreach(a => Await.result(a.actorSystem.terminate(), 30.seconds))
      }
    }
    Files.write(owned.resolve("closed.json"), Json.stringify(Json.obj("closed" -> true)).getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW)
  }
}
