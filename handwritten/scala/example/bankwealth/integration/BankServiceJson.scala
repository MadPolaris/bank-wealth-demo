package example.bankwealth.integration

import example.bankwealth.domain.values._
import example.bankwealth.infrastructure.serialization.DomainConverters
import play.api.libs.json._
import scala.util.control.NonFatal

/** Closed HTTP inputs and nominal, recursively typed response encoders. */
object BankServiceJson {
  // BankAccountKey is a generated schema selector, not a client-supplied account ID.
  // Resource ownership comes exclusively from the generated authenticated Principal.
  val QuerySchemaVersion: String = "bank-query-v1"

  private val MaxClientRequestIdLength = 128
  private val MaxResourceIdLength = 2048
  private val MaxRevisionIdLength = 128
  private val MaxFundCodeLength = 64
  private val MaxDueSlots = 4096
  private val DefaultPageLimit = 50L
  private val MaxPageLimit = 100L

  private def invalid[A]: JsResult[A] = JsError("invalid-request")

  private def closedObject(
      value: JsValue,
      required: Set[String],
      optional: Set[String] = Set.empty
  ): JsResult[JsObject] = value match {
    case obj: JsObject if required.subsetOf(obj.keys) && obj.keys.subsetOf(required ++ optional) =>
      JsSuccess(obj)
    case _ => invalid
  }

  private def checkedReads[A](decode: JsValue => JsResult[A]): Reads[A] = Reads { input =>
    try {
      decode(input) match {
        case JsSuccess(value, _) => JsSuccess(value)
        case _ => invalid[A]
      }
    } catch {
      // Never expose input values, converter exceptions, or server identities in errors.
      case NonFatal(_) => invalid[A]
    }
  }

  private def envelope(
      input: JsValue,
      pathFields: Set[String],
      queryFields: Set[String]
  ): JsResult[(JsObject, JsObject, JsValue)] = for {
    root <- closedObject(input, Set("path", "query", "body"))
    path <- closedObject(root.value("path"), pathFields)
    query <- closedObject(root.value("query"), Set.empty, queryFields)
  } yield (path, query, root.value("body"))

  private def getReads[A](
      pathFields: Set[String],
      queryFields: Set[String] = Set.empty
  )(decode: (JsObject, JsObject) => JsResult[A]): Reads[A] = checkedReads { input =>
    envelope(input, pathFields, queryFields).flatMap { case (path, query, body) =>
      // The actual generated BankServiceLoader inserts JsNull for every GET.
      if (body == JsNull) decode(path, query) else invalid[A]
    }
  }

  private def postReads[A](
      pathFields: Set[String],
      bodyFields: Set[String]
  )(decode: (JsObject, JsObject) => JsResult[A]): Reads[A] = checkedReads { input =>
    envelope(input, pathFields, Set.empty).flatMap { case (path, _, body) =>
      closedObject(body, bodyFields).flatMap(obj => decode(path, obj))
    }
  }

  private def boundedText(value: JsValue, maxLength: Int): JsResult[String] = value match {
    case JsString(text) if text.nonEmpty && text.length <= maxLength &&
        text.forall(c => !Character.isISOControl(c) && !Character.isWhitespace(c)) =>
      JsSuccess(text)
    case _ => invalid
  }

  private def clientRequestId(value: JsValue): JsResult[String] =
    boundedText(value, MaxClientRequestIdLength)

  private def resourceId(value: JsValue): JsResult[String] =
    boundedText(value, MaxResourceIdLength)

  private def fundCode(value: JsValue): JsResult[String] =
    boundedText(value, MaxFundCodeLength)

  private def nonNegativeLong(value: JsValue): JsResult[Long] = value match {
    case JsNumber(number) =>
      try {
        val result = number.bigDecimal.longValueExact()
        if (result >= 0L) JsSuccess(result) else invalid
      } catch {
        case NonFatal(_) => invalid
      }
    case _ => invalid
  }

  private def amount(value: JsValue): JsResult[MoneyWire] = for {
    obj <- closedObject(value, Set("minorUnits", "currency"))
    minor <- obj.value("minorUnits") match {
      case JsString(text) if text.nonEmpty && text.length <= 80 => JsSuccess(text)
      case _ => invalid[String]
    }
    currency <- boundedText(obj.value("currency"), 3)
    wire <- {
      val result = MoneyWire(minor, currency)
      try {
        if (DomainConverters.MoneyFromWire(result).isPositive) JsSuccess(result)
        else invalid[MoneyWire]
      } catch {
        case NonFatal(_) => invalid[MoneyWire]
      }
    }
  } yield wire

  private def dueSlots(value: JsValue): JsResult[Vector[Long]] = value match {
    case JsArray(values) if values.size <= MaxDueSlots =>
      values.foldLeft[JsResult[Vector[Long]]](JsSuccess(Vector.empty[Long])) { (result, value) =>
        for {
          slots <- result
          slot <- nonNegativeLong(value)
        } yield slots :+ slot
      }
    case _ => invalid
  }

