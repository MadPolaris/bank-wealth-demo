package example.bankwealth.readside

/** MySQL-compatible DDL (also used by H2 in MySQL mode). Only derived data lives here.
  * SHA keys avoid MySQL's index-length limit; the unhashed identity is always checked.
  * The namespace row is the projection transaction lock, not a business lock.
  */
object BankReadsideSchema {
  val version: String = "bank-query-v1"
  val statements: Vector[String] = Vector(
    """CREATE TABLE IF NOT EXISTS bank_read_namespace (
      namespace VARCHAR(64) NOT NULL PRIMARY KEY, schema_version VARCHAR(64) NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS bank_read_stream (
      namespace VARCHAR(64) NOT NULL, pid_key CHAR(64) NOT NULL,
      persistence_id VARCHAR(2048) NOT NULL, kind VARCHAR(32) NOT NULL,
      resource_id VARCHAR(2048) NOT NULL, owner_account VARCHAR(1024), owner_principal VARCHAR(256),
      last_sequence BIGINT NOT NULL, observed_sequence BIGINT, state_payload LONGBLOB,
      PRIMARY KEY (namespace, pid_key)
    )""",
    """CREATE TABLE IF NOT EXISTS bank_read_event (
      namespace VARCHAR(64) NOT NULL, pid_key CHAR(64) NOT NULL, sequence_nr BIGINT NOT NULL,
      payload_type VARCHAR(512) NOT NULL, payload_manifest VARCHAR(1024) NOT NULL,
      payload LONGBLOB NOT NULL, PRIMARY KEY (namespace, pid_key, sequence_nr)
    )""",
    """CREATE TABLE IF NOT EXISTS bank_read_occurrence (
      namespace VARCHAR(64) NOT NULL, plan_key CHAR(64) NOT NULL, due_slot BIGINT NOT NULL,
      occurrence_key CHAR(64) NOT NULL, order_key CHAR(64) NOT NULL,
      owner_account VARCHAR(1024) NOT NULL, occurrence_payload LONGBLOB NOT NULL,
      PRIMARY KEY (namespace, plan_key, due_slot)
    )""",
    """CREATE TABLE IF NOT EXISTS bank_read_pending (
      namespace VARCHAR(64) NOT NULL, operation_key CHAR(64) NOT NULL, flow VARCHAR(32) NOT NULL,
      operation_id VARCHAR(2048) NOT NULL, order_id VARCHAR(2048), plan_id VARCHAR(2048),
      occurrence_id VARCHAR(2048), source_pid VARCHAR(2048) NOT NULL,
      phase VARCHAR(64) NOT NULL, status VARCHAR(64) NOT NULL, recoverable BOOLEAN NOT NULL,
      PRIMARY KEY (namespace, operation_key, flow)
    )"""
  )
}
