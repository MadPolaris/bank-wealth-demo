package fixture.wealth.qualification

import akka.serialization.{JavaSerializer, SerializationExtension, Serializers}
import akka.serialization.jackson.JacksonCborSerializer
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.cbor.CBORFactory
import fixture.wealth.qualification.application.aggregates.FundOrderProtocol._
import fixture.wealth.qualification.domain.entities.FundOrderEntity
import fixture.wealth.qualification.domain.entities.FundOrderEntity._
import fixture.wealth.qualification.domain.values.{FundShare, Money}
import net.imadz.common.CommonTypes.iMadzError
import play.api.libs.json.Json

final class GeneratedSerializationSpec extends QualificationTestSupport {
  import QualificationSamples._
  private val serialization = SerializationExtension(system.classicSystem)
  private val plainJson = new ObjectMapper()
  private val plainCbor = new ObjectMapper(new CBORFactory())

  private def serializer(value: AnyRef): JacksonCborSerializer = {
    val selected = serialization.findSerializerFor(value)
    selected.isInstanceOf[JavaSerializer] shouldBe false
    selected.getClass.getName shouldBe "akka.serialization.jackson.JacksonCborSerializer"
    selected.identifier shouldBe 33
    selected.asInstanceOf[JacksonCborSerializer]
  }
  private def roundTrip[A <: AnyRef](value: A): A = {
    val selected = serializer(value)
    val manifest = Serializers.manifestFor(selected, value)
    val bytes = serialization.serialize(value).get
    val restored = serialization.deserialize(bytes, selected.identifier, manifest).get.asInstanceOf[A]
    println("QUALIFICATION_SERIALIZER " + Json.stringify(Json.obj(
      "valueClass" -> value.getClass.getName, "serializerClass" -> selected.getClass.getName,
      "serializerId" -> selected.identifier, "manifest" -> manifest, "bytes" -> bytes.length)))
    restored
  }
  private def invalid(value: AnyRef, json: String): Unit = {
    val selected = serializer(value)
    // Stream tokens rather than going via a tree, so duplicate object fields remain visible.
    val buffer = new java.io.ByteArrayOutputStream()
    val parser = plainJson.getFactory.createParser(json)
    val generator = plainCbor.getFactory.createGenerator(buffer)
    parser.nextToken()
    generator.copyCurrentStructure(parser)
    generator.close()
    parser.close()
    serialization.deserialize(buffer.toByteArray, selected.identifier, Serializers.manifestFor(selected, value)).isFailure shouldBe true
  }