  private def pageNumber(query: JsObject, name: String, default: Long): JsResult[Long] =
    query.value.get(name) match {
      case None => JsSuccess(default)
      // Play queryString preserves duplicates as arrays; never select the first value.
      case Some(JsArray(values)) if values.size == 1 => values(0) match {
        case JsString(text) if text.length <= 19 && text.matches("0|[1-9][0-9]*") =>
          try JsSuccess(java.lang.Long.parseLong(text))
          catch { case NonFatal(_) => invalid[Long] }
        case _ => invalid
      }
      case _ => invalid
    }

  private def page(query: JsObject): JsResult[(Long, Long)] = for {
    limit <- pageNumber(query, "limit", DefaultPageLimit)
    after <- pageNumber(query, "after", 0L)
    // Bound both Int conversion and the end index used by an in-memory page slice.
    bounds <- if (limit >= 1L && limit <= MaxPageLimit &&
        after >= 0L && after <= Int.MaxValue.toLong - limit) JsSuccess((limit, after))
      else invalid[(Long, Long)]
  } yield bounds

  val bankAccountKeyReads: Reads[BankAccountKey] = getReads[BankAccountKey](Set.empty) {
    (_, _) => JsSuccess(BankAccountKey(QuerySchemaVersion))
  }

  val bankCashSubmitReads: Reads[BankCashSubmit] = postReads[BankCashSubmit](
    Set.empty, Set("clientRequestId", "fundCode", "amount")
  ) { (_, body) =>
    for {
      id <- clientRequestId(body.value("clientRequestId"))
      fund <- fundCode(body.value("fundCode"))
      money <- amount(body.value("amount"))
    } yield BankCashSubmit(id, fund, money)
  }

  val bankCashRequestKeyReads: Reads[BankCashRequestKey] =
    getReads[BankCashRequestKey](Set("clientRequestId")) { (path, _) =>
      clientRequestId(path.value("clientRequestId")).map(BankCashRequestKey.apply)
    }

  val bankOrderKeyReads: Reads[BankOrderKey] = getReads[BankOrderKey](Set("orderId")) {
    (path, _) => resourceId(path.value("orderId")).map(id => BankOrderKey(FundOrderId(id)))
  }

  val bankSipCreateReads: Reads[BankSipCreate] = postReads[BankSipCreate](
    Set.empty, Set("clientRequestId", "fundCode", "amount", "effectiveSlot", "dueSlots")
  ) { (_, body) =>
    for {
      id <- clientRequestId(body.value("clientRequestId"))
      fund <- fundCode(body.value("fundCode"))
      money <- amount(body.value("amount"))
      effective <- nonNegativeLong(body.value("effectiveSlot"))
      slots <- dueSlots(body.value("dueSlots"))
    } yield BankSipCreate(id, fund, money, effective, slots)
  }

  val bankPlanPageKeyReads: Reads[BankPlanPageKey] =
    getReads[BankPlanPageKey](Set.empty, Set("limit", "after")) { (_, query) =>
      page(query).map { case (limit, after) => BankPlanPageKey(limit, after) }
    }

  val bankPlanKeyReads: Reads[BankPlanKey] = getReads[BankPlanKey](Set("planId")) {
    (path, _) => resourceId(path.value("planId")).map(id => BankPlanKey(PlanId(id)))
  }

  val bankSipRevisionInputReads: Reads[BankSipRevisionInput] = postReads[BankSipRevisionInput](
    Set("planId"), Set("revision", "effectiveSlot", "fundCode", "amount")
  ) { (path, body) =>
    for {
      plan <- resourceId(path.value("planId"))
      revision <- boundedText(body.value("revision"), MaxRevisionIdLength)
      effective <- nonNegativeLong(body.value("effectiveSlot"))
      fund <- fundCode(body.value("fundCode"))
      money <- amount(body.value("amount"))
    } yield BankSipRevisionInput(PlanId(plan), BankSipRevise(RevisionId(revision), effective, fund, money))
  }

  val bankPlanActionReads: Reads[BankPlanKey] = postReads[BankPlanKey](Set("planId"), Set.empty) {
    (path, _) => resourceId(path.value("planId")).map(id => BankPlanKey(PlanId(id)))
  }

  val bankOccurrencePageKeyReads: Reads[BankOccurrencePageKey] =
    getReads[BankOccurrencePageKey](Set("planId"), Set("limit", "after")) { (path, query) =>
      for {
        plan <- resourceId(path.value("planId"))
        paging <- page(query)
      } yield BankOccurrencePageKey(PlanId(plan), paging._1, paging._2)
    }

  val bankPendingPageKeyReads: Reads[BankPendingPageKey] =
    getReads[BankPendingPageKey](Set.empty, Set("limit", "after")) { (_, query) =>
      page(query).map { case (limit, after) => BankPendingPageKey(limit, after) }
    }

  val bankOperationActionReads: Reads[BankOperationKey] =
    postReads[BankOperationKey](Set("operationId"), Set.empty) { (path, _) =>
      resourceId(path.value("operationId")).map(id => BankOperationKey(OperationId(id)))
    }

