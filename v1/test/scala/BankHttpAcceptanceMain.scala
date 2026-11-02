package example.bankwealth.service

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.persistence.query.PersistenceQuery
import akka.persistence.query.journal.leveldb.scaladsl.LeveldbReadJournal
import akka.serialization.{SerializationExtension, Serializers}
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.Sink
import akka.util.Timeout
import com.typesafe.config.{ConfigFactory, ConfigParseOptions}
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto._
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.application.{bank_cash_payment_v1Execution => Cash}
import example.bankwealth.integration._
import example.bankwealth.readside.BankReadside
import example.bankwealth.security._
import example.bankwealth.service.BankServiceService._
import example.bankwealth.sip.BankSipApplication
import net.imadz.infra.saga.strict.{ReconcileAuthorizer, TransactionIdentity}
import net.imadz.monarch.persistence.PersistentMonarch
import org.h2.jdbcx.JdbcDataSource
import play.api.{ApplicationLoader, Configuration, Environment, Mode}
import play.api.inject.DefaultApplicationLifecycle
import play.api.libs.json._
import play.core.server.{AkkaHttpServer, ServerConfig}

import java.io.{ByteArrayOutputStream, File}
import java.net.{InetAddress, InetSocketAddress, ServerSocket, Socket}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path, Paths, StandardOpenOption}
import java.util.concurrent.{Callable, CountDownLatch, Executors, TimeUnit}
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._

