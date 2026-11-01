#!/usr/bin/env node
/**
 * Caller-driven browser verification; importing this module starts nothing.
 * No bundled browser, dependency installer, server, credential defaults or trace.
 *
 * runBankBrowserCheck({ baseURL, synthetic: true, browser, credentials,
 *   actions, failures, timeoutMs }) uses an ALREADY supplied Playwright-compatible
 * Browser and an isolated new context. credentials has customer/operator objects
 * with { token, csrf }. actions contains all fourteen endpointIds exactly once,
 * each with { endpointId, fields: { existingFormName: 'text' }, expectedStatuses,
 * assertText?: ['nonsecret fixture watermark/status text'] }. At least one action
 * must send a signed-Long slot > 2^53 (use a controlled fixture, not live funds).
 * failures contains caller-issued synthetic 401 and 403 cases. A case is either
 * { kind: 'login', role, credentials: { token, csrf }, expectedStatus: 401|403 }
 * or { kind: 'action', role, credentials: { token, csrf }, action,
 *      expectedStatus: 401|403 }. Action cases validate sign-in first, then send
 * the chosen form (e.g. a caller-issued wrong CSRF token), proving prior DOM wipe.
 * Results contain endpoint identities, HTTP statuses and boolean DOM evidence,
 * never headers, bodies, credential values, URLs with parameters or raw errors.
 *
 * Explicit local CLI (only the caller runs this):
 * node /absolute/path/v1-browser-check.mjs --config /absolute/synthetic-config.mjs
 *   --browser-module /absolute/path/to/already-installed/playwright/index.mjs
 *   --browser-executable /absolute/path/to/already-installed/chromium
 * The local config exports default { baseURL, synthetic: true, credentials,
 * actions, failures }. No dependency resolution/download or executable discovery.
 */
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BANK_ACTIONS = Object.freeze([
  { endpointId: 'account-me', method: 'GET', path: '/bank/v1/accounts/me', role: 'customer', fields: [] },
  { endpointId: 'cash-submit', method: 'POST', path: '/bank/v1/cash-requests', role: 'customer', fields: ['clientRequestId', 'fundCode', 'minorUnits', 'currency'] },
  { endpointId: 'cash-original', method: 'GET', path: '/bank/v1/cash-requests/:clientRequestId', role: 'customer', fields: ['clientRequestId'] },
  { endpointId: 'order-detail', method: 'GET', path: '/bank/v1/orders/:orderId', role: 'customer', fields: ['orderId'] },
  { endpointId: 'sip-create', method: 'POST', path: '/bank/v1/sip-plans', role: 'customer', fields: ['clientRequestId', 'fundCode', 'minorUnits', 'currency', 'effectiveSlot', 'dueSlots'] },
  { endpointId: 'sip-list', method: 'GET', path: '/bank/v1/sip-plans', role: 'customer', fields: ['limit', 'after'] },
  { endpointId: 'sip-detail', method: 'GET', path: '/bank/v1/sip-plans/:planId', role: 'customer', fields: ['planId'] },
  { endpointId: 'sip-revise', method: 'POST', path: '/bank/v1/sip-plans/:planId/revisions', role: 'customer', fields: ['planId', 'revision', 'effectiveSlot', 'fundCode', 'minorUnits', 'currency'] },
  { endpointId: 'sip-pause', method: 'POST', path: '/bank/v1/sip-plans/:planId/pause', role: 'customer', fields: ['planId'] },
  { endpointId: 'sip-resume', method: 'POST', path: '/bank/v1/sip-plans/:planId/resume', role: 'customer', fields: ['planId'] },
  { endpointId: 'sip-occurrences', method: 'GET', path: '/bank/v1/sip-plans/:planId/occurrences', role: 'customer', fields: ['planId', 'limit', 'after'] },
  { endpointId: 'operations-pending', method: 'GET', path: '/bank/v1/operations/pending', role: 'operator', fields: ['limit', 'after'] },
  { endpointId: 'operation-reconcile', method: 'POST', path: '/bank/v1/operations/:operationId/reconcile', role: 'operator', fields: ['operationId'] },
  { endpointId: 'business-tick', method: 'POST', path: '/bank/v1/business-clock/tick', role: 'operator', fields: ['slot'] },
].map(action => Object.freeze({ ...action, fields: Object.freeze(action.fields) })));
const byId = new Map(BANK_ACTIONS.map(action => [action.endpointId, action]));
const roles = new Set(['customer', 'operator']);
const disclaimer = 'Payment success, TA acceptance and technical effect confirmation are not investment success.';

