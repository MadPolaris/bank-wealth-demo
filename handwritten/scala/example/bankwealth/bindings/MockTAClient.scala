package example.bankwealth.bindings

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.ObjectNode
import java.io.{BufferedReader, BufferedWriter, InputStreamReader, OutputStreamWriter}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, StandardOpenOption}
import java.util.concurrent.{Executors, TimeUnit}
import scala.concurrent.{ExecutionContext, Future}

object MockTAClient {
  /** Deployment inputs, never supplied by a cash request or TA receipt. */
  final case class Configuration(node: Path, worker: Path, ownedRoot: Path) {
    require(Vector(node, worker, ownedRoot).forall(p => p != null && p.isAbsolute && p.normalize() == p),
      "explicit absolute normalized MockTA configuration required")
    Vector(node, worker, ownedRoot).foreach(noSymlinks)
    require(Files.isRegularFile(node) && Files.isExecutable(node), "configured Node executable required")
    require(Files.isRegularFile(worker), "configured local MockTA worker required")
  }
  private def noSymlinks(path: Path): Unit = {
    var ancestor = path
    while (ancestor != null) {
      require(!Files.isSymbolicLink(ancestor), "MockTA path symlink refused")
      ancestor = ancestor.getParent
    }
  }
  // Compatibility only for the original joint suites. The application refuses this constructor.
  private def legacy(journal: Path): Configuration = {
    var root = journal.getParent
    while (root != null && !Files.isRegularFile(root.resolve("tools/v1-mock-ta-worker.mjs"))) root = root.getParent
    require(root != null, "legacy worker must belong to an existing bank workspace")
    val node = sys.props.get("bank.mock-ta.node").map(java.nio.file.Paths.get(_)).orElse(
      sys.env.get("PATH").toVector.flatMap(_.split(java.io.File.pathSeparator)).map(p => java.nio.file.Paths.get(p).resolve("node"))
        .find(p => p.isAbsolute && Files.isExecutable(p)).map(_.toRealPath()))
      .getOrElse(throw new IllegalArgumentException("explicit Node executable required"))
    Configuration(node, root.resolve("tools/v1-mock-ta-worker.mjs"), root.resolve(".scratch/p24-p25-bank-joint-fkcd3jwe"))
  }
}