/** Explicit socket integration entry point; it is not a discoverable unit suite. */
object BankHttpAcceptanceMain {
  private final class OwnedLoopbackOnly extends SecurityManager {
    private val ports = java.util.concurrent.ConcurrentHashMap.newKeySet[Integer]()
    def register(port: Int): Unit = { require(port > 1024 && !Set(9000, 2551, 27017, 3306)(port)); ports.add(port); () }
    override def checkPermission(permission: java.security.Permission): Unit = ()
    override def checkPermission(permission: java.security.Permission, context: Any): Unit = ()
    override def checkConnect(host: String, port: Int): Unit = {
      if (!Set("127.0.0.1", "localhost", "::1")(host) || (port != -1 && !ports.contains(port)))
        throw new SecurityException("socket acceptance may connect only to its registered loopback listeners")
    }
    override def checkConnect(host: String, port: Int, context: Any): Unit = checkConnect(host, port)
    override def checkListen(port: Int): Unit = if (port != 0 && !ports.contains(port))
      throw new SecurityException("socket acceptance listeners must use ephemeral owned ports")
    override def checkAccept(host: String, port: Int): Unit = if (!Set("127.0.0.1", "::1")(host))
      throw new SecurityException("socket acceptance cannot accept non-loopback clients")
  }
  private def await[A](value: Future[A]): A = Await.result(value, 25.seconds)
  private def write(path: Path, value: JsValue): Unit =
    Files.write(path, Json.stringify(value).getBytes(UTF_8), StandardOpenOption.CREATE_NEW)
  private def checkedPath(text: String): Path = {
    val p = Paths.get(text)
    require(p.isAbsolute && p.normalize() == p && Files.isDirectory(p))
    var at = p
    while (at != null) { require(!Files.isSymbolicLink(at)); at = at.getParent }
    p
  }
  private final case class Response(status: Int, body: JsValue)
  private def readAll(socket: Socket): Array[Byte] = {
    val bytes = new ByteArrayOutputStream
    val buffer = new Array[Byte](8192)
    var count = socket.getInputStream.read(buffer)
    while (count != -1) {
      bytes.write(buffer, 0, count)
      require(bytes.size() <= 1024 * 1024, "bounded HTTP response required")
      count = socket.getInputStream.read(buffer)
    }
    bytes.toByteArray
  }
  private def response(bytes: Array[Byte]): Response = {
    val text = new String(bytes, UTF_8)
    val boundary = text.indexOf("\r\n\r\n")
    require(boundary > 0 && text.startsWith("HTTP/1.1 "), "complete HTTP response required")
    val headers = text.substring(0, boundary)
    require(!headers.toLowerCase(java.util.Locale.ROOT).contains("transfer-encoding:"), "strict generated JSON response required")
    val lengths = headers.split("\r\n").filter(_.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:"))
    require(lengths.length == 1 && lengths.head.dropWhile(_ != ':').drop(1).trim.toLong == bytes.length - boundary - 4,
      "complete HTTP Content-Length framing required")
    Response(headers.split(" ")(1).toInt, Json.parse(text.substring(boundary + 4)))
  }

  def main(args: Array[String]): Unit = {
    require(args.length == 3 && Set("exercise", "replay")(args(0)))
    require(System.getSecurityManager == null, "socket integration must run in a separate non-unit JVM")
    val network = new OwnedLoopbackOnly
    System.setSecurityManager(network)
    val mode = args(0)
    val root = checkedPath(args(1))
    val invocation = checkedPath(args(2))
    require(invocation.startsWith(root.resolve("runs")) && invocation != root.resolve("runs"))
    Files.createFile(invocation.resolve(".claim"))
    val resultPath = root.resolve("exercise.json")
    if (mode == "exercise") require(!Files.exists(resultPath) && !Files.exists(root.resolve("journal")))
    else require(Files.isRegularFile(resultPath) && Files.isDirectory(root.resolve("journal")))
    val serializers = ConfigFactory.parseResources("serialization.conf", ConfigParseOptions.defaults().setAllowMissing(false))
    def quote(value: String): String = Json.stringify(JsString(value))
    val raw = ConfigFactory.parseString(s"""
      akka.actor.provider = local
      akka.actor.allow-java-serialization = off
      akka.loglevel = WARNING
      akka.stdout-loglevel = WARNING
      akka.coordinated-shutdown.run-by-jvm-shutdown-hook = off
      akka.coordinated-shutdown.exit-jvm = off
      akka.persistence.journal.plugin = "akka.persistence.journal.leveldb"
      akka.persistence.journal.auto-start-journals = ["akka.persistence.journal.leveldb"]
      akka.persistence.journal.leveldb {
        class = "akka.persistence.journal.leveldb.LeveldbJournal"
        dir = ${quote(root.resolve("journal").toString)}
        native = false
        fsync = true
        checksum = true
      }
      akka.persistence.snapshot-store.plugin = "akka.persistence.snapshot-store.local"
      akka.persistence.snapshot-store.auto-start-snapshot-stores = ["akka.persistence.snapshot-store.local"]
      akka.persistence.snapshot-store.local.dir = ${quote(root.resolve("snapshots").toString)}
      akka.persistence.query.journal.leveldb.refresh-interval = 100ms
      play.http.secret.key = "owned-http-acceptance-not-production"
      play.application.loader = ""
      service.test-tier = "socket-integration"
    """).withFallback(serializers).withFallback(ConfigFactory.defaultReference()).resolve()
    require(raw.getString("akka.persistence.journal.plugin") == "akka.persistence.journal.leveldb" &&
      raw.getString("akka.persistence.snapshot-store.plugin") == "akka.persistence.snapshot-store.local" &&
      raw.getString("akka.actor.provider") == "local" && !raw.hasPath("service.connections") && !raw.hasPath("db.default.url"))
    val classic = akka.actor.ActorSystem("bank-http-acceptance", raw)
    implicit val system: ActorSystem[_] = classic.toTyped
    implicit val ec: ExecutionContext = system.executionContext
    implicit val timeout: Timeout = Timeout(5.seconds)
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    val jdbcExecutor = Executors.newFixedThreadPool(2)
    val clients = Executors.newFixedThreadPool(8)
    val lifecycle = new DefaultApplicationLifecycle
    var components = Option.empty[BankServiceComponents]
    var server = Option.empty[AkkaHttpServer]
    var runtime = Option.empty[BankRuntime]
    var journal = Option.empty[BankPersistenceJournal]
    var readside = Option.empty[BankReadside]
    var sip = Option.empty[BankSipApplication]
    try {
      val query = PersistenceQuery(classic).readJournalFor[LeveldbReadJournal](LeveldbReadJournal.Identifier)
      val namespace = "socketacceptance"
      val ids = new BankPersistenceIds(namespace)
      val durable = new BankPersistenceJournal(namespace, query, () => query.currentPersistenceIds())
      journal = Some(durable)
      val directory = new BankRuntime(namespace, durable, new ReconcileAuthorizer {
        def authorize(id: TransactionIdentity, token: String): Either[String, String] = Left("not requested")
      }, _ => throw new AssertionError("TA is outside this payment transport acceptance"))
      runtime = Some(directory)
      val investor = AccountId("alice"); val collection = AccountId("collection")
      // Port zero is selected by the actual listener, not by probing and releasing a port.
      @volatile var origin = "http://127.0.0.1:1"
      def configuration = BankDemoConfiguration("socket-v1", origin, Vector(
        BankDemoPrincipal("alice", investor, Set("customer"), "socket-alice", "csrf-alice"),
        BankDemoPrincipal("bob", AccountId("bob"), Set("customer"), "socket-bob", "csrf-bob"),
        BankDemoPrincipal("operator", AccountId("operator"), Set("operator"), "socket-operator", "csrf-operator")),
        Vector(BankFund("fund", collection)), Vector(
          BankSeed(investor, "CNY", Money(BigDecimal("1000.00"), "CNY")),
          BankSeed(AccountId("bob"), "CNY", Money(BigDecimal("0.00"), "CNY")),
          BankSeed(AccountId("operator"), "CNY", Money(BigDecimal("0.00"), "CNY")),
          BankSeed(collection, "CNY", Money(BigDecimal("0.00"), "CNY"))))
      val config = configuration
      val seeds = new BankSeedAuthority(durable)
      config.seeds.foreach(s => await(directory.account(s.accountId).flatMap(h => seeds.ensure(s, h))))
      val admission = new BankTrustedAdmission(config)
      val cash = new BankCashRequests(directory, config, admission, durable)
      val plans = new BankSipApplication(directory, durable, config, admission)
      sip = Some(plans)
      val data = new JdbcDataSource
      data.setURL("jdbc:h2:mem:socketacceptance;MODE=MySQL;DB_CLOSE_DELAY=-1")
      val views = new BankReadside(durable, config, data)(system, ExecutionContext.fromExecutor(jdbcExecutor))
      readside = Some(views)
      val recovery = new BankRecovery(directory, durable, config, cash, "not-exposed")
      val composition = new Composition {
        val authority = new Authority {
          def authenticate(request: play.api.mvc.RequestHeader) = new BankDemoAuthority(configuration).authenticate(request)
          def csrf(request: play.api.mvc.RequestHeader) = new BankDemoAuthority(configuration).csrf(request)
        }
        val bindings = BankServiceEndpoints.build(cash, views, plans, recovery)
        override val pages = Some(example.bankwealth.web.BankBrowserPages)
        val ready = Future.successful(())
        def close(): Unit = ()
      }
      val context = ApplicationLoader.Context(Environment(new File("."), getClass.getClassLoader, Mode.Test), Configuration(raw), lifecycle, None)
      val built = new BankServiceComponents(context, composition)
      components = Some(built)
      val running = AkkaHttpServer.fromApplication(built.application, ServerConfig(new File("."), Some(0), None,
        "127.0.0.1", Mode.Test, new java.util.Properties, Configuration(raw)))
      server = Some(running)
      val port = running.mainAddress.getPort
      network.register(port)
      origin = "http://127.0.0.1:" + port
      write(invocation.resolve("server.json"), Json.obj("pid" -> ProcessHandle.current().pid(), "port" -> port,
        "scope" -> "generated socket router + actual bank runtime + exclusive LevelDB + H2 projection; not production Factory/Mongo/MySQL"))
      def wire(method: String, path: String, body: String, role: Option[String], protection: Boolean): Array[Byte] = {
        val auth = role.map(r => "Authorization: Bearer socket-" + r + "\r\n").getOrElse("")
        val csrf = if (protection) role.map(r => "Origin: " + origin + "\r\nX-CSRF-Token: csrf-" + r + "\r\n").getOrElse("") else ""
        (s"$method $path HTTP/1.1\r\nHost: 127.0.0.1:$port\r\nConnection: close\r\nContent-Type: application/json\r\n" + auth + csrf +
          "Content-Length: " + body.getBytes(UTF_8).length + "\r\n\r\n" + body).getBytes(UTF_8)
      }
      def connect(destination: Int): Socket = {
        val socket = new Socket
        socket.connect(new InetSocketAddress("127.0.0.1", destination), 5000)
        socket.setSoTimeout(20000)
        socket
      }
      def send(method: String, path: String, body: String = "", role: Option[String] = Some("alice"), protection: Boolean = true): Response = {
        val socket = connect(port)
        try { socket.getOutputStream.write(wire(method, path, body, role, protection)); socket.getOutputStream.flush(); response(readAll(socket)) }
        finally socket.close()
      }
      def body(key: String, minor: String = "10000"): String = Json.stringify(Json.obj("clientRequestId" -> key, "fundCode" -> "fund",
        "amount" -> Json.obj("minorUnits" -> minor, "currency" -> "CNY")))
      def inventory(): JsObject = {
        val serialization = SerializationExtension(classic)
        val pids = await(query.currentPersistenceIds().runWith(Sink.seq)).toVector.filter(ids.owns).sorted
        JsObject(pids.map(pid => pid -> JsArray(await(durable.currentEvents(pid, 0)).map { row =>
          val event = row.event.asInstanceOf[AnyRef]
          val codec = serialization.findSerializerFor(event)
          Json.obj("sequence" -> row.sequenceNr, "serializer" -> codec.identifier, "manifest" -> Serializers.manifestFor(codec, event),
            "bytes" -> java.util.Base64.getEncoder.encodeToString(codec.toBinary(event)))
        })))
      }
      def caughtUp(): Unit = await(query.currentPersistenceIds().runWith(Sink.seq)).filter(ids.owns).foreach(pid => await(views.catchUp(pid)))
      def eventually(check: => Unit): Unit = {
        val deadline = System.nanoTime() + 20.seconds.toNanos
        var failure = Option.empty[Throwable]
        var done = false
        while (!done && System.nanoTime() < deadline) {
          try { check; done = true } catch { case e: AssertionError => failure = Some(e); Thread.sleep(25) }
        }
        if (!done) throw failure.getOrElse(new AssertionError("condition not reached"))
      }
      def original(key: String) = admission.cash(Principal("alice", Set("customer")), BankCashSubmit(key, "fund", MoneyWire("10000", "CNY"))).toOption.get
      def settled(key: String): Unit = {
        val payment = original(key).payment
        val handle = await(directory.order(payment.fundOrderId))
        eventually {
          assert(await(handle.ref.ask[FundOrderState](FundOrderAggregate.GetState)).cashPaymentFinalResults.values.toSet == Set("succeeded"))
          val events = await(durable.readAll(ids.paymentRun(payment.operationId)))
          assert(events.exists(_.isInstanceOf[PersistentMonarch.RunCompleted]))
        }
      }
      val cases = Vector.newBuilder[JsObject]
      val acknowledgements = scala.collection.mutable.Map.empty[String, JsValue]
      var raceMinor = ""
      def expectedOriginal(key: String, minor: String): BankCashOriginal = {
        require(Set("10000", "20000")(minor))
        BankCashOriginal("alice", key, "socket-v1", BankCashSubmit(key, "fund", MoneyWire(minor, "CNY")),
          BankPaymentOriginal(BankRequestIdentity.operation("alice", key), BankRequestIdentity.order("alice", key),
            investor, collection, "fund", Money(BigDecimal(if (minor == "10000") "100.00" else "200.00"), "CNY")))
      }
      def expectedAck(key: String, minor: String): JsObject = BankServiceJson.bankCashAcknowledgementWrites
        .writes(BankCashAcknowledgement(expectedOriginal(key, minor), "accepted"))
      if (mode == "exercise") {
        val before = inventory()
        val valid = body("forbidden")
        val denied = Vector(
          (send("POST", "/api/v1/cash-requests", valid, None), 401, "unauthenticated"),
          (send("POST", "/api/v1/cash-requests", valid, Some("operator")), 403, "operator-cannot-purchase"),
          (send("POST", "/api/v1/cash-requests", valid, protection = false), 403, "csrf"),
          (send("POST", "/api/v1/operations/not-existing/reconcile", "{}"), 403, "customer-cannot-reconcile"))
        denied.foreach { case (r, expected, name) => require(r.status == expected); cases += Json.obj("case" -> name, "status" -> r.status) }
        Vector("principalId", "roles", "accountId", "investorAccountId", "fundCollectionAccountId", "taReceipt", "forcedResult", "refundDestination", "authorization", "transactionId").foreach { field =>
          val r = send("POST", "/api/v1/cash-requests", Json.stringify(Json.parse(valid).as[JsObject] + (field -> JsString("injected"))))
          require(r.status == 400); cases += Json.obj("case" -> ("reject-" + field), "status" -> r.status)
        }
        val duplicate = send("POST", "/api/v1/cash-requests", valid.dropRight(1) + ",\"clientRequestId\":\"second\"}")
        require(duplicate.status == 400)
        require(inventory() == before, "rejected HTTP requests appended real journal events")
        cases += Json.obj("case" -> "all-rejections-zero-journal-events", "before" -> before, "after" -> inventory())

        val listener = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        network.register(listener.getLocalPort)
        listener.setSoTimeout(10000)
        val requestBytes = wire("POST", "/api/v1/cash-requests", body("lost"), Some("alice"), true)
        val forwarded = clients.submit(new Callable[Array[Byte]] {
          def call(): Array[Byte] = {
            val downstream = listener.accept()
            downstream.setSoTimeout(10000)
            try {
              val actual = downstream.getInputStream.readNBytes(requestBytes.length)
              require(java.util.Arrays.equals(actual, requestBytes))
              val upstream = connect(port)
              try { upstream.getOutputStream.write(actual); upstream.getOutputStream.flush(); readAll(upstream) }
              finally upstream.close()
            } finally downstream.close()
          }
        })
        val downstream = connect(listener.getLocalPort)
        val lost = try {
          downstream.getOutputStream.write(requestBytes); downstream.getOutputStream.flush()
          require(readAll(downstream).isEmpty, "lost-response client must receive zero HTTP bytes")
          response(forwarded.get(25, TimeUnit.SECONDS))
        } finally { downstream.close(); listener.close() }
        require(lost.status == 200 && lost.body == expectedAck("lost", "10000"))
        acknowledgements("lost") = lost.body
        settled("lost")
        val durableBeforeRetry = inventory()
        val retry = send("POST", "/api/v1/cash-requests", body("lost"))
        require(retry == lost && inventory() == durableBeforeRetry, "HTTP retry changed original acknowledgement or persistent events")
        cases += Json.obj("case" -> "actual-socket-response-loss", "upstreamStatus" -> lost.status, "clientResponseBytes" -> 0,
          "retriedAcknowledgement" -> retry.body, "noNewEvents" -> true)

        def concurrent(key: String, amounts: Vector[String]): Vector[Response] = {
          val ready = new CountDownLatch(amounts.size)
          val release = new CountDownLatch(1)
          val calls = amounts.map(amount => clients.submit(new Callable[Response] {
            def call(): Response = { ready.countDown(); require(release.await(10, TimeUnit.SECONDS)); send("POST", "/api/v1/cash-requests", body(key, amount)) }
          }))
          require(ready.await(10, TimeUnit.SECONDS)); release.countDown()
          calls.map(_.get(25, TimeUnit.SECONDS))
        }
        val same = concurrent("same", Vector.fill(8)("10000"))
        require(same.forall(r => r.status == 200 && r.body == expectedAck("same", "10000")))
        acknowledgements("same") = same.head.body
        settled("same")
        cases += Json.obj("case" -> "eight-concurrent-identical", "statuses" -> same.map(_.status), "acknowledgement" -> same.head.body)
        val race = concurrent("race", Vector.fill(4)("10000") ++ Vector.fill(4)("20000"))
        require(race.count(_.status == 200) == 4 && race.count(_.status == 409) == 4 && race.filter(_.status == 200).map(_.body).distinct.size == 1)
        require(race.take(4).map(_.status).distinct.size == 1 && race.drop(4).map(_.status).distinct.size == 1)
        raceMinor = if (race.head.status == 200) "10000" else "20000"
        require(race.filter(_.status == 200).forall(_.body == expectedAck("race", raceMinor)))
        acknowledgements("race") = race.find(_.status == 200).get.body
        settled("race")
        cases += Json.obj("case" -> "eight-concurrent-conflicting", "statuses" -> race.map(_.status), "acknowledgement" -> race.find(_.status == 200).get.body)
      }
      val saved = if (mode == "replay") Some(Json.parse(Files.readAllBytes(resultPath))) else None
      saved.foreach { value =>
        raceMinor = (value \ "raceMinor").as[String]
        acknowledgements ++= (value \ "acknowledgements").as[JsObject].value
      }
      require(Set("10000", "20000")(raceMinor))
      val keys = Vector("lost", "same", "race")
      val originals = keys.map(key => key -> expectedOriginal(key, if (key == "race") raceMinor else "10000")).toMap
      originals.foreach { case (key, expected) =>
        require(await(cash.getOriginal(Principal("alice", Set("customer")), key)) == Right(expected))
        require(acknowledgements(key) == expectedAck(key, expected.request.amount.minorUnits))
      }
      keys.foreach(settled)
      val expectedPids = (config.seeds.map(s => ids.account(s.accountId)) ++ originals.values.toVector.flatMap(o =>
        Vector(ids.order(o.payment.fundOrderId), ids.paymentSaga(o.payment.operationId), ids.paymentHost(o.payment.operationId), ids.paymentRun(o.payment.operationId)))).sorted
      def assertAdmissions(): Unit = {
        require(await(query.currentPersistenceIds().runWith(Sink.seq)).toVector.sorted == expectedPids,
          "only seeded accounts and the three original payment graphs may persist")
        originals.values.foreach { o =>
          val events = await(durable.readPb(ids.order(o.payment.fundOrderId)))
          require(events.collect { case p: FundOrderCashRequestSourceRecordedPB => DomainConverters.decodeFundOrderCashRequestSourceRecordedPB(p) } ==
            Vector(FundOrderProtocol.CashRequestSourceRecorded(o, Some(o))))
          require(events.collect { case p: FundOrderFundPurchaseSettlementRequestedPB => DomainConverters.decodeFundOrderFundPurchaseSettlementRequestedPB(p) } ==
            Vector(FundOrderProtocol.FundPurchaseSettlementRequested(o.payment.operationId, o.payment.fundOrderId, investor, collection, "fund", o.payment.amount)))
          val runs = await(durable.readAll(ids.paymentRun(o.payment.operationId)))
          val starts = runs.collect { case p: PersistentMonarch.RunStarted => p }
          val expectedState = Cash.State(Cash.Inputs(o.payment.operationId, o.payment.operationId, investor, o.payment.fundOrderId, collection, o.payment.amount, "fund"))
          require(starts.size == 1 && starts.head.runId == o.payment.operationId.value && Cash.codec.decode(starts.head.initialSnapshot) == expectedState)
          require(runs.count(_.isInstanceOf[PersistentMonarch.StageDone]) == 1 && runs.count(_.isInstanceOf[PersistentMonarch.RunCompleted]) == 1 && runs.size == 3)
        }
      }
      assertAdmissions()
      val stable = inventory()
      originals.foreach { case (key, value) =>
        val r = send("POST", "/api/v1/cash-requests", body(key, value.request.amount.minorUnits))
        require(r.status == 200 && r.body == acknowledgements(key))
        val other = if (value.request.amount.minorUnits == "10000") "20000" else "10000"
        require(send("POST", "/api/v1/cash-requests", body(key, other)).status == 409)
      }
      require(inventory() == stable, "re-entry appended journal events")
      saved.foreach(p => require((p \ "journal").as[JsObject] == stable, "new JVM changed complete persistent history"))
      caughtUp()
      val queries = keys.map { key =>
        val r = send("GET", "/api/v1/cash-requests/" + key)
        require(r.status == 200)
        val other = send("GET", "/api/v1/cash-requests/" + key, role = Some("bob"))
        val absent = BankCashRequestResponse(BankReadMetadata("bank-query-v1", "unknown", Vector.empty), None)
        require(other.status == 200 && other.body == BankServiceJson.bankCashRequestResponseWrites.writes(absent),
          "same client key must return only the other principal's empty view")
        require(send("GET", "/api/v1/orders/" + originals(key).payment.fundOrderId.value, role = Some("bob")).status == 403,
          "another principal must not retrieve Alice's order")
        key -> r.body
      }.toMap
      saved.foreach(p => require((p \ "queries").as[JsObject] == JsObject(queries), "new JVM original HTTP response differs"))
      val expected = BigDecimal(if (raceMinor == "10000") "300.00" else "400.00")
      originals.foreach { case (key, value) =>
        require((queries(key) \ "request" \ "original").as[JsObject] == BankServiceJson.bankCashAcknowledgementWrites
          .writes(BankCashAcknowledgement(value, "accepted")).value("original"))
      }
      val investorState = await(directory.account(investor).flatMap(_.ref.ask[CreditBalanceState](CreditBalanceAggregate.GetState)))
      val collectionState = await(directory.account(collection).flatMap(_.ref.ask[CreditBalanceState](CreditBalanceAggregate.GetState)))
      require(investorState.accountBalance("CNY") == Money(BigDecimal(1000) - expected, "CNY"))
      require(collectionState.accountBalance("CNY") == Money(expected, "CNY"))
      val moneyEvents = await(durable.readPb(ids.account(investor)))
      require(moneyEvents.count(_.isInstanceOf[CreditBalanceReserveFundsConfirmedPB]) == 3 && moneyEvents.count(_.isInstanceOf[CreditBalanceDeductFundsConfirmedPB]) == 3)
      assertAdmissions()
      require(inventory() == stable, "queries caused persistent writes")
      val report = Json.obj("schemaVersion" -> "bank-http-acceptance/v1", "mode" -> mode, "pid" -> ProcessHandle.current().pid(),
        "raceMinor" -> raceMinor, "acknowledgements" -> JsObject(acknowledgements.toSeq),
        "cases" -> cases.result(), "journal" -> stable, "queries" -> JsObject(queries), "paymentCount" -> 3,
        "investor" -> investorState.accountBalance("CNY").amount.toString, "collection" -> collectionState.accountBalance("CNY").amount.toString,
        "replayBytesEqual" -> saved.isDefined, "scope" -> "payment transport; no TA completion, Mongo/MySQL, or production Factory certification")
      if (mode == "exercise") write(resultPath, report)
      write(invocation.resolve("result.json"), report)
    } finally {
      try server.foreach(_.stop()) finally {
        try await(lifecycle.stop()) finally {
          try components.foreach(c => await(c.actorSystem.terminate())) finally {
            try readside.foreach(_.close()) finally {
              try sip.foreach(_.close()) finally {
                try runtime.foreach(_.close()) finally {
                  try journal.foreach(_.close()) finally {
                    try await(classic.terminate()) finally {
                      clients.shutdown(); jdbcExecutor.shutdown()
                      require(clients.awaitTermination(30, TimeUnit.SECONDS) && jdbcExecutor.awaitTermination(30, TimeUnit.SECONDS))
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    write(invocation.resolve("closed.json"), Json.obj("pid" -> ProcessHandle.current().pid(), "closed" -> true))
    println("BANK-HTTP-ACCEPTANCE " + mode + " passed")
  }
}