function ensure(condition) { if (!condition) throw new Error('Bank browser check requirement not met.'); }
function issued(value) {
  ensure(value && typeof value.token === 'string' && value.token.length > 0 &&
    typeof value.csrf === 'string' && value.csrf.length > 0 && !/[\r\n]/.test(value.token + value.csrf));
}
function validateAction(action) {
  const meta = byId.get(action?.endpointId);
  ensure(meta && action.fields && typeof action.fields === 'object' && !Array.isArray(action.fields));
  ensure(Object.entries(action.fields).every(([key, value]) => meta.fields.includes(key) && typeof value === 'string'));
  ensure(Array.isArray(action.expectedStatuses) && action.expectedStatuses.length > 0 &&
    action.expectedStatuses.every(status => Number.isInteger(status) && status >= 100 && status <= 599));
  ensure(action.assertText === undefined || (Array.isArray(action.assertText) && action.assertText.every(text => typeof text === 'string')));
  return meta;
}
function longLiteral(value) {
  ensure(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 19 &&
    BigInt(value) <= 9223372036854775807n);
  return value;
}
function slots(value) { return value.trim() === '' ? [] : value.split(/[,\n]/).map(text => longLiteral(text.trim())); }
function objectLiteral(entries) { return '{' + entries.map(([key, value]) => JSON.stringify(key) + ':' + value).join(',') + '}'; }
function expectedBody(id, fields) {
  const string = key => JSON.stringify(fields[key]);
  const amount = () => objectLiteral([['minorUnits', string('minorUnits')], ['currency', string('currency')]]);
  switch (id) {
    case 'cash-submit': return objectLiteral([['clientRequestId', string('clientRequestId')], ['fundCode', string('fundCode')], ['amount', amount()]]);
    case 'sip-create': return objectLiteral([['clientRequestId', string('clientRequestId')], ['fundCode', string('fundCode')], ['amount', amount()],
      ['effectiveSlot', longLiteral(fields.effectiveSlot)], ['dueSlots', '[' + slots(fields.dueSlots).join(',') + ']']]);
    case 'sip-revise': return objectLiteral([['revision', string('revision')], ['effectiveSlot', longLiteral(fields.effectiveSlot)],
      ['fundCode', string('fundCode')], ['amount', amount()]]);
    case 'sip-pause': case 'sip-resume': case 'operation-reconcile': return '{}';
    case 'business-tick': return objectLiteral([['slot', longLiteral(fields.slot)]]);
    default: return null;
  }
}
function hasWideLong(meta, fields) {
  const values = [];
  if (['sip-create', 'sip-revise'].includes(meta.endpointId)) values.push(longLiteral(fields.effectiveSlot));
  if (meta.endpointId === 'sip-create') values.push(...slots(fields.dueSlots));
  if (meta.endpointId === 'business-tick') values.push(longLiteral(fields.slot));
  return values.some(value => BigInt(value) > 9007199254740991n);
}
function expectedPath(meta, fields) {
  return meta.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key) => encodeURIComponent(fields[key]));
}

export class BankBrowserCheckError extends Error {
  constructor(report) {
    super('Bank browser check did not complete; inspect redacted report.');
    this.name = 'BankBrowserCheckError';
    this.report = report;
  }
}

