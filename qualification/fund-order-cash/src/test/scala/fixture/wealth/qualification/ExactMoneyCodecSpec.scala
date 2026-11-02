package fixture.wealth.qualification

import fixture.wealth.qualification.domain.values.Money
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class ExactMoneyCodecSpec extends AnyWordSpec with Matchers {
  private val spec = MoneyWireSpec.configured
  private val codec = new ExactMoneyCodec(spec)

  "Runner-derived Money wire binding" should {
    "be the explicitly qualified CNY scale-2 precision-38 binding" in {
      spec shouldBe MoneyWireSpec(2, 38, "CNY")
    }
    "bridge exact high precision decimal Money to a different canonical integer shape" in {
      val money = QualificationSamples.amount
      val wire = codec.toWire(money)
      wire shouldBe MinorUnitsWire("12345678901234567890123456789012345678", "CNY")
      val restored = codec.fromWire(wire)
      restored.amount.bigDecimal.unscaledValue shouldBe money.amount.bigDecimal.unscaledValue
      restored.amount.bigDecimal.scale shouldBe 2
    }
    "allow representable zero and negative values without pretending representability is positivity" in {
      codec.toWire(Money(BigDecimal.exact("0.00"), "CNY")) shouldBe MinorUnitsWire("0", "CNY")
      codec.toWire(Money(BigDecimal.exact("-1.20"), "CNY")) shouldBe MinorUnitsWire("-120", "CNY")
      codec.toWire(Money(BigDecimal.exact("1.2300"), "CNY")) shouldBe MinorUnitsWire("123", "CNY")
    }
    "reject rounding, excess precision, bad currency and null decimal payloads" in {
      Seq("0.001", "9999999999999999999999999999999999999.99").foreach { text =>
        intercept[Exception](codec.toWire(Money(BigDecimal.exact(text), "CNY")))
      }
      intercept[IllegalArgumentException](codec.toWire(Money(BigDecimal.exact("1.00"), "USD")))
      intercept[IllegalArgumentException](codec.toWire(Money(null, "CNY")))
      intercept[IllegalArgumentException](codec.fromWire(MinorUnitsWire("1", "USD")))
      intercept[IllegalArgumentException](codec.fromWire(MinorUnitsWire("9" * 39, "CNY")))
    }
    "reject every noncanonical integer spelling rather than normalizing it" in {
      Seq("-0", "00", "01", "-01", "+1", " 1", "1 ", "1.0", "1e2", "", "--1").foreach { text =>
        withClue(text)(intercept[IllegalArgumentException](codec.fromWire(MinorUnitsWire(text, "CNY"))))
      }
    }
  }
  "Independent exact decimal text" should {
    "retain FundShare precision and individual scales, including negative decimal scales" in {
      Seq("1.230000", "0.00000000000000000001", "1E+4",
        "12345678901234567890123456789012345678901234567890.123456789000").foreach { text =>
        ExactDecimalText.write(ExactDecimalText.read(text)) shouldBe text
      }
    }
    "reject invalid and noncanonical decimal text" in {
      Seq("NaN", "Infinity", "1.2.3", " 1.00", "+1.00", "01.00", "-0", "-0.00", "1e2", ".5", "1.").foreach { text =>
        intercept[Exception](ExactDecimalText.read(text))
      }
    }
  }
}
