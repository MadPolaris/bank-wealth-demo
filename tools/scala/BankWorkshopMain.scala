package example.bankwealth.workshop

import com.typesafe.config.ConfigFactory
import example.bankwealth.service.{BankServiceConfiguration, BankServiceLoader}
import play.api.{Application, ApplicationLoader, Configuration, Environment, Mode}
import play.api.inject.DefaultApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import play.core.server.{AkkaHttpServer, ServerConfig}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, LinkOption, Path, Paths, StandardCopyOption, StandardOpenOption}
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.Await
import scala.concurrent.duration._
import scala.util.control.NonFatal

/** Workshop-only launcher, compiled separately from the sealed application/test classes.
  * There is deliberately no session deadline. Startup/exit are bounded by the owner
  * controller; stop.json and JVM signals both run the same resource cleanup.
  */
object BankWorkshopMain {
  private def sha(text: String): String =
    MessageDigest.getInstance("SHA-256").digest(text.getBytes(UTF_8)).map(b => f"${b & 0xff}%02x").mkString

  private def read(file: Path): JsObject = {
    require(Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) && Files.size(file) <= 16384)
    Json.parse(Files.readAllBytes(file)).as[JsObject]
  }

  // Readers never mistake a partially written marker for a completed transition.
  private def write(file: Path, value: JsObject): Unit = {
    require(!Files.exists(file, LinkOption.NOFOLLOW_LINKS))
    val pending = file.resolveSibling(file.getFileName.toString + ".pending")
    Files.createFile(pending, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
    Files.write(pending, Json.stringify(value).getBytes(UTF_8), StandardOpenOption.WRITE)
    Files.move(pending, file, StandardCopyOption.ATOMIC_MOVE)
  }

  // No exception/config/token/stacktrace is serialized. The Node controller checks
  // this exact vocabulary AND the owner/nonce/classpath/launcher/PID before use.
  private val failureCodes = Map(
    "identity" -> "JVM_IDENTITY_REJECTED",
    "configuration" -> "JVM_CONFIGURATION_REJECTED",
    "application-load" -> "JVM_APPLICATION_LOAD_FAILED",
    "server-bind" -> "JVM_SERVER_BIND_FAILED",
    "ready-marker" -> "JVM_READY_MARKER_FAILED",
    "stop-control" -> "JVM_STOP_CONTROL_REJECTED",
    "resource-close" -> "JVM_RESOURCE_CLOSE_FAILED")

  private final class Diagnostic(owned: Path, identity: JsObject) {
    @volatile var phase = "identity"
    private var reported = false
    def fail(at: String): Unit = synchronized {
      if (!reported && failureCodes.contains(at)) {
        reported = true
        try write(owned.resolve("failure.json"), identity ++ Json.obj(
          "pid" -> ProcessHandle.current().pid(), "phase" -> at, "code" -> failureCodes(at)))
        catch { case NonFatal(_) => () } // Marker I/O failure has only the controller's generic fallback.
      }
    }
  }

  // Establish the smallest trustworthy write capability first. Invalid args/run/
  // identity get NO marker. In particular, do not resolve/read the private config
  // before this point: later path/config/classpath failures can be diagnosed safely.
  private def ownedIdentity(args: Array[String]): (Path, JsObject) = {
    require(args.length == 2)
    val owned = Paths.get(args(0))
    require(owned.isAbsolute && owned.normalize() == owned && owned.toRealPath() == owned)
    require(Files.isDirectory(owned, LinkOption.NOFOLLOW_LINKS) && owned.getFileName.toString == "run")
    val session = owned.getParent
    val identityFile = owned.resolve("identity.json")
    require(Files.getOwner(owned) == Files.getOwner(session) && Files.getOwner(identityFile) == Files.getOwner(owned))
    require(Files.getPosixFilePermissions(owned) == PosixFilePermissions.fromString("rwx------"))
    require(Files.getPosixFilePermissions(session) == PosixFilePermissions.fromString("rwx------"))
    require(Files.getAttribute(identityFile, "unix:nlink", LinkOption.NOFOLLOW_LINKS) == Integer.valueOf(1))
    val identity = read(identityFile)
    require(identity.keys == Set("schemaVersion", "owner", "identity", "classpathSha256", "launcherSha256"))
    require((identity \ "schemaVersion").as[String] == "bank.workshop-instance/v1")
    require((identity \ "owner").as[String].matches("[a-z][a-z0-9_-]{0,59}"))
    require(session.getFileName.toString == "truthsrc-runtime-" + (identity \ "owner").as[String])
    require((identity \ "identity").as[String].matches("[0-9a-f]{48}"))
    require((identity \ "classpathSha256").as[String].matches("[0-9a-f]{64}"))
    require((identity \ "launcherSha256").as[String].matches("[0-9a-f]{64}"))
    (owned, identity)
  }

  def main(args: Array[String]): Unit = {
    var diagnostic = Option.empty[Diagnostic]
    try {
      val (owned, identity) = ownedIdentity(args)
      val reporter = new Diagnostic(owned, identity)
      diagnostic = Some(reporter)
      run(owned, identity, reporter, args(1))
    } catch {
      case NonFatal(_) =>
        diagnostic.foreach(d => d.fail(d.phase))
        // Raw stdout/stderr are OS-discarded as a second line of defense. Do not
        // rethrow a private exception, even if this main is invoked incorrectly.
        System.exit(2)
    }
  }

  private def run(owned: Path, identity: JsObject, diagnostic: Diagnostic, inputArg: String): Unit = {
    val session = owned.getParent
    var applicationLifecycle = Option.empty[DefaultApplicationLifecycle]
    var app = Option.empty[Application]
    var server = Option.empty[AkkaHttpServer]
    var applicationLoadStarted = false
    val stopRequested = new AtomicBoolean(false)
    var finished = false
    var cleanupPassed = true
    // The hook also serializes against loader startup, so no newly loaded resources
    // can escape a signal that arrived while the factory was constructing them.
    // An uncooperative loader/server is bounded by the controller's TERM/KILL waits.
    val lock = new Object
    def close(): Unit = lock.synchronized {
      if (!finished) {
        finished = true
        def attempt(action: => Unit): Unit = try action catch { case NonFatal(_) =>
          cleanupPassed = false
          diagnostic.fail("resource-close")
        }
        attempt(server.foreach(_.stop()))
        attempt(applicationLifecycle.foreach(lifecycle => Await.result(lifecycle.stop(), 60.seconds)))
        attempt(app.foreach(a => Await.result(a.actorSystem.terminate(), 30.seconds)))
        attempt(write(owned.resolve("closed.json"), identity ++ Json.obj(
          "pid" -> ProcessHandle.current().pid(), "closed" -> cleanupPassed,
          "applicationLoadStarted" -> applicationLoadStarted)))
      }
    }
    def requested(): Boolean = {
      if (!Files.exists(owned.resolve("stop.json"), LinkOption.NOFOLLOW_LINKS)) false
      else {
        val previous = diagnostic.phase
        diagnostic.phase = "stop-control"
        require(read(owned.resolve("stop.json")) == identity)
        diagnostic.phase = previous
        true
      }
    }
    val hook = new Thread(new Runnable { def run(): Unit = { stopRequested.set(true); close() } }, "bank-workshop-shutdown")
    Runtime.getRuntime.addShutdownHook(hook)
    try {
      require((identity \ "classpathSha256").as[String] == sha(System.getProperty("java.class.path")))
      require(Paths.get(getClass.getProtectionDomain.getCodeSource.getLocation.toURI).toRealPath() ==
        session.resolve("build/classes").toRealPath())
      require(!Files.exists(owned.resolve("ready.json")) && !Files.exists(owned.resolve("closed.json")))
      // A stop arriving immediately after spawn is cancellation, not a failed
      // require(!stop.json). No application/worker has been entered on this path.
      if (stopRequested.get() || requested()) return
      diagnostic.phase = "configuration"
      val input = Paths.get(inputArg)
      require(input == session.resolve("private/session.conf") && input.toRealPath() == input)
      val raw = ConfigFactory.parseFile(input.toFile).withFallback(ConfigFactory.load()).resolve()
      require(raw.getString("service.test-tier") == "database-integration")
      BankServiceConfiguration.validate(Configuration(raw))
      val port = raw.getInt("bank.integration.httpPort")
      require(port > 1024 && port < 65536 && !Set(9000, 2551, 27017, 3306)(port))
      val origin = "http://127.0.0.1:" + port
      require(raw.getString("bank.demo.origin") == origin)
      val life = new DefaultApplicationLifecycle
      applicationLifecycle = Some(life)
      val context = ApplicationLoader.Context(Environment(session.toFile, getClass.getClassLoader, Mode.Prod),
        Configuration(raw), life, None)
      lock.synchronized {
        if (stopRequested.get() || requested()) stopRequested.set(true)
        else {
          diagnostic.phase = "application-load"
          applicationLoadStarted = true
          val loaded = new BankServiceLoader().load(context)
          app = Some(loaded)
          diagnostic.phase = "server-bind"
          val running = AkkaHttpServer.fromApplication(loaded,
            ServerConfig(port = Some(port), address = "127.0.0.1", mode = Mode.Prod))
          server = Some(running)
          require(running.mainAddress.getAddress.getHostAddress == "127.0.0.1" && running.mainAddress.getPort == port)
          // This means bound, not business-ready. The controller additionally checks
          // the actual listener and authenticated caught-up account read model.
          diagnostic.phase = "ready-marker"
          write(owned.resolve("ready.json"), identity ++ Json.obj(
            "pid" -> ProcessHandle.current().pid(), "origin" -> origin, "bound" -> true))
        }
      }
      diagnostic.phase = "stop-control"
      while (!stopRequested.get()) {
        if (requested()) stopRequested.set(true)
        else Thread.sleep(100)
      }
    } catch {
      case NonFatal(_) =>
        diagnostic.fail(diagnostic.phase) // Preserve the first failure, not a later cleanup phase.
        throw new IllegalStateException("workshop stage failed")
    } finally {
      close()
      try Runtime.getRuntime.removeShutdownHook(hook) catch { case _: IllegalStateException => () }
    }
    require(cleanupPassed, "workshop resource close failed")
  }
}
