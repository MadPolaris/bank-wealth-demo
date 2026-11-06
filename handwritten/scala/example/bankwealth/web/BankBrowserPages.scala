package example.bankwealth.web

import example.bankwealth.service.BankServiceService
import play.api.libs.json._

/** Static, optional renderer installed by the composition root, never another router.
  * The role picker selects a protected validation query, not an identity or authority.
  * All business requests go through the fourteen formally declared page aliases.
  */
object BankBrowserPages extends BankServiceService.PageRenderer {
  override val implementation: String = "example.bankwealth.web.BankBrowserPages"
  override val version: String = "1"

  private final case class Field(name: String, label: String, kind: String = "text",
      max: Int = 2048, initial: String = "", required: Boolean = true)
  private final case class Endpoint(id: String, method: String, path: String,
      audience: String, title: String, fields: Vector[Field] = Vector.empty)

  private val clientId = Field("clientRequestId", "Client request ID (reuse only for the original request)", max = 128)
  private val fund = Field("fundCode", "Fund code", max = 64)
  private val money = Vector(Field("minorUnits", "Amount in minor units (exact integer text)", "money", 80),
    Field("currency", "Currency", "currency", 3, "CNY"))
  private val effective = Field("effectiveSlot", "Effective business slot", "long", 19, "0")
  private val planId = Field("planId", "Existing plan ID")
  private val paging = Vector(Field("limit", "Page limit (1–100)", "long", 19, "50", required = false),
    Field("after", "Page offset", "long", 19, "0", required = false))

  // Exact endpoint IDs and /api/v1 suffixes from bank-service.formal.yaml.
  // This is a fixed UI table, not a prefix-rewriting router or a metadata execution hook.
  private val endpoints = Vector(
    Endpoint("account-me", "GET", "/bank/v1/accounts/me", "customer", "My account"),
    Endpoint("cash-submit", "POST", "/bank/v1/cash-requests", "customer", "Submit cash request", Vector(clientId, fund) ++ money),
    Endpoint("cash-original", "GET", "/bank/v1/cash-requests/:clientRequestId", "customer", "Original cash request", Vector(clientId)),
    Endpoint("order-detail", "GET", "/bank/v1/orders/:orderId", "customer", "Fund order", Vector(Field("orderId", "Existing order ID"))),
    Endpoint("sip-create", "POST", "/bank/v1/sip-plans", "customer", "Create SIP plan", Vector(clientId, fund) ++ money ++
      Vector(effective, Field("dueSlots", "Due business slots (1–1024, strictly increasing; comma or newline separated)", "long-array", 20480))),
    Endpoint("sip-list", "GET", "/bank/v1/sip-plans", "customer", "My SIP plans", paging),
    Endpoint("sip-detail", "GET", "/bank/v1/sip-plans/:planId", "customer", "SIP plan", Vector(planId)),
    Endpoint("sip-revise", "POST", "/bank/v1/sip-plans/:planId/revisions", "customer", "Revise SIP plan", Vector(planId,
      Field("revision", "Revision ID (text, not a number)", max = 128), effective, fund) ++ money),
    Endpoint("sip-pause", "POST", "/bank/v1/sip-plans/:planId/pause", "customer", "Pause SIP plan", Vector(planId)),
    Endpoint("sip-resume", "POST", "/bank/v1/sip-plans/:planId/resume", "customer", "Resume SIP plan", Vector(planId)),
    Endpoint("sip-occurrences", "GET", "/bank/v1/sip-plans/:planId/occurrences", "customer", "SIP installments", Vector(planId) ++ paging),
    Endpoint("operations-pending", "GET", "/bank/v1/operations/pending", "operator", "Pending operations", paging),
    Endpoint("operation-reconcile", "POST", "/bank/v1/operations/:operationId/reconcile", "operator", "Reconcile existing operation",
      Vector(Field("operationId", "Existing operation ID (no new operation is created)"))),
    Endpoint("business-tick", "POST", "/bank/v1/business-clock/tick", "operator", "Manual business-clock tick",
      Vector(Field("slot", "Business slot", "long", 19, "0")))
  )

  private def esc(text: String): String = BankPageRenderer.escape(text)

