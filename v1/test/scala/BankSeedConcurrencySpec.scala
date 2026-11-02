import akka.actor.testkit.typed.scaladsl.ActorTestKit
import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.{AskPattern, Behaviors}
import AskPattern._
import akka.persistence.query.PersistenceQuery
import akka.persistence.testkit.query.scaladsl.PersistenceTestKitReadJournal
import akka.util.Timeout
import com.typesafe.config.ConfigFactory
import example.bankwealth.bindings.BankBalanceComputations
import example.bankwealth.domain._
import example.bankwealth.domain.CreditBalanceAggregate.{Accepted, Execute, Reply, Request}
import example.bankwealth.domain.CreditBalanceProtocol.{AccountInitialized, Command, InitializeAccount, ReserveFunds}
import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.proto.CreditBalanceAccountInitializedPB
import example.bankwealth.infrastructure.serialization.DomainConverters
import example.bankwealth.integration._
import example.bankwealth.security.BankSeed
import example.bankwealth.service.UnitConfigurationCheck
import org.scalatest.funsuite.AnyFunSuite
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.concurrent.duration._
import scala.util.{Failure, Success}

final class BankSeedConcurrencySpec extends AnyFunSuite {
  UnitConfigurationCheck.main(Array.empty)

  // BankSeedAuthority owns its three-second ask timeout; this outer deadline also
  // allows its real post-timeout journal query to finish, without sleeps.
  private def await[A](future: Future[A]): A = Await.result(future, 12.seconds)
  private def original(seed: BankSeed): AccountInitialized =
    AccountInitialized(seed.accountId, seed.currency, seed.amount)
  private def initializations(rows: Vector[BankJournalEnvelope]): Vector[AccountInitialized] =
    rows.collect {
      case BankJournalEnvelope(_, _, pb: CreditBalanceAccountInitializedPB) =>
        DomainConverters.decodeCreditBalanceAccountInitializedPB(pb)
    }

  private final class AccountFixture(namespace: String) extends AutoCloseable {
    val kit = ActorTestKit(ConfigFactory.load())
    implicit val system: ActorSystem[_] = kit.system
    implicit val ec: ExecutionContext = system.executionContext
    implicit val timeout: Timeout = Timeout(5.seconds)
    val id = AccountId("investor")
    val seed = BankSeed(id, "CNY", Money(BigDecimal("1000.00"), "CNY"))
    private val ids = new BankPersistenceIds(namespace)
    private val query = PersistenceQuery(system)
      .readJournalFor[PersistenceTestKitReadJournal]("akka.persistence.testkit.query")
    val journal = new BankPersistenceJournal(namespace, query,
      () => query.currentPersistenceIds(None, Long.MaxValue))
    val actor = kit.spawn(CreditBalanceAggregate(ids.account(id),
      CreditBalanceState.empty.copy(id = id), BankBalanceComputations))
    val handle = BankActorHandle(ids.account(id), actor)
    val authority = new BankSeedAuthority(journal)

    def persisted: Vector[BankJournalEnvelope] = await(journal.currentEvents(handle.persistenceId, 0L))
    def state: CreditBalanceState = await(actor.ask[CreditBalanceState](CreditBalanceAggregate.GetState))
    def execute(command: Command): Reply =
      await(actor.ask[Reply](reply => Execute(command, reply)))

    def racingHandle(participants: Int): BankActorHandle[Request] = {
      require(participants >= 2)
      val proxy = kit.spawn(Behaviors.setup[Request] { _ =>
        var pending = Vector.empty[Execute]
        Behaviors.receiveMessage[Request] {
          case request @ Execute(_: InitializeAccount, _) if pending.size < participants =>
            pending :+= request
            // Every caller has completed its real empty-journal read before any
            // initialization reaches the real actor. Preserve original replyTo.
            if (pending.size == participants) pending.foreach(actor ! _)
            Behaviors.same
          case request =>
            actor ! request
            Behaviors.same
        }
      })
      BankActorHandle(handle.persistenceId, proxy)
    }

    override def close(): Unit = try journal.close() finally kit.shutdownTestKit()
  }

  private def withAccount(namespace: String)(body: AccountFixture => Unit): Unit = {
    val fixture = new AccountFixture(namespace)
    try body(fixture) finally fixture.close()
  }

