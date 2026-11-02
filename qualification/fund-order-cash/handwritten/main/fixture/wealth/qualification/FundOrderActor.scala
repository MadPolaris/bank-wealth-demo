package fixture.wealth.qualification

import akka.persistence.typed.PersistenceId
import akka.persistence.typed.scaladsl.{EventSourcedBehavior, RetentionCriteria}
import fixture.wealth.qualification.application.aggregates.FundOrderAggregate
import fixture.wealth.qualification.application.aggregates.FundOrderProtocol.FundOrderCommandFamily
import fixture.wealth.qualification.domain.entities.FundOrderEntity
import fixture.wealth.qualification.domain.entities.FundOrderEntity.{FundOrderEvent, FundOrderState}
import fixture.wealth.qualification.domain.entities.behaviors.FundOrderEventHandler

/** Only persistence wiring: no handwritten command dispatch, rule, event construction or fold. */
object FundOrderActor {
  def apply(id: String, persistenceId: String, snapshots: Boolean = false)
      : EventSourcedBehavior[FundOrderCommandFamily, FundOrderEvent, FundOrderState] = {
    val behavior = EventSourcedBehavior[FundOrderCommandFamily, FundOrderEvent, FundOrderState](
      PersistenceId.ofUniqueId(persistenceId),
      FundOrderEntity.empty(id),
      FundOrderAggregate.commandHandler,
      FundOrderEventHandler.apply
    )
    if (snapshots) behavior.withRetention(RetentionCriteria.snapshotEvery(1, keepNSnapshots = 2))
    else behavior
  }
}
