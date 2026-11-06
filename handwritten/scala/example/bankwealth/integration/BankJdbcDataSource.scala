package example.bankwealth.integration

import java.sql.{Connection, DriverManager}
import java.io.PrintWriter
import java.util.logging.Logger
import javax.sql.DataSource

final class BankJdbcDataSource(url: String, username: String, password: String) extends DataSource {
  require(url != null && url.startsWith("jdbc:mysql://") && username != null && password != null, "explicit MySQL datasource required")
  Class.forName("com.mysql.cj.jdbc.Driver")
  def getConnection: Connection = DriverManager.getConnection(url, username, password)
  def getConnection(user: String, pass: String): Connection = throw new java.sql.SQLFeatureNotSupportedException("per-call credentials are not supported")
  def getLogWriter: PrintWriter = null
  def setLogWriter(writer: PrintWriter): Unit = if (writer != null) throw new java.sql.SQLFeatureNotSupportedException("driver logging is disabled")
  def getLoginTimeout: Int = DriverManager.getLoginTimeout
  def setLoginTimeout(seconds: Int): Unit = throw new java.sql.SQLFeatureNotSupportedException("global driver configuration is not supported")
  def getParentLogger: Logger = Logger.getLogger("example.bankwealth.jdbc")
  def unwrap[T](iface: Class[T]): T = if (iface.isInstance(this)) iface.cast(this) else throw new java.sql.SQLException("unsupported datasource wrapper")
  def isWrapperFor(iface: Class[_]): Boolean = iface.isInstance(this)
}
