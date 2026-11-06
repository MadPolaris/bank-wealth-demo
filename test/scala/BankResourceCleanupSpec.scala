package example.bankwealth.integration

import org.scalatest.funsuite.AnyFunSuite

final class BankResourceCleanupSpec extends AnyFunSuite {
  test("a failed drain cannot skip remaining resources and later failures are retained") {
    val calls = scala.collection.mutable.ArrayBuffer.empty[Int]
    val first = new IllegalStateException("drain failed")
    val later = new IllegalArgumentException("later close failed")
    val resources = Vector(0, 1, 2).map { index => new AutoCloseable {
      def close(): Unit = {
        calls += index
        if (index == 0) throw first
        if (index == 2) throw later
      }
    } }
    assert(intercept[IllegalStateException](BankResourceCleanup.closeAll(resources)) eq first)
    assert(calls.toVector == Vector(0, 1, 2))
    assert(first.getSuppressed.toVector == Vector(later))
  }
}
