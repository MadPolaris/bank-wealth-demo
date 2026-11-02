package example.bankwealth.service

import akka.NotUsed
import akka.stream.scaladsl.Source
import example.bankwealth.integration._
import example.bankwealth.readside.BankReadside
import org.scalatest.funsuite.AnyFunSuite
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration._

final class BankReadsideShutdownSpec extends AnyFunSuite {
  import BankOwnerATestSupport._

  test("shutdown drains an outstanding finite journal read before invalidating all observed frontiers") {
    UnitConfigurationCheck.main(Array.empty)
    val f = new Fixture
    implicit val system: akka.actor.typed.ActorSystem[_] = f.system
    implicit val ec: scala.concurrent.ExecutionContext = f.ec
    val entered = Promise[Unit]()
    val release = Promise[Vector[BankJournalEnvelope]]()
    val journal = new BankJournal {
      val namespace = f.journal.namespace
      def persistenceIds(): Source[String, NotUsed] = Source.empty
      def currentEvents(pid: String, after: Long): Future[Vector[BankJournalEnvelope]] = {
        entered.trySuccess(())
        release.future
      }
      def events(pid: String, after: Long): Source[BankJournalEnvelope, NotUsed] = Source.maybe[BankJournalEnvelope].mapMaterializedValue(_ => NotUsed)
      def close(): Unit = ()
    }
    val readside = new BankReadside(journal, f.config, f.dataSource)
    try {
      val events = f.accountEvents(f.investor)
      events.foreach(e => await(readside.project(e)))
      val inflight = readside.catchUp(f.ids.account(f.investor))
      await(entered.future)
      val stopped = readside.shutdown()
      assert(!stopped.isCompleted)
      release.success(Vector.empty)
      await(inflight)
      await(stopped)
      val connection = f.dataSource.getConnection
      try {
        val statement = connection.createStatement()
        try {
          val rows = statement.executeQuery("SELECT last_sequence,observed_sequence FROM bank_read_stream")
          try { assert(rows.next()); assert(rows.getLong(1) == events.size.toLong); assert(rows.getObject(2) == null) }
          finally rows.close()
        } finally statement.close()
      } finally connection.close()
      assert(readside.shutdown() eq stopped)
      intercept[IllegalStateException](Await.result(readside.catchUp(f.ids.account(f.investor)), 2.seconds))
      val before = f.dataSource.connections.get()
      intercept[IllegalStateException](Await.result(readside.pending(f.operator,
        example.bankwealth.domain.values.BankPendingPageKey(10L, 0L)), 2.seconds))
      assert(f.dataSource.connections.get() == before)
      assert(!f.journal.closed)
    } finally {
      release.trySuccess(Vector.empty)
      readside.close()
      f.readside.close()
      f.kit.shutdownTestKit()
    }
  }
}
