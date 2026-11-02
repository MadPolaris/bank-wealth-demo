package example.bankwealth.readside

import akka.Done
import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.adapter._
import akka.serialization.{SerializationExtension, Serializers}
import akka.stream.{KillSwitches, Materializer, SharedKillSwitch, SystemMaterializer}
import akka.stream.scaladsl.Sink
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto.{CreditBalanceStatePB, FundOrderStatePB, SipPlanStatePB, SipOccurrencePB}
import example.bankwealth.infrastructure.serialization._
import example.bankwealth.integration._
import example.bankwealth.security.{BankDemoConfiguration, BankDemoPrincipal}
import example.bankwealth.service.BankServiceService._
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.{Connection, PreparedStatement, ResultSet}
import javax.sql.DataSource
import scalapb.GeneratedMessage
import scala.collection.mutable
import scala.concurrent.{blocking, Await, ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import scala.util.control.NonFatal

/** A disposable JDBC projection, never a write-side authority.
  * Domain PBs are decoded by the GENERATED adapters/converters and folded by the GENERATED
  * event handlers. Persisted snapshots are those same generated state PBs. Cross-PID joins
  * are resolved at read time; there is deliberately no fabricated global journal order.
  * Supply a blocking JDBC execution context. close() cancels only owned subscriptions,
  * not the shared journal, DataSource, or ActorSystem.
  */
final class BankReadside(journal: BankJournal, config: BankDemoConfiguration, dataSource: DataSource)
    (implicit system: ActorSystem[_], ec: ExecutionContext) extends BankReadQueries with AutoCloseable {
  require(journal != null && config != null && dataSource != null)
  private val ids = new BankPersistenceIds(journal.namespace)
  private val namespace = journal.namespace
  private implicit val materializer: Materializer = SystemMaterializer(system).materializer
  private val serialization = SerializationExtension(system.toClassic)
  private val stop: SharedKillSwitch = KillSwitches.shared("bank-readside-" + namespace)
  private val watches = mutable.Map.empty[String, Future[Done]] // subscription handles only
  private var discovery: Option[Future[Done]] = None
  private var poll: Option[akka.actor.Cancellable] = None
  private var closed = false
  private var initialized: Option[Future[Unit]] = None
  private var pendingWork = 0
  private val drained = Promise[Unit]()
  private var shutdownResult = Option.empty[Future[Unit]]

  private def tracked[A]()(work: => Future[A]): Future[A] = synchronized {
    if (closed) Future.failed(new IllegalStateException("readside is closed"))
    else {
      pendingWork += 1
      val result = try work catch { case NonFatal(error) => Future.failed(error) }
      result.transform { outcome =>
        synchronized {
          pendingWork -= 1
          if (closed && pendingWork == 0) drained.trySuccess(())
        }
        outcome
      }(ExecutionContext.parasitic)
    }
  }

  private final case class Row(pid: String, kind: String, resource: String, account: Option[String],
      principal: Option[String], last: Long, observed: Option[Long], payload: Option[Array[Byte]])
  private final case class Payload(kind: String, manifest: String, bytes: Array[Byte])
  private final case class Denied(failure: Failure) extends RuntimeException

  private def hash(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.getBytes(StandardCharsets.UTF_8)).map(b => f"${b & 0xff}%02x").mkString

  private def identity(pid: String): (String, String) = {
    require(ids.owns(pid), "foreign journal namespace")
    val parts = pid.substring(ids.prefix.length).split("/", -1)
    require(parts.length == 2, "invalid persistence identity")
    val value = new String(java.util.Base64.getUrlDecoder.decode(parts(1)), StandardCharsets.UTF_8)
    val canonical = parts(0) match {
      case "account" => ids.account(AccountId(value))
      case "order" => ids.order(FundOrderId(value))
      case "plan" => ids.plan(PlanId(value))
      case "payment-saga" => ids.paymentSaga(OperationId(value))
      case "payment-host" => ids.paymentHost(OperationId(value))
      case "payment-run" => ids.paymentRun(OperationId(value))
      case "refund-saga" => ids.refundSaga(OperationId(value))
      case "refund-host" => ids.refundHost(OperationId(value))
      case "refund-run" => ids.refundRun(OperationId(value))
      case "ta-host" => ids.taHost(TaRequestId(value))
      case "ta-run" => ids.taRun(TaRequestId(value))
      case "sip-host" => ids.sipHost(OccurrenceId(value))
      case "sip-run" => ids.sipRun(OccurrenceId(value))
      case _ => throw new IllegalArgumentException("unrecognized bank persistence kind")
    }
    require(canonical == pid, "noncanonical persistence identity")
    parts(0) -> value
  }

  private def bind(s: PreparedStatement, values: Seq[Any]): Unit = values.zipWithIndex.foreach {
    case (None, i) => s.setNull(i + 1, java.sql.Types.NULL)
    case (Some(value), i) => bindOne(s, i + 1, value)
    case (value, i) => bindOne(s, i + 1, value)
  }
  private def bindOne(s: PreparedStatement, i: Int, value: Any): Unit = value match {
    case b: Array[Byte] => s.setBytes(i, b)
    case l: Long => s.setLong(i, l)
    case n: Int => s.setInt(i, n)
    case b: Boolean => s.setBoolean(i, b)
    case text: String => s.setString(i, text)
    case _ => throw new IllegalArgumentException("unsupported JDBC parameter")
  }
  private def update(c: Connection, sql: String, values: Any*): Int = {
    val s = c.prepareStatement(sql)
    try { bind(s, values); s.executeUpdate() } finally s.close()
  }
  private def select[A](c: Connection, sql: String, values: Seq[Any])(read: ResultSet => A): Vector[A] = {
    val s = c.prepareStatement(sql)
    try {
      bind(s, values)
      val r = s.executeQuery()
      try { val b = Vector.newBuilder[A]; while (r.next()) b += read(r); b.result() } finally r.close()
    } finally s.close()
  }
  private def transaction[A](write: Boolean)(f: Connection => A): A = blocking {
    val c = dataSource.getConnection
    try {
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      c.setAutoCommit(false)
      if (write) {
        val versions = select(c, "SELECT schema_version FROM bank_read_namespace WHERE namespace=? FOR UPDATE", Seq(namespace))(_.getString(1))
        require(versions == Vector(BankReadsideSchema.version), "read schema namespace is not installed")
      }
      try { val result = f(c); c.commit(); result }
      catch { case NonFatal(e) => c.rollback(); throw e }
    } finally c.close()
  }

  def initialize(): Future[Unit] = synchronized {
    require(!closed, "readside is closed")
    initialized.getOrElse {
      val ready = Future(blocking {
        val c = dataSource.getConnection
        try {
          BankReadsideSchema.statements.foreach { sql =>
            val s = c.createStatement(); try s.execute(sql) finally s.close()
          }
          val present = select(c, "SELECT schema_version FROM bank_read_namespace WHERE namespace=?", Seq(namespace))(_.getString(1))
          if (present.isEmpty) {
            try update(c, "INSERT INTO bank_read_namespace(namespace,schema_version) VALUES (?,?)", namespace, BankReadsideSchema.version)
            catch { case e: java.sql.SQLException if Option(e.getSQLState).exists(_.startsWith("23")) => () }
          }
          require(select(c, "SELECT schema_version FROM bank_read_namespace WHERE namespace=?", Seq(namespace))(_.getString(1)) == Vector(BankReadsideSchema.version), "incompatible read schema")
        } finally c.close()
      })
      initialized = Some(ready)
      ready
    }
  }

  private def readRow(r: ResultSet): Row = {
    val observed = r.getLong("observed_sequence")
    val high = if (r.wasNull()) None else Some(observed)
    Row(r.getString("persistence_id"), r.getString("kind"), r.getString("resource_id"),
      Option(r.getString("owner_account")), Option(r.getString("owner_principal")),
      r.getLong("last_sequence"), high, Option(r.getBytes("state_payload")))
  }
  private def row(c: Connection, pid: String): Option[Row] = {
    val result = select(c, "SELECT * FROM bank_read_stream WHERE namespace=? AND pid_key=?", Seq(namespace, hash(pid)))(readRow).headOption
    result.foreach(r => require(r.pid == pid, "PID digest collision"))
    result
  }
  private def ensureRow(c: Connection, pid: String): Row = row(c, pid).getOrElse {
    val (kind, resource) = identity(pid)
    update(c, "INSERT INTO bank_read_stream(namespace,pid_key,persistence_id,kind,resource_id,last_sequence) VALUES (?,?,?,?,?,0)", namespace, hash(pid), pid, kind, resource)
    Row(pid, kind, resource, None, None, 0L, None, None)
  }
  private def payload(event: Any): Payload = event match {
    case p: GeneratedMessage => Payload(p.getClass.getName, p.getClass.getSimpleName, p.toByteArray)
    case ref: AnyRef =>
      // Includes the ORIGINAL PersistentMonarch RunStarted. No toString/Java-serialization
      // fallback: missing configured serialization fails closed, leaving the checkpoint.
      val serializer = serialization.findSerializerFor(ref)
      Payload(ref.getClass.getName, serializer.identifier.toString + ":" + Serializers.manifestFor(serializer, ref), serializer.toBinary(ref))
    case _ => throw new IllegalArgumentException("journal event must be serializable")
  }
  private def accountState(r: Row): CreditBalanceState = r.payload.map(p => DomainConverters.decodeCreditBalanceStatePB(CreditBalanceStatePB.parseFrom(p)))
    .getOrElse(CreditBalanceState.empty.copy(id = AccountId(r.resource)))
  private def orderState(r: Row): FundOrderState = r.payload.map(p => DomainConverters.decodeFundOrderStatePB(FundOrderStatePB.parseFrom(p)))
    .getOrElse(FundOrderState.empty.copy(id = FundOrderId(r.resource)))
  private def planState(r: Row): SipPlanState = r.payload.map(p => DomainConverters.decodeSipPlanStatePB(SipPlanStatePB.parseFrom(p)))
    .getOrElse(SipPlanState.empty.copy(id = PlanId(r.resource)))

  private def folded(r: Row, event: Any): (Option[Array[Byte]], Option[String], Option[String]) = r.kind match {
    case "account" =>
      val p = event match { case pb: GeneratedMessage => pb; case _ => throw new IllegalArgumentException("account journal must contain PB") }
      val next = CreditBalanceEventAdapter.fromJournal(p, p.getClass.getSimpleName).events.foldLeft(accountState(r)) { (state, event) =>
        // Correlate journal facts to their PID; do not rerun command-side funds guards.
        val resource = event match {
          case e: CreditBalanceProtocol.AccountInitialized => e.resource
          case e: CreditBalanceProtocol.ReserveFundsConfirmed => e.resource
          case e: CreditBalanceProtocol.DeductFundsConfirmed => e.resource
          case e: CreditBalanceProtocol.ReleaseReservedFundsConfirmed => e.resource
          case e: CreditBalanceProtocol.RecordIncomingCreditsConfirmed => e.resource
          case e: CreditBalanceProtocol.CommitIncomingCreditsConfirmed => e.resource
          case e: CreditBalanceProtocol.CancelIncomingCreditConfirmed => e.resource
        }
        require(resource.value == r.resource, "account event identity mismatch")
        CreditBalanceEventHandler(state, event)
      }
      require(next.id.value == r.resource, "account identity mismatch")
      (Some(DomainConverters.encodeCreditBalanceStatePB(next).toByteArray), Some(r.resource), None)
    case "order" =>
      val p = event match { case pb: GeneratedMessage => pb; case _ => throw new IllegalArgumentException("order journal must contain PB") }
      val next = FundOrderEventAdapter.fromJournal(p, p.getClass.getSimpleName).events.foldLeft(orderState(r))(FundOrderEventHandler.apply)
      require(next.id.value == r.resource, "order identity mismatch")
      next.cashRequestSource.foreach { source =>
        require(source.payment.fundOrderId.value == r.resource, "cash source identity mismatch")
        new BankTrustedAdmission(config).validateCash(source)
      }
      val owner = next.cashRequestSource.map(_.payment.investorAccountId.value).orElse(text(next.investorAccountId.value))
      val principal = next.cashRequestSource.map(_.principalId)
      require(r.account.isEmpty || owner.isEmpty || r.account == owner, "order owner conflict")
      require(r.principal.isEmpty || principal.isEmpty || r.principal == principal, "order principal conflict")
      (Some(DomainConverters.encodeFundOrderStatePB(next).toByteArray), owner.orElse(r.account), principal.orElse(r.principal))
    case "plan" =>
      val p = event match { case pb: GeneratedMessage => pb; case _ => throw new IllegalArgumentException("plan journal must contain PB") }
      val next = SipPlanEventAdapter.fromJournal(p, p.getClass.getSimpleName).events.foldLeft(planState(r))(SipPlanEventHandler.apply)
      require(next.id.value.isEmpty || next.id.value == r.resource, "plan identity mismatch")
      next.createIntent.foreach { source =>
        require(source.planId.value == r.resource, "SIP intent identity mismatch")
        new BankTrustedAdmission(config).validateSip(source)
      }
      val owner = next.createIntent.map(_.config.investorAccountId.value)
        .orElse(next.revisions.get(next.latestRevision).map(_.investorAccountId.value))
      val principal = next.createIntent.map(_.principalId)
      require(r.account.isEmpty || owner.isEmpty || r.account == owner, "plan owner conflict")
      require(r.principal.isEmpty || principal.isEmpty || r.principal == principal, "plan principal conflict")
      (Some(DomainConverters.encodeSipPlanStatePB(next).toByteArray), owner.orElse(r.account), principal.orElse(r.principal))
    case _ => (None, None, None) // technical events retained exactly; never infer financial success from them
  }
  private def text(value: String): Option[String] = Option(value).filter(_.nonEmpty)
  private def paymentStatus(s: FundOrderState): String = s.cashPaymentFinalResults.get(s.selectedPaymentTxId)
    .orElse(text(s.paymentOutcome)).getOrElse(if (s.status == "new") "intent-recorded" else s.status)
  private def taStatus(s: FundOrderState): String = text(s.taStatus).getOrElse("not-submitted")
  private def refundStatus(s: FundOrderState): String = text(s.refundOutcome)
    .getOrElse(if (s.taStatus == "rejected" && paymentStatus(s) == "succeeded") "refund-in-progress" else "not-required")

  private def pendingPut(c: Connection, value: BankPendingOperationView, pid: String): Unit = {
    update(c, "DELETE FROM bank_read_pending WHERE namespace=? AND operation_key=? AND flow=?", namespace, hash(value.operationId.value), value.flow)
    update(c, "INSERT INTO bank_read_pending(namespace,operation_key,flow,operation_id,order_id,plan_id,occurrence_id,source_pid,phase,status,recoverable) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      namespace, hash(value.operationId.value), value.flow, value.operationId.value, value.orderId.map(_.value), value.planId.map(_.value), value.occurrenceId.map(_.value), pid, value.phase, value.status, value.recoverable)
  }
  private def pendingDelete(c: Connection, op: OperationId, flow: String): Unit =
    { update(c, "DELETE FROM bank_read_pending WHERE namespace=? AND operation_key=? AND flow=?", namespace, hash(op.value), flow); () }
  private def indexes(c: Connection, r: Row): Unit = r.kind match {
    case "order" =>
      val s = orderState(r)
      val op = text(s.operationId.value).map(OperationId.apply).orElse(s.cashRequestSource.map(_.payment.operationId))
      op.foreach { operation =>
        val payment = paymentStatus(s)
        if (!Set("succeeded", "rejected-before-effects", "compensated")(payment))
          pendingPut(c, BankPendingOperationView(operation, "payment", Some(FundOrderId(r.resource)), None, None, "payment", payment, true), r.pid)
        else pendingDelete(c, operation, "payment")
        if (payment == "succeeded" && !Set("confirmed", "rejected")(taStatus(s)))
          pendingPut(c, BankPendingOperationView(operation, "ta", Some(FundOrderId(r.resource)), None, None, "ta", taStatus(s), true), r.pid)
        else pendingDelete(c, operation, "ta")
      }
      text(s.refundOperationId.value).map(OperationId.apply).foreach { operation =>
        if (refundStatus(s) != "succeeded") pendingPut(c, BankPendingOperationView(operation, "refund", Some(FundOrderId(r.resource)), None, None, "refund", refundStatus(s), true), r.pid)
        else pendingDelete(c, operation, "refund")
      }
    case "plan" =>
      val s = planState(r)
      s.occurrences.toVector.sortBy(_._1).foreach { case (due, occurrence) =>
        require(occurrence.planId.value == r.resource && r.account.contains(occurrence.config.investorAccountId.value), "occurrence ownership mismatch")
        update(c, "DELETE FROM bank_read_occurrence WHERE namespace=? AND plan_key=? AND due_slot=?", namespace, hash(r.pid), due)
        update(c, "INSERT INTO bank_read_occurrence(namespace,plan_key,due_slot,occurrence_key,order_key,owner_account,occurrence_payload) VALUES (?,?,?,?,?,?,?)",
          namespace, hash(r.pid), due, hash(occurrence.occurrenceId.value), hash(ids.order(occurrence.fundOrderId)), occurrence.config.investorAccountId.value, DomainConverters.encodeSipOccurrencePB(occurrence).toByteArray)
        if (!s.firstTerminals.contains(occurrence.occurrenceId))
          pendingPut(c, BankPendingOperationView(occurrence.operationId, "sip-dispatch", Some(occurrence.fundOrderId), Some(occurrence.planId), Some(occurrence.occurrenceId), "installment", s.occurrenceProgress.getOrElse(occurrence.occurrenceId, "pending"), true), r.pid)
        else pendingDelete(c, occurrence.operationId, "sip-dispatch")
      }
    case _ => ()
  }

  /** Public delivery seam for the journal driver and real-PB tests. One transaction covers
    * exact duplicate detection, generated state/indexes and the contiguous checkpoint.
    * A gap is rejected, not buffered and not acknowledged. Replay from the checkpoint fixes it.
    */
  def project(envelope: BankJournalEnvelope): Future[Unit] = {
    identity(envelope.persistenceId) // reject before any JDBC access
    tracked() { initialize().flatMap { _ => Future(transaction(write = true) { c =>
      val r = ensureRow(c, envelope.persistenceId)
      val p = payload(envelope.event)
      val old = select(c, "SELECT payload_type,payload_manifest,payload FROM bank_read_event WHERE namespace=? AND pid_key=? AND sequence_nr=?",
        Seq(namespace, hash(r.pid), envelope.sequenceNr))(x => Payload(x.getString(1), x.getString(2), x.getBytes(3))).headOption
      old match {
        case Some(existing) => require(existing.kind == p.kind && existing.manifest == p.manifest && java.util.Arrays.equals(existing.bytes, p.bytes), "conflicting journal sequence/payload")
        case None =>
          require(envelope.sequenceNr == Math.addExact(r.last, 1L), "noncontiguous journal sequence")
          val (state, account, principal) = folded(r, envelope.event)
          update(c, "INSERT INTO bank_read_event(namespace,pid_key,sequence_nr,payload_type,payload_manifest,payload) VALUES (?,?,?,?,?,?)",
            namespace, hash(r.pid), envelope.sequenceNr, p.kind, p.manifest, p.bytes)
          update(c, "UPDATE bank_read_stream SET state_payload=?,owner_account=?,owner_principal=?,last_sequence=?,observed_sequence=NULL WHERE namespace=? AND pid_key=?",
            state, account, principal, envelope.sequenceNr, namespace, hash(r.pid))
          indexes(c, r.copy(account = account, principal = principal, last = envelope.sequenceNr, observed = None, payload = state))
      }
      ()
    }) } }
  }

  private def checkpoint(pid: String): Future[Long] = Future(transaction(write = false)(c => row(c, pid).map(_.last).getOrElse(0L)))
  /** A bounded currentEvents query is an observed per-PID frontier, not a global offset.
    * Any later live delivery invalidates that frontier. A concurrent projection ahead of
    * this sample stays unknown, rather than claiming the stale sample is current.
    */
  def catchUp(pid: String): Future[Unit] = tracked() {
    identity(pid)
    initialize().flatMap(_ => checkpoint(pid)).flatMap { after =>
      journal.currentEvents(pid, after).flatMap { events =>
        require(events.forall(_.persistenceId == pid), "foreign PID returned by journal")
        events.foldLeft(Future.successful(()))((done, e) => done.flatMap(_ => project(e))).flatMap { _ =>
          val high = events.lastOption.map(_.sequenceNr).getOrElse(after)
          Future(transaction(write = true) { c =>
            val r = ensureRow(c, pid)
            require(high <= r.last, "frontier cannot jump checkpoint")
            update(c, "UPDATE bank_read_stream SET observed_sequence=? WHERE namespace=? AND pid_key=?",
              if (r.last == high) Some(high) else None, namespace, hash(pid))
            ()
          })
        }
      }
    }
  }
  private def watch(pid: String): Unit = synchronized {
    if (!closed && !watches.contains(pid)) {
      identity(pid)
      val running = tracked() {
        journal.events(pid, 0L).via(stop.flow).mapAsync(1)(project).runWith(Sink.ignore)
          .transformWith(_ => invalidate(pid).map(_ => Done))
      }
      watches.put(pid, running)
      running.onComplete { _ => synchronized { watches.remove(pid) } }(ExecutionContext.parasitic)
    }
  }
  private def invalidate(pid: String): Future[Unit] = Future(transaction(write = true) { c =>
    update(c, "UPDATE bank_read_stream SET observed_sequence=NULL WHERE namespace=? AND pid_key=?", namespace, hash(pid)); ()
  })
  private def discover(): Future[Done] = tracked() {
    journal.persistenceIds().via(stop.flow).runForeach(watch)
  }
  def start(): Future[Unit] = tracked() { initialize().map { _ => synchronized {
    require(!closed, "readside is closed")
    if (discovery.isEmpty) {
      discovery = Some(discover())
      // Discovery may be an infinite source. Never await its completion as startup readiness.
      poll = Some(system.scheduler.scheduleWithFixedDelay(Duration.Zero, 2.seconds)(new Runnable {
        def run(): Unit = BankReadside.this.synchronized {
          if (!closed) {
            discover()
            watches.keys.toVector.foreach { pid =>
              tracked() { catchUp(pid).recoverWith { case NonFatal(_) => invalidate(pid) } }
            }
          }
        }
      })(ec))
    }
    ()
  } } }
  def shutdown(): Future[Unit] = synchronized {
    shutdownResult.getOrElse {
      closed = true
      poll.foreach(_.cancel())
      stop.shutdown()
      if (pendingWork == 0) drained.trySuccess(())
      val result = drained.future.flatMap { _ =>
        initialized match {
          case None => Future.successful(())
          case Some(ready) => ready.flatMap { _ => Future(transaction(write = true) { c =>
            update(c, "UPDATE bank_read_stream SET observed_sequence=NULL WHERE namespace=?", namespace); ()
          }) }
        }
      }
      shutdownResult = Some(result)
      result
    }
  }
  def close(): Unit = { Await.result(shutdown(), 20.seconds); () }

  private def customer(p: Principal): Either[Failure, BankDemoPrincipal] =
    if (p == null) Left(NotAuthenticated) else config.customer(p).toRight(NotAuthorized)
  private def query[A](p: Principal)(f: (Connection, BankDemoPrincipal) => A): Future[Outcome[A]] = customer(p) match {
    case Left(error) => Future.successful(Left(error))
    case Right(who) => tracked() { Future {
      try Right(transaction(write = false)(c => f(c, who)))
      catch { case Denied(error) => Left(error); case NonFatal(_) => Left(Unavailable) }
    } }
  }
  private def validPage(limit: Long, after: Long): Unit =
    if (limit < 1L || limit > 100L || after < 0L || after > Int.MaxValue.toLong - limit) throw Denied(InvalidRequest)

  /** Read only ownership columns first. No business payload or checkpoint is fetched until
    * the configured principal/account is proved to own it. Orphans stay genuinely unknown.
    */
  private def owned(c: Connection, pid: String, who: BankDemoPrincipal): Option[Row] = {
    val owners = select(c, "SELECT persistence_id,owner_account,owner_principal FROM bank_read_stream WHERE namespace=? AND pid_key=?",
      Seq(namespace, hash(pid)))(r => (r.getString(1), Option(r.getString(2)), Option(r.getString(3)))).headOption
    owners match {
      case None => None
      case Some((actual, account, principal)) =>
        require(actual == pid, "PID digest collision")
        if (account.exists(_ != who.accountId.value) || principal.exists(_ != who.id)) throw Denied(NotAuthorized)
        if (account.isEmpty) None else row(c, pid)
    }
  }
  private def metadata(rows: Vector[Row], completeSet: Boolean = true, absent: Boolean = false): BankReadMetadata = {
    val marks = rows.distinct.map { r =>
      val disposition = r.observed match {
        case Some(high) if high == r.last => "caught-up"
        case Some(high) if high > r.last => "catching-up"
        case _ => "unknown"
      }
      BankProjectionWatermark(r.pid, r.last, r.observed, disposition)
    }.sortBy(_.persistenceId)
    val caught = completeSet && marks.nonEmpty && marks.forall(_.disposition == "caught-up")
    BankReadMetadata(BankReadsideSchema.version, if (caught && absent) "not-found" else if (caught) "caught-up" else "unknown", marks)
  }
  private def orderView(r: Row): Option[BankOrderView] = {
    val s = orderState(r)
    val source = s.cashRequestSource.map(_.payment)
    val op = text(s.operationId.value).map(OperationId.apply).orElse(source.map(_.operationId))
    val investor = text(s.investorAccountId.value).map(AccountId.apply).orElse(source.map(_.investorAccountId))
    val collection = text(s.fundCollectionAccountId.value).map(AccountId.apply).orElse(source.map(_.fundCollectionAccountId))
    for { operation <- op; owner <- investor; fundAccount <- collection } yield {
      val requested = if (s.operationId.value.nonEmpty) s.amount else source.get.amount
      BankOrderView(FundOrderId(r.resource), operation, owner, fundAccount, text(s.fundCode).orElse(source.map(_.fundCode)).getOrElse(""),
        DomainConverters.MoneyToWire(requested), text(s.selectedPaymentTxId.value).map(TxId.apply), paymentStatus(s),
        text(s.taRequestId.value).map(TaRequestId.apply), taStatus(s), text(s.taReference),
        if (s.taStatus == "confirmed") Some(BankTaSharesView(s.taConfirmedShares.fundCode, s.taConfirmedShares.shares, s.taConfirmedShares.nav)) else None,
        text(s.taRejectionReason), text(s.refundOperationId.value).map(OperationId.apply), refundStatus(s))
    }
  }
  private def planView(r: Row): BankSipPlanView = {
    val s = planState(r)
    BankSipPlanView(PlanId(r.resource), s.createIntent, s.initialized, s.scheduleSealed, s.paused, s.currentTick,
      s.slots.toVector.sortBy(_._1).map(_._2), s.revisions.values.toVector.sortBy(x => (x.effectiveSlot, x.revision.value))
        .map(x => BankSipRevisionView(x, s.revisionEnds.get(x.revision))),
      s.scheduleCount, s.observedCount, s.startCount, s.successTotal, s.failureTotal)
  }

  def accountMe(p: Principal, key: BankAccountKey): Future[Outcome[BankAccountResponse]] = query(p) { (c, who) =>
    if (key.schemaVersion != BankReadsideSchema.version) throw Denied(InvalidRequest)
    val r = row(c, ids.account(who.accountId)) // identity is from trusted configuration, never request
    val view = r.filter(_.payload.nonEmpty).map { value =>
      val s = accountState(value)
      val available = s.accountBalance.getOrElse("CNY", Money(BigDecimal("0.00"), "CNY"))
      val reserved = s.reservedAmount.values.filter(_.currency == "CNY").foldLeft(BigDecimal("0.00"))((sum, money) => sum + money.amount)
      BankAccountView(who.accountId, s.initialized, DomainConverters.MoneyToWire(available), DomainConverters.MoneyToWire(Money(reserved, "CNY")))
    }
    BankAccountResponse(metadata(r.toVector, absent = view.isEmpty), view)
  }
  def cashOriginal(p: Principal, key: BankCashRequestKey): Future[Outcome[BankCashRequestResponse]] = query(p) { (c, who) =>
    val pid = ids.order(BankRequestIdentity.order(who.id, key.clientRequestId))
    val r = owned(c, pid, who)
    val view = r.flatMap { x =>
      val s = orderState(x)
      s.cashRequestSource.map { original =>
        require(original.principalId == who.id && original.clientRequestId == key.clientRequestId, "cash source ownership mismatch")
        BankCashRequestView(original, paymentStatus(s), taStatus(s), refundStatus(s))
      }
    }
    BankCashRequestResponse(metadata(r.toVector, absent = view.isEmpty), view)
  }
  def order(p: Principal, key: BankOrderKey): Future[Outcome[BankOrderResponse]] = query(p) { (c, who) =>
    val r = owned(c, ids.order(key.orderId), who)
    val view = r.flatMap(orderView)
    BankOrderResponse(metadata(r.toVector, absent = view.isEmpty), view)
  }
  def plans(p: Principal, key: BankPlanPageKey): Future[Outcome[BankSipPlanPage]] = query(p) { (c, who) =>
    validPage(key.limit, key.after)
    // This order is lexicographic identity pagination, NOT event chronology.
    val rows = select(c, "SELECT * FROM bank_read_stream WHERE namespace=? AND kind='plan' AND owner_account=? AND (owner_principal IS NULL OR owner_principal=?) ORDER BY resource_id,pid_key LIMIT ? OFFSET ?",
      Seq(namespace, who.accountId.value, who.id, key.limit + 1L, key.after))(readRow)
    val page = rows.take(key.limit.toInt)
    // BankJournal has no bounded discovery frontier. Never claim a whole-index caught-up.
    BankSipPlanPage(metadata(page, completeSet = false), page.map(planView), if (rows.size > key.limit) Some(key.after + key.limit) else None)
  }
  def plan(p: Principal, key: BankPlanKey): Future[Outcome[BankSipPlanResponse]] = query(p) { (c, who) =>
    val r = owned(c, ids.plan(key.planId), who)
    BankSipPlanResponse(metadata(r.toVector, absent = r.isEmpty), r.map(planView))
  }
  def occurrences(p: Principal, key: BankOccurrencePageKey): Future[Outcome[BankSipOccurrencePage]] = query(p) { (c, who) =>
    validPage(key.limit, key.after)
    val r = owned(c, ids.plan(key.planId), who)
    r match {
      case None => BankSipOccurrencePage(metadata(Vector.empty), Vector.empty, None)
      case Some(planRow) =>
        val s = planState(planRow)
        val records = select(c, "SELECT occurrence_payload FROM bank_read_occurrence WHERE namespace=? AND plan_key=? AND owner_account=? ORDER BY due_slot LIMIT ? OFFSET ?",
          Seq(namespace, hash(planRow.pid), who.accountId.value, key.limit + 1L, key.after))(x => DomainConverters.decodeSipOccurrencePB(SipOccurrencePB.parseFrom(x.getBytes(1))))
        val page = records.take(key.limit.toInt)
        val orderRows = page.map(o => owned(c, ids.order(o.fundOrderId), who))
        val views = page.zip(orderRows).map { case (o, orderRow) =>
          val view = orderRow.flatMap(orderView)
          BankSipOccurrenceView(o, s.slotDisposition.getOrElse(o.dueSlot, "unknown"), s.occurrenceProgress.getOrElse(o.occurrenceId, "unknown"),
            view.map(_.paymentStatus).getOrElse("unknown"), view.map(_.taStatus).getOrElse("unknown"), view.map(_.refundStatus).getOrElse("unknown"), s.firstTerminals.get(o.occurrenceId))
        }
        BankSipOccurrencePage(metadata(Vector(planRow) ++ orderRows.flatten, completeSet = orderRows.forall(_.isDefined)), views,
          if (records.size > key.limit) Some(key.after + key.limit) else None)
    }
  }
  def pending(p: Principal, key: BankPendingPageKey): Future[Outcome[BankPendingResponse]] = {
    if (p == null) Future.successful(Left(NotAuthenticated))
    else if (!config.operator(p)) Future.successful(Left(NotAuthorized))
    else tracked() { Future {
      try Right(transaction(write = false) { c =>
        validPage(key.limit, key.after)
        val records = select(c, "SELECT * FROM bank_read_pending WHERE namespace=? ORDER BY operation_id,flow LIMIT ? OFFSET ?", Seq(namespace, key.limit + 1L, key.after)) { r =>
          BankPendingOperationView(OperationId(r.getString("operation_id")), r.getString("flow"), Option(r.getString("order_id")).map(FundOrderId.apply),
            Option(r.getString("plan_id")).map(PlanId.apply), Option(r.getString("occurrence_id")).map(OccurrenceId.apply), r.getString("phase"), r.getString("status"), r.getBoolean("recoverable")) -> r.getString("source_pid")
        }
        val page = records.take(key.limit.toInt)
        BankPendingResponse(metadata(page.flatMap(x => row(c, x._2)), completeSet = false), page.map(_._1), if (records.size > key.limit) Some(key.after + key.limit) else None)
      })
      catch { case Denied(error) => Left(error); case NonFatal(_) => Left(Unavailable) }
    } }
  }
}
