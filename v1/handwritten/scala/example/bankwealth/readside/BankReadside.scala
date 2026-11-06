package example.bankwealth.readside

import akka.NotUsed
import akka.actor.typed.ActorSystem
import akka.stream.scaladsl.Source
import example.bankwealth.domain._
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto.SipOccurrencePB
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.infrastructure.projection.{BankJournalReadsideDomain, BankJournalReadsideProjection, BankJournalReadsideRepository}
import example.bankwealth.infrastructure.projection.BankJournalReadsideRepository.{Row, State, Pending, Occurrence, hash}
import example.bankwealth.integration._
import example.bankwealth.security.{BankDemoConfiguration, BankDemoPrincipal}
import example.bankwealth.service.BankServiceService._
import javax.sql.DataSource
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Application-specific ownership, query views and index selection over the generated read side. */
final class BankReadside(journal: BankJournal, config: BankDemoConfiguration, dataSource: DataSource)
    (implicit system: ActorSystem[_], ec: ExecutionContext) extends BankReadQueries with AutoCloseable {
  require(journal != null && config != null && dataSource != null)
  private val ids = new BankPersistenceIds(journal.namespace)
  private type Session = BankJournalReadsideRepository#Session
  private final case class Denied(failure: Failure) extends RuntimeException

  private def identity(pid: String): (String, String) = {
    require(ids.owns(pid), "foreign journal namespace")
    val parts = pid.substring(ids.prefix.length).split("/", -1)
    require(parts.length == 2, "invalid persistence identity")
    val value = new String(java.util.Base64.getUrlDecoder.decode(parts(1)), java.nio.charset.StandardCharsets.UTF_8)
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

  private val ownership = new BankJournalReadsideDomain.Ownership {
    def account(r: Row, next: CreditBalanceState): (Option[String], Option[String]) = (Some(r.resource), None)
    def order(r: Row, next: FundOrderState): (Option[String], Option[String]) = {
      next.cashRequestSource.foreach { source =>
        require(source.payment.fundOrderId.value == r.resource, "cash source identity mismatch")
        new BankTrustedAdmission(config).validateCash(source)
      }
      val owner = next.cashRequestSource.map(_.payment.investorAccountId.value).orElse(text(next.investorAccountId.value))
      val principal = next.cashRequestSource.map(_.principalId)
      require(r.account.isEmpty || owner.isEmpty || r.account == owner, "order owner conflict")
      require(r.principal.isEmpty || principal.isEmpty || r.principal == principal, "order principal conflict")
      (owner.orElse(r.account), principal.orElse(r.principal))
    }
    def plan(r: Row, next: SipPlanState): (Option[String], Option[String]) = {
      next.createIntent.foreach { source =>
        require(source.planId.value == r.resource, "SIP intent identity mismatch")
        new BankTrustedAdmission(config).validateSip(source)
      }
      val owner = next.createIntent.map(_.config.investorAccountId.value)
        .orElse(next.revisions.get(next.latestRevision).map(_.investorAccountId.value))
      val principal = next.createIntent.map(_.principalId)
      require(r.account.isEmpty || owner.isEmpty || r.account == owner, "plan owner conflict")
      require(r.principal.isEmpty || principal.isEmpty || r.principal == principal, "plan principal conflict")
      (owner.orElse(r.account), principal.orElse(r.principal))
    }
  }
  private val source = new BankJournalReadsideProjection.Journal {
    val namespace: String = journal.namespace
    def persistenceIds(): Source[String, NotUsed] = journal.persistenceIds()
    def currentEvents(pid: String, after: Long): Future[Vector[BankJournalReadsideProjection.Envelope]] =
      journal.currentEvents(pid, after).map(_.map(e => BankJournalReadsideProjection.Envelope(e.persistenceId, e.sequenceNr, e.event)))
    def events(pid: String, after: Long): Source[BankJournalReadsideProjection.Envelope, NotUsed] =
      journal.events(pid, after).map(e => BankJournalReadsideProjection.Envelope(e.persistenceId, e.sequenceNr, e.event))
  }
  private val projection = new BankJournalReadsideProjection(source, new BankJournalReadsideProjection.Bindings {
    def identity(pid: String): (String, String) = BankReadside.this.identity(pid)
    def fold(row: Row, event: Any): State = BankJournalReadsideDomain.fold(row, event, ownership)
    def indexes(session: Session, row: Row): Unit = BankReadside.this.indexes(session, row)
  }, dataSource)

  def initialize(): Future[Unit] = projection.initialize()
  def project(envelope: BankJournalEnvelope): Future[Unit] =
    projection.project(BankJournalReadsideProjection.Envelope(envelope.persistenceId, envelope.sequenceNr, envelope.event))
  def catchUp(pid: String): Future[Unit] = projection.catchUp(pid)
  def start(): Future[Unit] = projection.start()
  def shutdown(): Future[Unit] = projection.shutdown()
  def close(): Unit = projection.close()

  private def accountState(r: Row): CreditBalanceState = BankJournalReadsideDomain.accountState(r)
  private def orderState(r: Row): FundOrderState = BankJournalReadsideDomain.orderState(r)
  private def planState(r: Row): SipPlanState = BankJournalReadsideDomain.planState(r)
  private def text(value: String): Option[String] = Option(value).filter(_.nonEmpty)
  private def paymentStatus(s: FundOrderState): String = s.cashPaymentFinalResults.get(s.selectedPaymentTxId)
    .orElse(text(s.paymentOutcome)).getOrElse(if (s.status == "new") "intent-recorded" else s.status)
  private def taStatus(s: FundOrderState): String = text(s.taStatus).getOrElse("not-submitted")
  private def refundStatus(s: FundOrderState): String = text(s.refundOutcome)
    .getOrElse(if (s.taStatus == "rejected" && paymentStatus(s) == "succeeded") "refund-in-progress" else "not-required")

  private def pendingPut(c: Session, value: BankPendingOperationView, pid: String): Unit =
    c.putPending(Pending(hash(value.operationId.value), value.flow, value.operationId.value, value.orderId.map(_.value),
      value.planId.map(_.value), value.occurrenceId.map(_.value), pid, value.phase, value.status, value.recoverable))
  private def pendingDelete(c: Session, op: OperationId, flow: String): Unit = c.deletePending(hash(op.value), flow)
  private def indexes(c: Session, r: Row): Unit = r.kind match {
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
        c.putOccurrence(Occurrence(hash(r.pid), due, hash(occurrence.occurrenceId.value), hash(ids.order(occurrence.fundOrderId)),
          occurrence.config.investorAccountId.value, DomainConverters.encodeSipOccurrencePB(occurrence).toByteArray))
        if (!s.firstTerminals.contains(occurrence.occurrenceId))
          pendingPut(c, BankPendingOperationView(occurrence.operationId, "sip-dispatch", Some(occurrence.fundOrderId), Some(occurrence.planId), Some(occurrence.occurrenceId), "installment", s.occurrenceProgress.getOrElse(occurrence.occurrenceId, "pending"), true), r.pid)
        else pendingDelete(c, occurrence.operationId, "sip-dispatch")
      }
    case _ => ()
  }

  private def customer(p: Principal): Either[Failure, BankDemoPrincipal] =
    if (p == null) Left(NotAuthenticated) else config.customer(p).toRight(NotAuthorized)
  private def query[A](p: Principal)(f: (Session, BankDemoPrincipal) => A): Future[Outcome[A]] = customer(p) match {
    case Left(error) => Future.successful(Left(error))
    case Right(who) => projection.read { c =>
      try Right(f(c, who))
      catch { case Denied(error) => Left(error); case NonFatal(_) => Left(Unavailable) }
    }.recover { case error: IllegalStateException if error.getMessage == "readside is closed" => throw error; case NonFatal(_) => Left(Unavailable) }
  }
  private def validPage(limit: Long, after: Long): Unit =
    if (limit < 1L || limit > 100L || after < 0L || after > Int.MaxValue.toLong - limit) throw Denied(InvalidRequest)

  private def owned(c: Session, pid: String, who: BankDemoPrincipal): Option[Row] = c.owners(pid) match {
    case None => None
    case Some(owner) =>
      require(owner.pid == pid, "PID digest collision")
      if (owner.account.exists(_ != who.accountId.value) || owner.principal.exists(_ != who.id)) throw Denied(NotAuthorized)
      if (owner.account.isEmpty) None else c.row(pid)
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
    val r = c.row(ids.account(who.accountId))
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
    val rows = c.streamPage("plan", who.accountId.value, who.id, key.limit + 1L, key.after)
    val page = rows.take(key.limit.toInt)
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
        val records = c.queryOccurrenceby_plan(hash(planRow.pid), who.accountId.value, key.limit + 1L, key.after)
          .map(x => DomainConverters.decodeSipOccurrencePB(SipOccurrencePB.parseFrom(x.occurrence_payload)))
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
    else projection.read { c =>
      try {
        validPage(key.limit, key.after)
        val records = c.queryPendinglisting(key.limit + 1L, key.after).map { r =>
          BankPendingOperationView(OperationId(r.operation_id), r.flow, r.order_id.map(FundOrderId.apply),
            r.plan_id.map(PlanId.apply), r.occurrence_id.map(OccurrenceId.apply), r.phase, r.status, r.recoverable) -> r.source_pid
        }
        val page = records.take(key.limit.toInt)
        Right(BankPendingResponse(metadata(page.flatMap(x => c.row(x._2)), completeSet = false), page.map(_._1), if (records.size > key.limit) Some(key.after + key.limit) else None))
      } catch { case Denied(error) => Left(error); case NonFatal(_) => Left(Unavailable) }
    }.recover { case error: IllegalStateException if error.getMessage == "readside is closed" => throw error; case NonFatal(_) => Left(Unavailable) }
  }
}
