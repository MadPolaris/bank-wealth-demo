package example.bankwealth.integration

import akka.NotUsed
import akka.actor.typed.ActorSystem
import akka.persistence.query.{EventEnvelope, PersistenceQuery}
import akka.persistence.query.scaladsl.{CurrentEventsByPersistenceIdQuery, CurrentPersistenceIdsQuery, EventsByPersistenceIdQuery, PersistenceIdsQuery}
import akka.stream.{KillSwitches, Materializer, SharedKillSwitch, SystemMaterializer}
import akka.stream.scaladsl.{Sink, Source}
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future}

final class BankPersistenceJournal(
    val namespace: String,
    query: CurrentEventsByPersistenceIdQuery with EventsByPersistenceIdQuery,
    discoverPersistenceIds: () => Source[String, NotUsed]
)(implicit system: ActorSystem[_]) extends BankJournal {
  private val ids = new BankPersistenceIds(namespace)
  private val closed = new AtomicBoolean(false)
  private val stop: SharedKillSwitch = KillSwitches.shared("bank-journal-" + namespace)
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val materializer: Materializer = SystemMaterializer(system).materializer
  private def check(pid: String, after: Long): Unit = {
    require(!closed.get(), "journal is closed")
    require(ids.owns(pid), "persistence identity belongs to another namespace")
    require(after >= 0 && after < Long.MaxValue, "valid journal sequence required")
  }
  private def envelope(row: EventEnvelope): BankJournalEnvelope = {
    require(ids.owns(row.persistenceId), "journal returned a foreign persistence identity")
    BankJournalEnvelope(row.persistenceId, row.sequenceNr, row.event)
  }
  def persistenceIds(): Source[String, NotUsed] = {
    require(!closed.get(), "journal is closed")
    discoverPersistenceIds().filter(ids.owns).via(stop.flow).mapMaterializedValue(_ => NotUsed)
  }
  def currentEvents(pid: String, after: Long): Future[Vector[BankJournalEnvelope]] = {
    check(pid, after)
    query.currentEventsByPersistenceId(pid, after + 1L, Long.MaxValue).via(stop.flow).map(envelope).runWith(Sink.seq).map(_.toVector)
  }
  def events(pid: String, after: Long): Source[BankJournalEnvelope, NotUsed] = {
    check(pid, after)
    query.eventsByPersistenceId(pid, after + 1L, Long.MaxValue).via(stop.flow).map(envelope).mapMaterializedValue(_ => NotUsed)
  }
  def close(): Unit = if (closed.compareAndSet(false, true)) stop.shutdown()
}