  private def fieldHtml(endpoint: Endpoint, field: Field): String = {
    val id = "bank-" + endpoint.id + "-" + field.name
    val attributes = " id=\"" + esc(id) + "\" name=\"" + esc(field.name) + "\" maxlength=\"" + field.max +
      "\" autocomplete=\"off\" spellcheck=\"false\" data-bank-control" + (if (field.required) " required" else "")
    val control = if (field.kind == "long-array") "<textarea" + attributes + " rows=\"3\"></textarea>"
      else "<input type=\"text\"" + attributes + " value=\"" + esc(field.initial) + "\"" +
        (if (field.kind == "long" || field.kind == "money") " inputmode=\"numeric\"" else "") + ">"
    "<label for=\"" + esc(id) + "\">" + esc(field.label) + "</label>" + control
  }

  private def formHtml(endpoint: Endpoint): String =
    "<form id=\"bank-form-" + esc(endpoint.id) + "\" data-endpoint=\"" + esc(endpoint.id) +
      "\" data-method=\"" + endpoint.method + "\" data-path=\"" + esc(endpoint.path) +
      "\" data-audience=\"" + endpoint.audience + "\" autocomplete=\"off\" hidden>" +
      "<h2>" + esc(endpoint.title) + "</h2><p>" + endpoint.method + " <code>" + esc(endpoint.path) + "</code></p>" +
      endpoint.fields.map(fieldHtml(endpoint, _)).mkString +
      "<button type=\"submit\" data-bank-control>" + (if (endpoint.method == "GET") "Read current projection" else "Submit existing command") +
      "</button></form>"

  override val shell: String =
    """<!doctype html><html lang="en"><head><meta charset="utf-8">
      |<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bank wealth V1 demo</title>
      |<style>body{font-family:system-ui,sans-serif;max-width:75rem;margin:2rem auto;padding:0 1rem}
      |[hidden]{display:none!important}aside{padding:1rem;background:#f3f5f7}nav{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}
      |label{display:block;margin-top:.8rem}input,textarea{box-sizing:border-box;max-width:100%;width:32rem;padding:.4rem}
      |button{padding:.5rem;margin:.6rem .3rem .6rem 0}dt{font-weight:600}dd{margin-bottom:.6rem;overflow-wrap:anywhere}
      |dl dl{border-left:2px solid #ddd;padding-left:1rem}code{overflow-wrap:anywhere}#bank-results{border-top:1px solid #ddd;margin-top:1rem}
      |</style><script src="/bank/v1/client-script" defer></script></head><body>
      |<main id="bank-app" data-busy="false"><h1>Bank wealth V1 demo</h1>
      |<aside id="bank-disclaimer">Payment success, TA acceptance and technical effect confirmation are not investment success.
      |Only a correlated TA confirmation confirms the investment. A TA rejection without a completed refund remains refund in progress.
      |Unknown projection progress is not proof that a resource does not exist. Read results retain the service's per-PID projection watermarks.</aside>
      |<noscript>This demo needs its same-origin client script. Forms never bypass Bearer, CSRF or Origin checks.</noscript>
      |<section id="bank-sign-in"><h2>Sign in with issued demo credentials</h2>
      |<p>Enter the Bearer token and CSRF token issued by trusted demo configuration. They stay only in this tab's memory;
      |refresh requires re-entry. The workspace selector is not a role claim. The server authorizes the validation query.</p>
      |<form id="bank-login-form" autocomplete="off">
      |<label for="bank-login-role">Workspace to validate</label><select id="bank-login-role" data-bank-control>
      |<option value="customer">Customer</option><option value="operator">Operator</option></select>
      |<label for="bank-login-token">Bearer token (without the Bearer prefix)</label>
      |<input id="bank-login-token" type="password" autocomplete="off" spellcheck="false" required data-bank-control>
      |<label for="bank-login-csrf">CSRF token</label>
      |<input id="bank-login-csrf" type="password" autocomplete="off" spellcheck="false" required data-bank-control>
      |<button id="bank-login-submit" type="submit" data-bank-control>Validate sign-in</button></form></section>
      |<button id="bank-logout" type="button" hidden>Sign out and clear this tab</button>
      |<p id="bank-status" role="status" aria-live="polite">Not signed in.</p>
      |<section id="bank-workspace" hidden><nav aria-label="Bank actions">
      |""".stripMargin + endpoints.map(e =>
      "<button id=\"bank-nav-" + e.id + "\" type=\"button\" data-nav=\"" + e.id +
        "\" data-audience=\"" + e.audience + "\" data-bank-control hidden>" + esc(e.title) + "</button>").mkString +
      "</nav>" + endpoints.map(formHtml).mkString + "</section><section id=\"bank-results\" aria-label=\"Service response\"></section></main></body></html>"