export async function runBankBrowserCheck(config) {
  const records = [];
  let context;
  let phase = 'configuration';
  let wideLongWireObserved = false;
  try {
    ensure(config?.synthetic === true && typeof config.baseURL === 'string');
    const origin = new URL(config.baseURL);
    ensure(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && !origin.username && !origin.password &&
      origin.pathname === '/' && !origin.search && !origin.hash);
    const baseURL = origin.origin;
    ensure(config.browser && typeof config.browser.newContext === 'function');
    issued(config.credentials?.customer);
    issued(config.credentials?.operator);
    ensure(Array.isArray(config.actions) && config.actions.length === BANK_ACTIONS.length);
    config.actions.forEach(validateAction);
    ensure(new Set(config.actions.map(action => action.endpointId)).size === BANK_ACTIONS.length);
    ensure(Array.isArray(config.failures) && config.failures.length >= 2 &&
      config.failures.some(failure => failure.expectedStatus === 401) && config.failures.some(failure => failure.expectedStatus === 403) &&
      config.failures.some(failure => failure.kind === 'action'));
    config.failures.forEach(failure => {
      ensure(['login', 'action'].includes(failure.kind) && roles.has(failure.role) && [401, 403].includes(failure.expectedStatus));
      issued(failure.credentials);
      if (failure.kind === 'action') {
        const meta = validateAction(failure.action);
        ensure(meta.role === failure.role && failure.action.expectedStatuses.includes(failure.expectedStatus));
      }
    });
    const timeoutMs = config.timeoutMs ?? 15000;
    ensure(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000);
    const secretValues = [config.credentials.customer, config.credentials.operator, ...config.failures.map(failure => failure.credentials)]
      .flatMap(value => [value.token, value.csrf]);

    phase = 'open-shell';
    context = await config.browser.newContext({ baseURL, serviceWorkers: 'block' });
    context.setDefaultTimeout(timeoutMs);
    const page = await context.newPage();
    const scriptResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === baseURL && url.pathname === '/bank/v1/client-script' && response.request().method() === 'GET';
    }, { timeout: timeoutMs });
    const [shell, script] = await Promise.all([page.goto(baseURL + '/bank/v1', { waitUntil: 'load', timeout: timeoutMs }), scriptResponse]);
    phase = 'shell-http';
    records.push({ phase, shellStatus: shell?.status(), scriptStatus: script.status() });
    ensure(shell?.status() === 200 && script.status() === 200 && page.url() === baseURL + '/bank/v1');
    phase = 'shell-script-ready';
    await page.waitForFunction(() => document.getElementById('bank-app')?.dataset.ready === 'true', null, { timeout: timeoutMs });
    phase = 'shell-disclaimer';
    ensure((await page.locator('#bank-disclaimer').textContent()).includes(disclaimer));
    phase = 'shell-forms';
    const identities = await page.locator('form[data-endpoint]').evaluateAll(forms => forms.map(form => ({
      endpointId: form.dataset.endpoint, method: form.dataset.method, path: form.dataset.path, role: form.dataset.audience,
      fields: Array.from(form.querySelectorAll('[name]'), field => field.name),
    })));
    ensure(identities.length === 14 && new Set(identities.map(item => item.endpointId)).size === 14);
    BANK_ACTIONS.forEach(expected => {
      const actual = identities.find(item => item.endpointId === expected.endpointId);
      ensure(actual && actual.method === expected.method && actual.path === expected.path && actual.role === expected.role &&
        JSON.stringify([...actual.fields].sort()) === JSON.stringify([...expected.fields].sort()));
    });
    const optionRoles = await page.locator('#bank-login-role option').evaluateAll(options => options.map(option => option.value));
    ensure(JSON.stringify(optionRoles) === '["customer","operator"]');
    records.push({ phase: 'shell', status: shell.status(), scriptStatus: script.status(), exactForms: true });

    async function evidence(expectSignedIn, expectEmpty = false) {
      const dom = await page.evaluate(({ secretValues, expectSignedIn, expectEmpty }) => {
        const results = document.getElementById('bank-results');
        const workspace = document.getElementById('bank-workspace');
        const loginEmpty = document.getElementById('bank-login-token').value === '' && document.getElementById('bank-login-csrf').value === '';
        const values = Array.from(document.querySelectorAll('input,textarea'), input => input.value);
        const html = document.documentElement.outerHTML;
        const noSecretDom = secretValues.every(secret => !html.includes(secret) && values.every(value => !value.includes(secret)));
        const safeResults = Array.from(results.querySelectorAll('*')).every(element =>
          ['MAIN', 'H1', 'ASIDE', 'DL', 'DT', 'DD', 'UL', 'LI', 'SPAN'].includes(element.tagName) && element.attributes.length === 0);
        return {
          authInputsEmpty: loginEmpty, noSecretDom, safeResults,
          storageEmpty: window.localStorage.length === 0 && window.sessionStorage.length === 0,
          sessionViewCorrect: workspace.hidden === !expectSignedIn && document.getElementById('bank-sign-in').hidden === expectSignedIn,
          resultsEmpty: results.childNodes.length === 0,
          clearedInputs: !expectEmpty || values.every(value => value === ''),
        };
      }, { secretValues, expectSignedIn, expectEmpty });
      const cookiesEmpty = (await context.cookies()).length === 0;
      ensure(dom.authInputsEmpty && dom.noSecretDom && dom.safeResults && dom.storageEmpty && dom.sessionViewCorrect &&
        dom.clearedInputs && cookiesEmpty && (!expectEmpty || dom.resultsEmpty));
      return { ...dom, cookiesEmpty };
    }
    async function waitCompleted(endpointId, status, requestPhase) {
      await page.waitForFunction(({ endpointId, status, requestPhase }) => {
        const app = document.getElementById('bank-app');
        const result = document.getElementById('bank-status');
        return app.dataset.busy === 'false' && result.dataset.endpoint === endpointId &&
          result.dataset.status === String(status) && result.dataset.phase === requestPhase;
      }, { endpointId, status, requestPhase }, { timeout: timeoutMs });
    }
    async function httpFor(meta, path, trigger) {
      const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.origin === baseURL && url.pathname === path && response.request().method() === meta.method;
      }, { timeout: timeoutMs });
      const [response] = await Promise.all([responsePromise, trigger()]);
      return response;
    }
    async function login(role, credentials, expectedStatus = 200) {
      const meta = byId.get(role === 'customer' ? 'account-me' : 'operations-pending');
      await page.locator('#bank-login-role').selectOption(role);
      await page.locator('#bank-login-token').fill(credentials.token);
      await page.locator('#bank-login-csrf').fill(credentials.csrf);
      const response = await httpFor(meta, meta.path, () => page.locator('#bank-login-submit').click());
      ensure(response.status() === expectedStatus);
      await waitCompleted(meta.endpointId, response.status(), 'login');
      const dom = await evidence(expectedStatus === 200, expectedStatus !== 200);
      if (expectedStatus === 200) ensure(await page.locator('#bank-workspace').getAttribute('data-role') === role);
      records.push({ phase: 'login', endpointId: meta.endpointId, role, status: response.status(), dom });
    }
    async function logout() {
      await page.locator('#bank-logout').click();
      const dom = await evidence(false, true);
      records.push({ phase: 'logout', dom });
    }
    async function action(step, failure = false) {
      const meta = byId.get(step.endpointId);
      await page.locator('#bank-nav-' + meta.endpointId).click();
      ensure(await page.locator('#bank-nav-' + meta.endpointId).getAttribute('aria-pressed') === 'true');
      const form = page.locator('#bank-form-' + meta.endpointId);
      ensure(await form.isVisible());
      for (const [name, value] of Object.entries(step.fields)) await form.locator('[name="' + name + '"]').fill(value);
      const values = await form.evaluate(form => Object.fromEntries(Array.from(form.querySelectorAll('[name]'), field => [field.name, field.value])));
      const response = await httpFor(meta, expectedPath(meta, values), () => form.locator('button[type="submit"]').click());
      ensure(step.expectedStatuses.includes(response.status()));
      // Do not parse JSON numeric tokens: compare exact body bytes, including
      // non-rounded Long literals and string Money/revision representations.
      const exactWire = response.request().postData() === expectedBody(meta.endpointId, values);
      ensure(exactWire);
      const url = new URL(response.url());
      if (['sip-list', 'sip-occurrences', 'operations-pending'].includes(meta.endpointId)) {
        ensure(url.searchParams.get('limit') === (values.limit || '50') && url.searchParams.get('after') === (values.after || '0') &&
          Array.from(url.searchParams.keys()).length === 2);
      } else ensure(url.search === '');
      const wideLong = hasWideLong(meta, values);
      wideLongWireObserved ||= wideLong;
      await waitCompleted(meta.endpointId, response.status(), 'action');
      const signedIn = ![401, 403].includes(response.status());
      const dom = await evidence(signedIn, !signedIn);
      if (signedIn) {
        const result = await page.locator('#bank-results').textContent();
        ensure(result.includes(disclaimer));
        for (const text of step.assertText ?? []) ensure(result.includes(text));
      }
      records.push({ phase: failure ? 'failure-action' : 'action', endpointId: meta.endpointId, role: meta.role,
        status: response.status(), exactWire, wideLong, dom });
      return signedIn;
    }

    let activeRole = null;
    for (const step of config.actions) {
      const meta = byId.get(step.endpointId);
      phase = 'action-' + meta.endpointId;
      if (activeRole !== meta.role) {
        if (activeRole) await logout();
        await login(meta.role, config.credentials[meta.role]);
        activeRole = meta.role;
      }
      if (!await action(step)) activeRole = null;
    }
    ensure(wideLongWireObserved);
    if (activeRole) await logout();
    for (const failure of config.failures) {
      phase = 'failure-' + failure.kind + '-' + failure.role + '-' + failure.expectedStatus;
      if (failure.kind === 'login') await login(failure.role, failure.credentials, failure.expectedStatus);
      else {
        await login(failure.role, failure.credentials);
        // The successful protected login provided business DOM. A subsequent
        // authorization/CSRF failure must remove it as well as all entered fields.
        ensure((await page.locator('#bank-results').textContent()).trim().length > 0);
        ensure(!await action({ ...failure.action, expectedStatuses: [failure.expectedStatus] }, true));
      }
    }
    phase = 'refresh-requires-login';
    await login('customer', config.credentials.customer);
    await page.reload({ waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => document.getElementById('bank-app')?.dataset.ready === 'true', null, { timeout: timeoutMs });
    records.push({ phase: 'refresh', dom: await evidence(false, true) });
    await context.close();
    context = undefined;
    return { schemaVersion: 'bank-browser-check/v1', completed: true, wideLongWireObserved, records };
  } catch (_) {
    // Playwright errors may include fill arguments or response bodies. Never
    // retain/print their message, stack, cause or request headers.
    if (context) { try { await context.close(); } catch (_) { /* bounded cleanup */ } }
    throw new BankBrowserCheckError({ schemaVersion: 'bank-browser-check/v1', completed: false,
      failureAt: phase, wideLongWireObserved, records });
  }
}

async function cli(args) {
  let browser;
  try {
    ensure(args.length === 6);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      ensure(['--config', '--browser-module', '--browser-executable'].includes(args[index]) && !options[args[index]] && isAbsolute(args[index + 1]));
      options[args[index]] = args[index + 1];
    }
    ensure(Object.keys(options).length === 3);
    const config = (await import(pathToFileURL(options['--config']).href)).default;
    ensure(config?.synthetic === true);
    const installed = await import(pathToFileURL(options['--browser-module']).href);
    const chromium = installed.chromium ?? installed.default?.chromium;
    ensure(chromium && typeof chromium.launch === 'function');
    // Explicit caller-invoked CLI only; launch never downloads a browser.
    browser = await chromium.launch({ executablePath: options['--browser-executable'], headless: true });
    const report = await runBankBrowserCheck({ ...config, browser });
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch (error) {
    const report = error instanceof BankBrowserCheckError ? error.report : {
      schemaVersion: 'bank-browser-check/v1', completed: false, failureAt: 'cli-configuration-or-browser', records: [],
    };
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) { process.exitCode = 1; } }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cli(process.argv.slice(2));