final class MockTAClient private (val configuration: MockTAClient.Configuration, journal: Path, transcript: Path,
    stderr: Path, val usesLegacyConfiguration: Boolean) extends AutoCloseable {
  def this(configuration: MockTAClient.Configuration, journal: Path, transcript: Path, stderr: Path) =
    this(configuration, journal, transcript, stderr, false)
  def this(journal: Path, transcript: Path, stderr: Path) =
    this(MockTAClient.legacy(journal), journal, transcript, stderr, true)
  require(configuration != null, "trusted immutable MockTA configuration required")
  private val owned = configuration.ownedRoot
  private val mapper = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
  Vector(journal, transcript, stderr).foreach { path =>
    require(path != null && path.isAbsolute && path.normalize() == path && path != owned && path.startsWith(owned), "owned MockTA paths required")
    MockTAClient.noSymlinks(path)
  }
  require(Vector(journal, transcript, stderr).distinct.size == 3, "distinct worker journal and logs required")
  require(!Files.exists(transcript) && !Files.exists(stderr), "fresh worker logs required")
  Vector(journal, transcript, stderr).foreach(p => Files.createDirectories(p.getParent))
  private val log = Files.newBufferedWriter(transcript, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW)
  // Explicit mode adds the owned root to the worker's existing journal argument.
  // Legacy mode retains the old one-argument protocol for the old joint suites.
  private val arguments = Vector(configuration.node.toString, configuration.worker.toString, journal.toString) ++
    (if (usesLegacyConfiguration) Vector.empty else Vector(owned.toString))
  private val process = try new ProcessBuilder(arguments: _*)
    .directory(configuration.worker.getParent.toFile).redirectError(stderr.toFile).start()
    catch { case error: Throwable => log.close(); throw error }
  private val executor = Executors.newSingleThreadExecutor()
  private val watchdog = Executors.newSingleThreadScheduledExecutor()
  private implicit val io: ExecutionContext = ExecutionContext.fromExecutor(executor)
  private var sequence = 0
  @volatile private var closed = false
  private val input = new BufferedWriter(new OutputStreamWriter(process.getOutputStream, StandardCharsets.UTF_8))
  private val output = new BufferedReader(new InputStreamReader(process.getInputStream, StandardCharsets.UTF_8))
  private def record(value: JsonNode): Unit = { log.write(mapper.writeValueAsString(value)); log.newLine(); log.flush() }
  private val started = mapper.createObjectNode().put("kind", "worker-started").put("pid", process.pid())
  record(started)

  private def exchange(op: String, value: JsonNode): JsonNode = synchronized {
    require(!closed && process.isAlive, "worker is closed")
    val id = sequence; sequence = Math.addExact(sequence, 1)
    val request = mapper.createObjectNode().put("id", id).put("op", op)
    request.set[JsonNode]("input", value)
    val text = mapper.writeValueAsString(request)
    require(text.getBytes(StandardCharsets.UTF_8).length <= 65536, "worker request capacity exceeded")
    record(request)
    val deadline = watchdog.schedule(new Runnable { def run(): Unit = process.destroyForcibly() }, 5, TimeUnit.SECONDS)
    try {
      input.write(text); input.newLine(); input.flush()
      val buffer = new StringBuilder
      var c = output.read()
      while (c != -1 && c != '\n') {
        require(buffer.length < 1048576, "worker response capacity exceeded")
        buffer.append(c.toChar); c = output.read()
      }
      require(c != -1, "worker ended before a complete response")
      val response = mapper.readTree(buffer.toString)
      record(response)
      require(response.path("id").isIntegralNumber && response.path("id").canConvertToInt && response.path("id").intValue() == id && response.path("ok").isBoolean, "worker response identity mismatch")
      require(response.path("ok").asBoolean(), "MockTA refused: " + response.path("error").toString)
      val result = response.get("result")
      require(result != null && result.isObject, "complete worker result required")
      result
    } finally deadline.cancel(false)
  }
  private def request(op: String, value: JsonNode): Future[JsonNode] = synchronized {
    if (closed) Future.failed(new IllegalStateException("worker is closed")) else Future(exchange(op, value))
  }
  def submit(value: JsonNode): Future[JsonNode] = request("submit", value)
  def query(requestId: String): Future[JsonNode] = request("query", mapper.getNodeFactory.textNode(requestId))
  def advance(ticks: Long): Future[JsonNode] = request("advance", mapper.getNodeFactory.numberNode(ticks))
  def close(): Unit = synchronized {
    if (!closed) {
      var failure: Exception = null
      var interrupted = false
      def cleanup(action: => Unit): Unit = try action catch {
        case error: Exception =>
          if (error.isInstanceOf[InterruptedException]) interrupted = true
          if (failure == null) failure = error else failure.addSuppressed(error)
      }
      cleanup { if (process.isAlive) exchange("close", mapper.getNodeFactory.nullNode()) }
      closed = true
      cleanup(input.close())
      cleanup {
        if (!process.waitFor(3, TimeUnit.SECONDS)) {
          process.destroy()
          if (!process.waitFor(3, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            require(process.waitFor(3, TimeUnit.SECONDS), "MockTA worker did not exit after forced shutdown")
          }
        }
      }
      // Even an interrupted graceful wait must still reap the owned child.
      cleanup {
        if (process.isAlive) {
          process.destroyForcibly()
          require(process.waitFor(3, TimeUnit.SECONDS), "MockTA worker did not exit after forced shutdown")
        }
      }
      if (!process.isAlive) cleanup(record(mapper.createObjectNode().put("kind", "worker-exited").put("pid", process.pid())
        .put("waited", true).put("exitCode", process.exitValue())))
      cleanup(output.close())
      cleanup(log.close())
      executor.shutdown()
      watchdog.shutdown()
      if (failure != null) {
        if (interrupted) Thread.currentThread().interrupt()
        throw failure
      }
    }
  }
}
