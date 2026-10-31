package example.bankwealth.integration

import akka.NotUsed
import akka.stream.scaladsl.Source
import scalapb.GeneratedMessage
import scala.concurrent.{ExecutionContext, Future}

final case class BankJournalEnvelope(persistenceId: String, sequenceNr: Long, event: Any) {
  require(persistenceId != null && persistenceId.nonEmpty && sequenceNr > 0 && event != null)
}

trait BankJournal extends AutoCloseable {
  def namespace: String
  def persistenceIds(): Source[String, NotUsed]
  def currentEvents(persistenceId: String, afterSequenceNr: Long): Future[Vector[BankJournalEnvelope]]
  def events(persistenceId: String, afterSequenceNr: Long): Source[BankJournalEnvelope, NotUsed]

  final def readPb(persistenceId: String)(implicit ec: ExecutionContext): Future[Vector[GeneratedMessage]] =
    currentEvents(persistenceId, 0L).map(_.collect { case BankJournalEnvelope(_, _, p: GeneratedMessage) => p })

  final def readAll(persistenceId: String)(implicit ec: ExecutionContext): Future[Vector[Any]] =
    currentEvents(persistenceId, 0L).map(_.map(_.event))
}