  test("concurrent identical seeds persist one original PB and repeats never refill a reserved account") {
    withAccount("seedidenticalrace") { f =>
      implicit val ec: ExecutionContext = f.ec
      assert(f.persisted.isEmpty)
      val racing = f.racingHandle(2)
      val attempts = Vector.fill(2)(f.authority.ensure(f.seed, racing))
      await(Future.sequence(attempts))
      val seeded = f.persisted
      assert(seeded.size == 1)
      assert(initializations(seeded) == Vector(original(f.seed)))
      assert(f.state.accountBalance("CNY") == f.seed.amount)

      val tx = TxId("reserve-after-seed-race")
      val reserved = Money(BigDecimal("100.00"), "CNY")
      assert(f.execute(ReserveFunds(tx, f.id, reserved)).isInstanceOf[Accepted])
      val changed = f.state
      assert(changed.accountBalance("CNY") == Money(BigDecimal("900.00"), "CNY"))
      assert(changed.reservedAmount.get(tx).contains(reserved))
      val afterReserve = f.persisted
      assert(afterReserve.size == 2)
      assert(initializations(afterReserve) == Vector(original(f.seed)))

      // Fresh authority instances must consult the original PB, not current
      // balance or an in-memory success receipt from the first pair of calls.
      await(Future.sequence(Vector.fill(2)(new BankSeedAuthority(f.journal)(f.system).ensure(f.seed, racing))))
      assert(f.state == changed)
      assert(f.persisted == afterReserve)
    }
  }

  test("concurrent conflicting seeds have one durable winner and a fail-closed loser with no extra PB") {
    withAccount("seedconflictrace") { f =>
      implicit val ec: ExecutionContext = f.ec
      assert(f.persisted.isEmpty)
      val candidates = Vector(f.seed, f.seed.copy(amount = Money(BigDecimal("750.00"), "CNY")))
      val racing = f.racingHandle(candidates.size)
      // Observe both outcomes without Future.sequence failing early on the loser.
      val attempts = candidates.map(seed => f.authority.ensure(seed, racing).transform(result => Success(result)))
      val outcomes = await(Future.sequence(attempts))
      assert(outcomes.count(_.isSuccess) == 1)
      val failures = outcomes.collect { case Failure(error) => error }
      assert(failures.size == 1)
      assert(failures.head.isInstanceOf[IllegalArgumentException])
      assert(failures.head.getMessage.contains("trusted seed conflicts with original initialization"))
      val winner = candidates(outcomes.indexWhere(_.isSuccess))
      val loser = candidates(outcomes.indexWhere(_.isFailure))
      val persisted = f.persisted
      assert(persisted.size == 1)
      assert(initializations(persisted) == Vector(original(winner)))
      assert(f.state.accountBalance("CNY") == winner.amount)

      await(f.authority.ensure(winner, racing))
      val conflict = intercept[IllegalArgumentException](await(f.authority.ensure(loser, racing)))
      assert(conflict.getMessage.contains("trusted seed conflicts with original initialization"))
      assert(f.persisted == persisted)
      assert(f.state.accountBalance("CNY") == winner.amount)
    }
  }

  test("withheld real initialized Accepted ACK times out and re-queries the original PB without a second seed") {
    withAccount("seedackloss") { f =>
      implicit val ec: ExecutionContext = f.ec
      val actualReply = Promise[Reply]()
      val releaseAck = Promise[Unit]()
      val initializeAttempts = new AtomicInteger
      val proxy = f.kit.spawn(Behaviors.setup[Request] { context =>
        Behaviors.receiveMessage[Request] {
          case request @ Execute(_: InitializeAccount, originalReplyTo) =>
            initializeAttempts.incrementAndGet()
            val replyProxy = context.spawnAnonymous(Behaviors.receiveMessage[Reply] { reply =>
              // Only a reply emitted by the real actor after its original effect
              // can be retained and later sent to the real requesting recipient.
              releaseAck.future.foreach(_ => originalReplyTo ! reply)
              actualReply.trySuccess(reply)
              Behaviors.stopped
            })
            f.actor ! request.copy(replyTo = replyProxy)
            Behaviors.same
          case request =>
            f.actor ! request
            Behaviors.same
        }
      })
      val handle = BankActorHandle(f.handle.persistenceId, proxy)
      try {
        assert(f.persisted.isEmpty)
        val ensuring = f.authority.ensure(f.seed, handle)
        assert(await(actualReply.future) == Accepted(Vector(original(f.seed))))
        val persisted = f.persisted
        assert(persisted.size == 1)
        assert(initializations(persisted) == Vector(original(f.seed)))
        assert(!releaseAck.isCompleted)

        // No ACK can reach the asker while the gate is closed. Success therefore
        // requires the authority's actual timeout path and real durable PB query.
        await(ensuring)
        assert(!releaseAck.isCompleted)
        assert(initializeAttempts.get() == 1)
        assert(f.persisted == persisted)
        await(new BankSeedAuthority(f.journal)(f.system).ensure(f.seed, handle))
        assert(initializeAttempts.get() == 1)
        assert(f.persisted == persisted)
        assert(f.state.accountBalance("CNY") == f.seed.amount)
      } finally {
        // A deliberately late original ACK may go to the expired ask recipient;
        // never manufacture Accepted or forward it before the real actor effect.
        releaseAck.trySuccess(())
      }
    }
  }
}
