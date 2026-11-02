package fixture.wealth.qualification

import com.fasterxml.jackson.core.{JsonGenerator, JsonParser, JsonToken}
import com.fasterxml.jackson.databind.{BeanProperty, DeserializationContext, JsonDeserializer, JsonMappingException, SerializerProvider}
import com.fasterxml.jackson.databind.deser.ContextualDeserializer
import com.fasterxml.jackson.databind.module.SimpleModule
import com.fasterxml.jackson.databind.ser.std.StdSerializer
import com.fasterxml.jackson.databind.deser.std.StdDeserializer
import fixture.wealth.qualification.domain.entities.FundOrderEntity.FundOrderState
import fixture.wealth.qualification.domain.values.{FundShare, Money}

/** Real Akka Jackson module; generated Play JSON companions are not used by the journal. */
final class ExactDomainJacksonModule extends SimpleModule("fund-order-exact-domain-decimals") {
  addSerializer(classOf[Money], new MoneySerializer)
  addDeserializer(classOf[Money], new MoneyDeserializer(false))
  addSerializer(classOf[FundShare], new FundShareSerializer)
  addDeserializer(classOf[FundShare], new FundShareDeserializer(false))
}

private[qualification] object ExactVoShape {
  def fields(parser: JsonParser, expected: Set[String]): Map[String, String] = {
    if (parser.currentToken != JsonToken.START_OBJECT)
      throw JsonMappingException.from(parser, "Value object must be an object")
    var values = Map.empty[String, String]
    while (parser.nextToken() != JsonToken.END_OBJECT) {
      if (parser.currentToken != JsonToken.FIELD_NAME)
        throw JsonMappingException.from(parser, "Malformed value object")
      val name = parser.currentName()
      if (!expected(name) || values.contains(name))
        throw JsonMappingException.from(parser, "Unknown or duplicate value-object field: " + name)
      if (parser.nextToken() != JsonToken.VALUE_STRING)
        throw JsonMappingException.from(parser, "Value-object fields must be nonnull exact strings: " + name)
      values += name -> parser.getText
    }
    if (values.keySet != expected)
      throw JsonMappingException.from(parser, "Missing value-object fields")
    values
  }

  def checked[A](parser: JsonParser)(body: => A): A =
    try body catch {
      case e: IllegalArgumentException => throw JsonMappingException.from(parser, e.getMessage, e)
      case e: ArithmeticException => throw JsonMappingException.from(parser, e.getMessage, e)
    }

  // Only the two actually nullable VO slots of generated empty/full state accept null.
  // Root VO values, command/event payloads and map values do not.
  def nullableStateProperty(property: BeanProperty): Boolean =
    property != null && property.getMember != null &&
      property.getMember.getDeclaringClass == classOf[FundOrderState] &&
      Set("amount", "taConfirmedShares")(property.getName)
}

private[qualification] final class MoneySerializer extends StdSerializer[Money](classOf[Money]) {
  override def serialize(value: Money, out: JsonGenerator, provider: SerializerProvider): Unit = {
    new ExactMoneyCodec(MoneyWireSpec.configured).normalizedAmount(value)
    out.writeStartObject()
    out.writeStringField("amount", ExactDecimalText.write(value.amount))
    out.writeStringField("currency", value.currency)
    out.writeEndObject()
  }
}

private[qualification] final class MoneyDeserializer(allowNull: Boolean)
    extends StdDeserializer[Money](classOf[Money]) with ContextualDeserializer {
  override def createContextual(context: DeserializationContext, property: BeanProperty): JsonDeserializer[_] =
    new MoneyDeserializer(ExactVoShape.nullableStateProperty(property))
  override def getNullValue(context: DeserializationContext): Money =
    if (allowNull) null else throw JsonMappingException.from(context.getParser, "Business Money cannot be null")
  override def deserialize(parser: JsonParser, context: DeserializationContext): Money = {
    val f = ExactVoShape.fields(parser, Set("amount", "currency"))
    ExactVoShape.checked(parser) {
      val value = Money(ExactDecimalText.read(f("amount")), f("currency"))
      new ExactMoneyCodec(MoneyWireSpec.configured).normalizedAmount(value)
      value
    }
  }
}

private[qualification] final class FundShareSerializer extends StdSerializer[FundShare](classOf[FundShare]) {
  override def serialize(value: FundShare, out: JsonGenerator, provider: SerializerProvider): Unit = {
    require(value != null && value.fundCode != null && value.fundCode.nonEmpty, "FundShare fundCode cannot be empty")
    out.writeStartObject()
    out.writeStringField("fundCode", value.fundCode)
    out.writeStringField("shares", ExactDecimalText.write(value.shares))
    out.writeStringField("nav", ExactDecimalText.write(value.nav))
    out.writeEndObject()
  }
}

private[qualification] final class FundShareDeserializer(allowNull: Boolean)
    extends StdDeserializer[FundShare](classOf[FundShare]) with ContextualDeserializer {
  override def createContextual(context: DeserializationContext, property: BeanProperty): JsonDeserializer[_] =
    new FundShareDeserializer(ExactVoShape.nullableStateProperty(property))
  override def getNullValue(context: DeserializationContext): FundShare =
    if (allowNull) null else throw JsonMappingException.from(context.getParser, "Business FundShare cannot be null")
  override def deserialize(parser: JsonParser, context: DeserializationContext): FundShare = {
    val f = ExactVoShape.fields(parser, Set("fundCode", "shares", "nav"))
    ExactVoShape.checked(parser) {
      require(f("fundCode").nonEmpty, "FundShare fundCode cannot be empty")
      FundShare(f("fundCode"), ExactDecimalText.read(f("shares")), ExactDecimalText.read(f("nav")))
    }
  }
}