  "Actual generated direct-CBOR protocol" should {
    "roundtrip all nine write commands and the actual source query with typed ActorRefs" in {
      val reply = createTestProbe[FundOrderReply]().ref
      val queryReply = createTestProbe[GetFundOrderStateReply]().ref
      val commands: Seq[FundOrderCommandFamily] = Seq(
        RequestFundPurchaseSettlement(operationId, id, investor, collection, fund, amount, reply),
        ReserveFundSubscription(txid, id, amount, reply),
        ConfirmFundSubscriptionPayment(txid, id, reply), CancelCashFundSubscription(txid, id, reply),
        RecordFundCashPaymentSucceeded(txid, reply), RecordFundCashPaymentRejectedBeforeEffects(txid, reply),
        RecordFundCashPaymentCompensated(txid, reply), RecordFundCashPaymentRecoveryRequired(txid, reply),
        RecordFundCashPaymentOutcomeUnknown(txid, reply), GetFundOrderState(queryReply))
      commands.size shouldBe 10
      commands.foreach(c => roundTrip(c) shouldBe c)
      val restored = roundTrip(commands.head).asInstanceOf[RequestFundPurchaseSettlement]
      exactMoney(restored.amount, amount)
      roundTrip(commands(1)).asInstanceOf[ReserveFundSubscription].amount.amount.bigDecimal.scale shouldBe 2
    }
    "roundtrip all nine selected event types and verify decimal text rather than decimal equality" in {
      val events: Seq[FundOrderEvent] = Seq(
        FundPurchaseSettlementRequested(operationId, id, investor, collection, fund, amount),
        ReserveFundSubscriptionConfirmed(txid, amount), FundSubscriptionPaymentConfirmed(txid),
        FundCashSubscriptionCanceled(txid), FundCashPaymentSucceeded(txid),
        FundCashPaymentRejectedBeforeEffects(txid), FundCashPaymentCompensated(txid),
        FundCashPaymentRecoveryRequired(txid), FundCashPaymentOutcomeUnknown(txid))
      events.size shouldBe 9
      events.foreach(e => roundTrip(e) shouldBe e)
      exactMoney(roundTrip(events.head).asInstanceOf[FundPurchaseSettlementRequested].amount, amount)
    }
    "roundtrip actual success/error replies and full-state query replies" in {
      roundTrip(FundOrderReply(None)) shouldBe FundOrderReply(None)
      val failure = roundTrip(FundOrderReply(Some(iMadzError("62181", "source guard rejection"))))
      failure.error.get.code shouldBe "62181"
      failure.error.get.message shouldBe "source guard rejection"
      val restored = roundTrip(GetFundOrderStateReply(fullState)).state
      restored shouldBe fullState
      exactMoney(restored.amount, amount)
      exact(restored.taConfirmedShares.shares, share.shares)
      exact(restored.taConfirmedShares.nav, share.nav)
    }
    "roundtrip the unchanged generated empty state and its null/unconfirmed VO slots" in {
      val empty = FundOrderEntity.empty(id)
      empty.amount shouldBe null
      empty.taConfirmedShares shouldBe null
      val restored = roundTrip(empty)
      restored shouldBe empty
      untouched(restored)
      roundTrip(GetFundOrderStateReply(empty)).state shouldBe empty
      val requested = empty.copy(status = "REQUESTED", amount = amount, contractVersion = "cash-purchase-v2")
      exactMoney(roundTrip(requested).amount, amount)
      roundTrip(requested).taConfirmedShares shouldBe null
    }
    "roundtrip every complete state field including Money/FundShare maps without losing scale" in {
      val restored = roundTrip(fullState)
      restored shouldBe fullState
      Seq(restored.amount, restored.reservedSubscriptions("reserved-other"),
        restored.committedSubscriptions(txid), restored.compensatedSubscriptions("canceled-other")).foreach(exactMoney(_, amount))
      Seq(restored.taConfirmedShares, restored.confirmedShareLots(operationId)).foreach { s =>
        exact(s.shares, share.shares)
        exact(s.nav, share.nav)
      }
    }
    "use exact string-valued VO shapes and preserve independently scaled shares/nav" in {
      val moneyBytes = serialization.serialize(amount).get
      val tree = plainCbor.readTree(moneyBytes)
      tree.size() shouldBe 2
      tree.get("amount").isTextual shouldBe true
      tree.get("amount").textValue() shouldBe amount.amount.bigDecimal.toString
      tree.get("currency").textValue() shouldBe "CNY"
      tree.has("minorUnits") shouldBe false
      exactMoney(roundTrip(amount), amount)
      val scaled = Money(BigDecimal.exact("1.2300"), "CNY")
      exactMoney(roundTrip(scaled), scaled)
      val restored = roundTrip(share)
      exact(restored.shares, share.shares)
      exact(restored.nav, share.nav)
      val scientific = FundShare(fund, BigDecimal.exact("1E+4"), BigDecimal.exact("0.000010000"))
      exact(roundTrip(scientific).shares, scientific.shares)
      exact(roundTrip(scientific).nav, scientific.nav)
    }
    "reject malformed business Money, a minor-unit wire shape, and precision/rounding violations" in {
      Seq(
        "null", "[]", "{}", "{\"amount\":1.23,\"currency\":\"CNY\"}",
        "{\"amount\":\"1.00\",\"currency\":null}",
        "{\"minorUnits\":\"100\",\"currency\":\"CNY\"}",
        "{\"amount\":\"NaN\",\"currency\":\"CNY\"}",
        "{\"amount\":\"1.001\",\"currency\":\"CNY\"}",
        "{\"amount\":\"9999999999999999999999999999999999999.99\",\"currency\":\"CNY\"}",
        "{\"amount\":\"1.00\",\"currency\":\"USD\"}",
        "{\"amount\":\"1.00\",\"currency\":\"CNY\",\"extra\":\"forbidden\"}"
      ).foreach(invalid(amount, _))
      invalid(amount, "{\"amount\":\"1.00\",\"amount\":\"2.00\",\"currency\":\"CNY\"}")
    }
    "reject malformed FundShare without imposing Money scale/precision" in {
      Seq("null", "[]", "{\"fundCode\":\"DEMO-FUND\",\"shares\":1,\"nav\":\"1.00\"}",
        "{\"fundCode\":\"DEMO-FUND\",\"shares\":\"1.00\"}",
        "{\"fundCode\":\"\",\"shares\":\"1.00\",\"nav\":\"1.00\"}",
        "{\"fundCode\":\"DEMO-FUND\",\"shares\":\"1.00\",\"nav\":\"Infinity\"}")
        .foreach(invalid(share, _))
    }
    "permit nullable state VOs but reject null Money in generated business commands/events/maps" in {
      val reply = createTestProbe[FundOrderReply]().ref
      val command = ReserveFundSubscription(txid, id, amount, reply)
      val commandTree = plainCbor.readTree(serialization.serialize(command).get)
      commandTree.asInstanceOf[com.fasterxml.jackson.databind.node.ObjectNode].putNull("amount")
      serialization.deserialize(plainCbor.writeValueAsBytes(commandTree), 33,
        Serializers.manifestFor(serializer(command), command)).isFailure shouldBe true
      val event = ReserveFundSubscriptionConfirmed(txid, amount)
      invalid(event, "{\"txid\":\"cash/string/tx-1\",\"amount\":null}")
      val stateTree = plainCbor.readTree(serialization.serialize(fullState).get)
      stateTree.get("committedSubscriptions").asInstanceOf[com.fasterxml.jackson.databind.node.ObjectNode].putNull(txid)
      serialization.deserialize(plainCbor.writeValueAsBytes(stateTree), 33,
        Serializers.manifestFor(serializer(fullState), fullState)).isFailure shouldBe true
    }
    "disable Java serialization and explicitly bind the non-marker generated full state" in {
      system.settings.config.getBoolean("akka.actor.allow-java-serialization") shouldBe false
      system.settings.config.getString("akka.actor.serialization-bindings.\"" + classOf[FundOrderState].getName + "\"") shouldBe "jackson-cbor"
      serialization.serialize(new java.io.File("not-a-domain-message")).isFailure shouldBe true
      system.settings.config.getBoolean("akka.persistence.testkit.events.serialize") shouldBe true
      system.settings.config.getBoolean("akka.persistence.testkit.snapshots.serialize") shouldBe true
    }
  }
}
