package example.bankwealth.integration

import akka.NotUsed
import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.actor.typed.ActorSystem
import akka.persistence.query.{EventEnvelope, Sequence}
import akka.persistence.query.scaladsl.{CurrentEventsByPersistenceIdQuery, EventsByPersistenceIdQuery}
import akka.stream.SystemMaterializer
import akka.stream.scaladsl.{Sink, Source}
import com.typesafe.config.ConfigFactory
import example.bankwealth.domain.values.AccountId
import example.bankwealth.service.UnitConfigurationCheck
import org.scalatest.funsuite.AnyFunSuite
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Await
import scala.concurrent.duration._

final class BankJournalPollingSpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)
  test("finite polling resumes exact sequence without opening per-PID tail cursors") {
    val kit = ActorTestKit(ConfigFactory.load())
    implicit val system: ActorSystem[_] = kit.system
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    val pid = new BankPersistenceIds("polling").account(AccountId("customer"))
    val calls = new AtomicInteger
    val query = new CurrentEventsByPersistenceIdQuery with EventsByPersistenceIdQuery {
      def currentEventsByPersistenceId(id: String, from: Long, to: Long): Source[EventEnvelope, NotUsed] = {
        assert(id == pid)
        calls.incrementAndGet()
        // The pinned Mongo batch can include the event preceding the requested sequence.
        Source(Vector(EventEnvelope(Sequence(1L), pid, 1L, "one"), EventEnvelope(Sequence(2L), pid, 2L, "two")))
      }
      def eventsByPersistenceId(id: String, from: Long, to: Long): Source[EventEnvelope, NotUsed] =
        throw new AssertionError("live cursor must not be opened")
    }
    val journal = new BankPersistenceJournal("polling", query, () => Source.single(pid))
    try {
      val rows = Await.result(journal.events(pid, 1L).take(1).runWith(Sink.seq), 3.seconds)
      assert(rows.map(_.sequenceNr) == Seq(2L) && calls.get() == 1)
      journal.close()
      intercept[IllegalArgumentException](journal.events(pid, 0L))
    } finally { journal.close(); kit.shutdownTestKit() }
  }

  test("finite polling refuses sequence gaps rather than skipping its cursor") {
    val kit = ActorTestKit(ConfigFactory.load())
    implicit val system: ActorSystem[_] = kit.system
    implicit val materializer: akka.stream.Materializer = SystemMaterializer(system).materializer
    val pid = new BankPersistenceIds("pollinggap").account(AccountId("customer"))
    val query = new CurrentEventsByPersistenceIdQuery with EventsByPersistenceIdQuery {
      def currentEventsByPersistenceId(id: String, from: Long, to: Long) =
        Source.single(EventEnvelope(Sequence(2L), pid, 2L, "two"))
      def eventsByPersistenceId(id: String, from: Long, to: Long): Source[EventEnvelope, NotUsed] =
        throw new AssertionError("live cursor must not be opened")
    }
    val journal = new BankPersistenceJournal("pollinggap", query, () => Source.single(pid))
    try intercept[IllegalArgumentException](Await.result(journal.events(pid, 0L).take(1).runWith(Sink.seq), 3.seconds))
    finally { journal.close(); kit.shutdownTestKit() }
  }
}