  val bankTickReads: Reads[BankTick] = postReads[BankTick](Set.empty, Set("slot")) {
    (_, body) => nonNegativeLong(body.value("slot")).map(BankTick.apply)
  }

  // Nominal identifiers and exact TA decimals are JSON strings, never untyped products.
  implicit val accountIdWrites: Writes[AccountId] = Writes(value => JsString(value.value))
  implicit val fundOrderIdWrites: Writes[FundOrderId] = Writes(value => JsString(value.value))
  implicit val operationIdWrites: Writes[OperationId] = Writes(value => JsString(value.value))
  implicit val txIdWrites: Writes[TxId] = Writes(value => JsString(value.value))
  implicit val planIdWrites: Writes[PlanId] = Writes(value => JsString(value.value))
  implicit val revisionIdWrites: Writes[RevisionId] = Writes(value => JsString(value.value))
  implicit val occurrenceIdWrites: Writes[OccurrenceId] = Writes(value => JsString(value.value))
  implicit val taRequestIdWrites: Writes[TaRequestId] = Writes(value => JsString(value.value))
  implicit val taExactTextWrites: Writes[TaExactText] = Writes(value => JsString(value.value))

  // Declare leaves before parents so macro-generated encoders cannot capture null implicits.
  implicit val moneyWireWrites: OWrites[MoneyWire] = Json.writes[MoneyWire]
  implicit val moneyWrites: Writes[Money] = Writes { value =>
    moneyWireWrites.writes(DomainConverters.MoneyToWire(value))
  }
  implicit val sipRevisionConfigWrites: OWrites[SipRevisionConfig] = Json.writes[SipRevisionConfig]
  implicit val sipOccurrenceWrites: OWrites[SipOccurrence] = Json.writes[SipOccurrence]
  implicit val bankCashSubmitWrites: OWrites[BankCashSubmit] = Json.writes[BankCashSubmit]
  implicit val bankPaymentOriginalWrites: OWrites[BankPaymentOriginal] = Json.writes[BankPaymentOriginal]
  implicit val bankCashOriginalWrites: OWrites[BankCashOriginal] = Json.writes[BankCashOriginal]
  implicit val bankSipCreateWrites: OWrites[BankSipCreate] = Json.writes[BankSipCreate]
  implicit val bankSipCreateIntentWrites: OWrites[BankSipCreateIntent] = Json.writes[BankSipCreateIntent]
  implicit val bankSipRevisionViewWrites: OWrites[BankSipRevisionView] = Json.writes[BankSipRevisionView]
  implicit val bankProjectionWatermarkWrites: OWrites[BankProjectionWatermark] = Json.writes[BankProjectionWatermark]
  implicit val bankReadMetadataWrites: OWrites[BankReadMetadata] = Json.writes[BankReadMetadata]
  implicit val bankAccountViewWrites: OWrites[BankAccountView] = Json.writes[BankAccountView]
  implicit val bankCashRequestViewWrites: OWrites[BankCashRequestView] = Json.writes[BankCashRequestView]
  implicit val bankTaSharesViewWrites: OWrites[BankTaSharesView] = Json.writes[BankTaSharesView]
  implicit val bankOrderViewWrites: OWrites[BankOrderView] = Json.writes[BankOrderView]
  implicit val bankSipPlanViewWrites: OWrites[BankSipPlanView] = Json.writes[BankSipPlanView]
  implicit val bankSipOccurrenceViewWrites: OWrites[BankSipOccurrenceView] = Json.writes[BankSipOccurrenceView]
  implicit val bankPendingOperationViewWrites: OWrites[BankPendingOperationView] = Json.writes[BankPendingOperationView]

  implicit val bankAccountResponseWrites: OWrites[BankAccountResponse] = Json.writes[BankAccountResponse]
  implicit val bankCashAcknowledgementWrites: OWrites[BankCashAcknowledgement] = Json.writes[BankCashAcknowledgement]
  implicit val bankCashRequestResponseWrites: OWrites[BankCashRequestResponse] = Json.writes[BankCashRequestResponse]
  implicit val bankOrderResponseWrites: OWrites[BankOrderResponse] = Json.writes[BankOrderResponse]
  implicit val bankSipAcknowledgementWrites: OWrites[BankSipAcknowledgement] = Json.writes[BankSipAcknowledgement]
  implicit val bankSipPlanPageWrites: OWrites[BankSipPlanPage] = Json.writes[BankSipPlanPage]
  implicit val bankSipPlanResponseWrites: OWrites[BankSipPlanResponse] = Json.writes[BankSipPlanResponse]
  implicit val bankSipOccurrencePageWrites: OWrites[BankSipOccurrencePage] = Json.writes[BankSipOccurrencePage]
  implicit val bankPendingResponseWrites: OWrites[BankPendingResponse] = Json.writes[BankPendingResponse]
  implicit val bankRecoveryAcknowledgementWrites: OWrites[BankRecoveryAcknowledgement] = Json.writes[BankRecoveryAcknowledgement]
  implicit val bankTickAcknowledgementWrites: OWrites[BankTickAcknowledgement] = Json.writes[BankTickAcknowledgement]
}
