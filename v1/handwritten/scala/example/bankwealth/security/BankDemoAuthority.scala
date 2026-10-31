package example.bankwealth.security

import example.bankwealth.domain.values._
import example.bankwealth.service.BankServiceService.{Authority, Principal}
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import play.api.mvc.RequestHeader
import scala.concurrent.Future

final case class BankDemoPrincipal(id: String, accountId: AccountId, roles: Set[String], token: String, csrfToken: String)
final case class BankFund(code: String, collectionAccountId: AccountId)
final case class BankSeed(accountId: AccountId, currency: String, amount: Money)
final case class BankDemoConfiguration(version: String, origin: String, principals: Vector[BankDemoPrincipal],
  funds: Vector[BankFund], seeds: Vector[BankSeed]) {
  require(version != null && version.nonEmpty && origin != null && origin.startsWith("http://127.0.0.1:"), "explicit local demo authority configuration required")
  require(principals.nonEmpty && principals.map(_.id).distinct.size == principals.size && principals.map(_.token).distinct.size == principals.size)
  require(principals.forall(p => p.id.nonEmpty && p.accountId.value.nonEmpty && p.token.nonEmpty && p.csrfToken.nonEmpty && p.roles.nonEmpty && p.roles.subsetOf(Set("customer", "operator"))))
  require(funds.nonEmpty && funds.map(_.code).distinct.size == funds.size && funds.forall(f => f.code.nonEmpty && f.collectionAccountId.value.nonEmpty))
  require(seeds.map(_.accountId).distinct.size == seeds.size && seeds.forall(s => s.currency == "CNY" && s.amount.currency == s.currency && s.amount.amount >= 0))
  require((principals.map(_.accountId) ++ funds.map(_.collectionAccountId)).forall(id => seeds.exists(_.accountId == id)), "all configured accounts require trusted seeds")
  def customer(principal: Principal): Option[BankDemoPrincipal] = Option(principal).flatMap(principal => principals.find(p => p.id == principal.id && p.roles == principal.roles && p.roles.contains("customer")))
  def operator(principal: Principal): Boolean = principal != null && principals.exists(p => p.id == principal.id && p.roles == principal.roles && p.roles.contains("operator"))
  def fund(code: String): Option[BankFund] = funds.find(_.code == code)
}

final class BankDemoAuthority(config: BankDemoConfiguration) extends Authority {
  private def equal(a: String, b: String): Boolean = a != null && b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8))
  private def identity(request: RequestHeader): Option[BankDemoPrincipal] = {
    val tokens = request.headers.getAll("Authorization")
    if (tokens.size != 1 || !tokens.head.startsWith("Bearer ")) None
    else config.principals.find(p => equal(tokens.head.drop(7), p.token))
  }
  def authenticate(request: RequestHeader): Future[Option[(String, Set[String])]] =
    Future.successful(identity(request).map(p => p.id -> p.roles))
  def csrf(request: RequestHeader): Future[Boolean] = Future.successful {
    val origins = request.headers.getAll("Origin")
    val tokens = request.headers.getAll("X-CSRF-Token")
    origins.size == 1 && origins.head == config.origin && tokens.size == 1 && identity(request).exists(p => equal(tokens.head, p.csrfToken))
  }
}