  private val clientEndpoints: String = Json.stringify(JsArray(endpoints.map(e => Json.obj(
    "id" -> e.id, "method" -> e.method, "path" -> e.path, "audience" -> e.audience, "title" -> e.title))))

  override val script: String = """(() => {
    |  'use strict';
    |  const endpoints = """.stripMargin + clientEndpoints + """;
    |  const byId = new Map(endpoints.map(endpoint => [endpoint.id, endpoint]));
    |  const app = document.getElementById('bank-app');
    |  if (!app) return;
    |  const signIn = document.getElementById('bank-sign-in');
    |  const loginForm = document.getElementById('bank-login-form');
    |  const roleInput = document.getElementById('bank-login-role');
    |  const tokenInput = document.getElementById('bank-login-token');
    |  const csrfInput = document.getElementById('bank-login-csrf');
    |  const workspace = document.getElementById('bank-workspace');
    |  const logout = document.getElementById('bank-logout');
    |  const status = document.getElementById('bank-status');
    |  const results = document.getElementById('bank-results');
    |  let session = null;
    |  let generation = 0;
    |  let busy = false;
    |  let pending = null;
    |
    |  function setBusy(value) {
    |    busy = value;
    |    app.dataset.busy = value ? 'true' : 'false';
    |    document.querySelectorAll('[data-bank-control]').forEach(control => { control.disabled = value; });
    |  }
    |  function message(text, endpointId = '', httpStatus = '', phase = '') {
    |    status.textContent = text;
    |    status.dataset.endpoint = endpointId;
    |    status.dataset.status = String(httpStatus);
    |    status.dataset.phase = phase;
    |  }
    |  function clearSession() {
    |    generation += 1;
    |    session = null;
    |    if (pending) pending.abort();
    |    pending = null;
    |    setBusy(false);
    |    results.replaceChildren();
    |    document.querySelectorAll('input,textarea').forEach(input => { input.value = ''; });
    |    roleInput.value = 'customer';
    |    document.querySelectorAll('form[data-endpoint],[data-nav]').forEach(element => { element.hidden = true; });
    |    workspace.hidden = true;
    |    delete workspace.dataset.role;
    |    signIn.hidden = false;
    |    logout.hidden = true;
    |    message('Not signed in.');
    |  }
    |  function selectEndpoint(endpoint) {
    |    results.replaceChildren();
    |    document.querySelectorAll('form[data-endpoint]').forEach(form => { form.hidden = form.dataset.endpoint !== endpoint.id; });
    |    document.querySelectorAll('[data-nav]').forEach(button => {
    |      button.setAttribute('aria-pressed', button.dataset.nav === endpoint.id ? 'true' : 'false');
    |    });
    |  }
    |  function showWorkspace(endpoint) {
    |    document.querySelectorAll('form[data-endpoint]').forEach(form => { form.reset(); });
    |    workspace.dataset.role = session.role;
    |    workspace.hidden = false;
    |    signIn.hidden = true;
    |    logout.hidden = false;
    |    document.querySelectorAll('[data-nav]').forEach(button => { button.hidden = button.dataset.audience !== session.role; });
    |    selectEndpoint(endpoint);
    |  }
    |
    |  // The fixed shell CSP has default-src 'none' and no frame-src allowance.
    |  // Instead of an iframe or raw HTML insertion, copy only text and these
    |  // attribute-free structural elements from the trusted escaped renderer.
    |  const responseTags = new Set(['MAIN', 'H1', 'ASIDE', 'DL', 'DT', 'DD', 'UL', 'LI', 'SPAN']);
    |  function displayResponse(html) {
    |    const parsed = new DOMParser().parseFromString(html, 'text/html');
    |    const fragment = document.createDocumentFragment();
    |    function copy(source, target) {
    |      for (const node of source.childNodes) {
    |        if (node.nodeType === 3) target.appendChild(document.createTextNode(node.textContent));
    |        else if (node.nodeType === 1 && responseTags.has(node.tagName)) {
    |          const element = document.createElement(node.tagName.toLowerCase());
    |          copy(node, element);
    |          target.appendChild(element);
    |        }
    |      }
    |    }
    |    copy(parsed.body, fragment);
    |    results.replaceChildren(fragment);
    |  }
    |
    |  function text(form, name, max) {
    |    const value = form.elements.namedItem(name).value;
    |    if (!value || value.length > max || /[\s\x00-\x1f\x7f-\x9f]/u.test(value))
    |      throw new Error('Use bounded, nonempty text without whitespace for IDs and codes.');
    |    return value;
    |  }
    |  function longText(value) {
    |    const max = '9223372036854775807';
    |    if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > max.length ||
    |        (value.length === max.length && value > max))
    |      throw new Error('Slots and paging values must be exact nonnegative signed-Long integer text.');
    |    return value;
    |  }
    |  function longField(form, name) { return longText(form.elements.namedItem(name).value); }
    |  function stringField(form, name, max) { return JSON.stringify(text(form, name, max)); }
    |  // Values below are already encoded JSON tokens. Long tokens are validated
    |  // decimal text, deliberately never passed through floating-point conversion.
    |  function objectJson(entries) {
    |    return '{' + entries.map(([key, value]) => JSON.stringify(key) + ':' + value).join(',') + '}';
    |  }
    |  function moneyJson(form) {
    |    const minor = text(form, 'minorUnits', 80);
    |    if (!/^[0-9]+$/.test(minor) || !/[1-9]/.test(minor))
    |      throw new Error('Amount must be positive integer minor-unit text.');
    |    return objectJson([['minorUnits', JSON.stringify(minor)], ['currency', stringField(form, 'currency', 3)]]);
    |  }
    |  function dueSlotsJson(form) {
    |    const value = form.elements.namedItem('dueSlots').value;
    |    const slots = value.trim() === '' ? [] : value.split(/[,\n]/).map(slot => longText(slot.trim()));
    |    if (slots.length === 0 || slots.length > 1024) throw new Error('Between 1 and 1024 due slots are required.');
    |    const effective = BigInt(longField(form, 'effectiveSlot'));
    |    if (slots.some((slot, index) => BigInt(slot) < effective || (index > 0 && BigInt(slot) <= BigInt(slots[index - 1]))))
    |      throw new Error('Due slots must increase strictly and not precede the effective slot.');
    |    return '[' + slots.join(',') + ']';
    |  }
    |  function bodyFor(endpoint, form) {
    |    switch (endpoint.id) {
    |      case 'cash-submit': return objectJson([
    |        ['clientRequestId', stringField(form, 'clientRequestId', 128)],
    |        ['fundCode', stringField(form, 'fundCode', 64)], ['amount', moneyJson(form)]]);
    |      case 'sip-create': return objectJson([
    |        ['clientRequestId', stringField(form, 'clientRequestId', 128)],
    |        ['fundCode', stringField(form, 'fundCode', 64)], ['amount', moneyJson(form)],
    |        ['effectiveSlot', longField(form, 'effectiveSlot')], ['dueSlots', dueSlotsJson(form)]]);
    |      case 'sip-revise': return objectJson([
    |        ['revision', stringField(form, 'revision', 128)], ['effectiveSlot', longField(form, 'effectiveSlot')],
    |        ['fundCode', stringField(form, 'fundCode', 64)], ['amount', moneyJson(form)]]);
    |      case 'sip-pause': case 'sip-resume': case 'operation-reconcile': return '{}';
    |      case 'business-tick': return objectJson([['slot', longField(form, 'slot')]]);
    |      default: throw new Error('Unknown command.');
    |    }
    |  }
    |  function pathFor(endpoint, form) {
    |    let path = endpoint.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, name) => {
    |      const id = text(form, name, name === 'clientRequestId' ? 128 : 2048);
    |      if (id === '.' || id === '..') throw new Error('Use an existing resource ID, not a path segment.');
    |      return encodeURIComponent(id);
    |    });
    |    if (['sip-list', 'sip-occurrences', 'operations-pending'].includes(endpoint.id)) {
    |      const limit = longText(form.elements.namedItem('limit').value || '50');
    |      const after = longText(form.elements.namedItem('after').value || '0');
    |      if (BigInt(limit) < 1n || BigInt(limit) > 100n || BigInt(after) + BigInt(limit) > 2147483647n)
    |        throw new Error('Page limit must be 1–100 and offset must fit the service page bounds.');
    |      path += '?limit=' + limit + '&after=' + after;
    |    }
    |    return path;
    |  }
    |
    |  async function request(endpoint, path, body, authenticating) {
    |    const current = generation;
    |    const controller = new AbortController();
    |    pending = controller;
    |    setBusy(true);
    |    results.replaceChildren();
    |    message('Request in progress.', endpoint.id, '', authenticating ? 'login' : 'action');
    |    try {
    |      const headers = { 'Authorization': 'Bearer ' + session.token, 'Accept': 'text/html' };
    |      if (endpoint.method === 'POST') {
    |        headers['Content-Type'] = 'application/json';
    |        headers['X-CSRF-Token'] = session.csrf;
    |      }
    |      // Origin is supplied by the browser for POST, not a caller-controlled role/header.
    |      const response = await fetch(path, { method: endpoint.method, headers, body,
    |        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    |      if (current !== generation) return;
    |      if (response.status === 401 || response.status === 403) {
    |        clearSession();
    |        message('Authorization rejected; credentials and prior business results cleared. HTTP ' + response.status,
    |          endpoint.id, response.status, authenticating ? 'login' : 'action');
    |        return;
    |      }
    |      // Only the actual HTTP status establishes sign-in, never a JSON/HTML claim.
    |      if (authenticating && response.status !== 200) {
    |        clearSession();
    |        message('Sign-in validation unavailable. HTTP ' + response.status, endpoint.id, response.status, 'login');
    |        return;
    |      }
    |      const html = await response.text();
    |      if (current !== generation) return;
    |      if (authenticating) showWorkspace(endpoint);
    |      message(endpoint.title + ' — HTTP ' + response.status + '. Business and projection status are shown below.',
    |        endpoint.id, response.status, authenticating ? 'login' : 'action');
    |      if ((response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() === 'text/html')
    |        displayResponse(html);
    |      else message('Unexpected response format. HTTP ' + response.status, endpoint.id, response.status,
    |        authenticating ? 'login' : 'action');
    |    } catch (_) {
    |      if (current !== generation) return;
    |      if (authenticating) clearSession();
    |      message('Request could not be completed. No business success is inferred.', endpoint.id, '', 'request-error');
    |    } finally {
    |      if (current === generation) { pending = null; setBusy(false); }
    |    }
    |  }
    |
    |  loginForm.addEventListener('submit', event => {
    |    event.preventDefault();
    |    if (busy) return;
    |    const role = roleInput.value;
    |    const token = tokenInput.value;
    |    const csrf = csrfInput.value;
    |    tokenInput.value = '';
    |    csrfInput.value = '';
    |    clearSession();
    |    if (!['customer', 'operator'].includes(role) || !token || !csrf || /[\r\n]/.test(token + csrf)) {
    |      message('Enter issued token and CSRF values and select an existing workspace.');
    |      return;
    |    }
    |    session = { token, csrf, role };
    |    const endpoint = byId.get(role === 'customer' ? 'account-me' : 'operations-pending');
    |    void request(endpoint, endpoint.path, undefined, true);
    |  });
    |  logout.addEventListener('click', () => { clearSession(); message('Signed out. This tab has been cleared.'); });
    |  window.addEventListener('pagehide', clearSession);
    |  document.querySelectorAll('[data-nav]').forEach(button => {
    |    button.addEventListener('click', () => {
    |      const endpoint = byId.get(button.dataset.nav);
    |      if (busy || !session || endpoint.audience !== session.role) return;
    |      selectEndpoint(endpoint);
    |      message('Selected ' + endpoint.title + '. Submit the form to request current data.', endpoint.id, '', 'navigation');
    |    });
    |  });
    |  document.querySelectorAll('form[data-endpoint]').forEach(form => {
    |    form.addEventListener('submit', event => {
    |      event.preventDefault();
    |      const endpoint = byId.get(form.dataset.endpoint);
    |      if (busy || !session || endpoint.audience !== session.role) return;
    |      try {
    |        const path = pathFor(endpoint, form);
    |        const body = endpoint.method === 'POST' ? bodyFor(endpoint, form) : undefined;
    |        void request(endpoint, path, body, false);
    |      } catch (error) {
    |        results.replaceChildren();
    |        message(error.message, endpoint.id, '', 'invalid-input');
    |      }
    |    });
    |  });
    |  clearSession();
    |  app.dataset.ready = 'true';
    |})();
    |""".stripMargin

  override def render(endpointId: String, status: Int, value: JsValue): String = {
    val title = endpoints.find(_.id == endpointId).map(_.title).getOrElse(endpointId)
    BankPageRenderer.render(title + " (HTTP " + status + ")", value)
  }
}
