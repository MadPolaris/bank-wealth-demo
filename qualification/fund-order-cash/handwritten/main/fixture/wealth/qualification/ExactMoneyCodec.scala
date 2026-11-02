package fixture.wealth.qualification

import java.math.{BigDecimal => JDecimal, BigInteger, RoundingMode}
import com.typesafe.config.{Config, ConfigFactory}
import fixture.wealth.qualification.domain.values.Money

/** Values MUST be supplied by the runner from the current source binding, never defaults. */
final case class MoneyWireSpec(scale: Int, precision: Int, currency: String) {
  require(scale >= 0 && precision > scale, "Invalid Money scale/precision binding")
  require(currency == "CNY", "This qualification covers CNY only")
}
object MoneyWireSpec {
  def fromConfig(config: Config): MoneyWireSpec = {
    val c = config.getConfig("qualification.money")
    MoneyWireSpec(c.getInt("scale"), c.getInt("precision"), c.getString("currency"))
  }
  def configured: MoneyWireSpec = fromConfig(ConfigFactory.load("qualification-money"))
}

/** Exact decimal text, including negative scales; no binary floating point or MathContext rounding. */
object ExactDecimalText {
  private val syntax = "-?(0|[1-9][0-9]*)(\\.[0-9]+)?(E[+-]?[0-9]+)?".r
  def read(text: String): BigDecimal = {
    require(text != null && syntax.pattern.matcher(text).matches(), "Decimal must be exact canonical text")
    val decimal = new JDecimal(text)
    require(decimal.toString == text, "Noncanonical decimal text (including negative zero) is forbidden")
    BigDecimal.exact(decimal)
  }
  def write(value: BigDecimal): String = {
    require(value != null, "Decimal cannot be null")
    value.bigDecimal.toString
  }
}

/** Deliberately distinct from the generated Money{amount,currency} domain shape. */
final case class MinorUnitsWire(minorUnits: String, currency: String)
final class ExactMoneyCodec(val spec: MoneyWireSpec) {
  private val integer = "(0|-?[1-9][0-9]*)".r
  private def currency(value: String): Unit =
    require(value == spec.currency, "Currency is outside the CNY qualification binding")

  def normalizedAmount(value: Money): JDecimal = {
    require(value != null && value.amount != null, "Money and amount cannot be null")
    currency(value.currency)
    val exact = value.amount.bigDecimal.setScale(spec.scale, RoundingMode.UNNECESSARY)
    require(exact.precision <= spec.precision, "Money exceeds bound decimal precision")
    exact
  }

  def toWire(value: Money): MinorUnitsWire = {
    val amount = normalizedAmount(value)
    MinorUnitsWire(amount.unscaledValue.toString, value.currency)
  }

  def fromWire(value: MinorUnitsWire): Money = {
    require(value != null && value.minorUnits != null && integer.pattern.matcher(value.minorUnits).matches(),
      "minorUnits must be a canonical integer without plus, whitespace, leading zeros or negative zero")
    currency(value.currency)
    val amount = new JDecimal(new BigInteger(value.minorUnits), spec.scale)
    require(amount.precision <= spec.precision, "Money exceeds bound decimal precision")
    Money(BigDecimal.exact(amount), value.currency)
  }
}
