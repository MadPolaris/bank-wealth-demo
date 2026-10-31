package example.bankwealth.integration

import akka.actor.typed.{ActorRef, ActorSystem}
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import example.bankwealth.domain._
import example.bankwealth.infrastructure.proto.CreditBalanceAccountInitializedPB
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.security.BankSeed
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

final class BankSeedAuthority(journal: BankJournal)(implicit system: ActorSystem[_]) {
  implicit private val ec: ExecutionContext = system.executionContext
  implicit private val timeout: Timeout = Timeout(3.seconds)

  def ensure(seed: BankSeed, account: BankActorHandle[CreditBalanceAggregate.Request]): Future[Unit] = {
    def initialized(): Future[Boolean] = journal.readPb(account.persistenceId).map { events =>
      val originals = events.collect { case e: CreditBalanceAccountInitializedPB => DomainConverters.decodeCreditBalanceAccountInitializedPB(e) }
      require(originals.size <= 1, "multiple account initialization facts")
      originals.headOption.foreach { original =>
        require(original.resource == seed.accountId && original.currency == seed.currency && original.amount == seed.amount, "trusted seed conflicts with original initialization")
      }
      originals.nonEmpty
    }
    initialized().flatMap {
      case true => Future.successful(())
      case false =>
        account.ref.ask[CreditBalanceAggregate.Reply](reply => CreditBalanceAggregate.Execute(
          CreditBalanceProtocol.InitializeAccount(seed.accountId, seed.currency, seed.amount), reply))
          .transformWith { _ => initialized().map(exists => require(exists, "account initialization has no durable original fact")) }
    }
  }
}
