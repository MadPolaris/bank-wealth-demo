package example.bankwealth.bindings

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.ObjectNode
import java.io.{BufferedReader, BufferedWriter, InputStreamReader, OutputStreamWriter}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, StandardOpenOption}
import java.util.concurrent.{Executors, TimeUnit}
import scala.concurrent.{ExecutionContext, Future}

final class MockTAClient(journal: Path, transcript: Path, stderr: Path) extends AutoCloseable {
  private val root = java.nio.file.Paths.get("/Users/zhongdj/Workspaces/mad-polaris/bank-wealth-demo").toRealPath()
  private val owned = root.resolve(".scratch/p24-p25-bank-joint-fkcd3jwe")
  private val mapper = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
  private val executor = Executors.newSingleThreadExecutor()
  private val watchdog = Executors.newSingleThreadScheduledExecutor()
  private implicit val io: ExecutionContext = ExecutionContext.fromExecutor(executor)
  private var sequence = 0
  @volatile private var closed = false
  Vector(journal, transcript, stderr).foreach { path =>
    require(path.isAbsolute && path.normalize() == path && path.startsWith(owned), "owned MockTA paths required")
    var parent = path
    while (parent != root) { require(!Files.isSymbolicLink(parent), "MockTA path symlink refused"); parent = parent.getParent }
  }
  require(!Files.exists(transcript) && !Files.exists(stderr), "fresh worker logs required")
  Files.createDirectories(journal.getParent)
  private val log = Files.newBufferedWriter(transcript, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW)
  private val process = new ProcessBuilder("/Users/zhongdj/.nvm/versions/node/v22.23.4/bin/node",
    root.resolve("tools/v1-mock-ta-worker.mjs").toString, journal.toString)
    .directory(root.toFile).redirectError(stderr.toFile).start()
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
      require(response.path("id").isIntegralNumber && response.path("id").asInt() == id && response.path("ok").isBoolean, "worker response identity mismatch")
      require(response.path("ok").asBoolean(), "MockTA refused: " + response.path("error").toString)
      response.get("result")
    } finally deadline.cancel(false)
  }
  def submit(request: JsonNode): Future[JsonNode] = Future(exchange("submit", request))
  def query(requestId: String): Future[JsonNode] = Future(exchange("query", mapper.getNodeFactory.textNode(requestId)))
  def advance(ticks: Long): Future[JsonNode] = Future(exchange("advance", mapper.getNodeFactory.numberNode(ticks)))
  def close(): Unit = synchronized {
    if (!closed) {
      try {
        if (process.isAlive) exchange("close", mapper.getNodeFactory.nullNode())
      } finally {
        closed = true
        input.close()
        if (!process.waitFor(3, TimeUnit.SECONDS)) {
          process.destroy()
          if (!process.waitFor(3, TimeUnit.SECONDS)) { process.destroyForcibly(); process.waitFor() }
        }
        record(mapper.createObjectNode().put("kind", "worker-exited").put("pid", process.pid()).put("waited", true).put("exitCode", process.exitValue()))
        output.close(); log.close(); executor.shutdown(); watchdog.shutdown()
      }
    }
  }
}
