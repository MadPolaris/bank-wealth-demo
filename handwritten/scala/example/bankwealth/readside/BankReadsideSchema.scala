package example.bankwealth.readside

object BankReadsideSchema {
  val version: String = example.bankwealth.infrastructure.projection.BankJournalReadsideSchema.version
  val statements: Vector[String] = example.bankwealth.infrastructure.projection.BankJournalReadsideSchema.statements
}
