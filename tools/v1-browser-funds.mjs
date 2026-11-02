#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BANK_ACTIONS } from './v1-browser-check.mjs';

const actions = new Map(BANK_ACTIONS.map(action => [action.endpointId, action]));
const disclaimer = 'Payment success, TA acceptance and technical effect confirmation are not investment success.';
const modes = new Set(['initial', 'resume-cash', 'restart', 'refund', 'replay']);

export class BankBrowserFundsError extends Error {
  constructor(report) {
    super('Bank browser funds check failed; inspect the redacted report.');
    this.report = report;
  }
}

function configuration(config) {
  assert.equal(config?.synthetic, true);
  assert.ok(modes.has(config.mode));
  const url = new URL(config.baseURL);
  assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port &&
    !['9000', '2551', '27017', '3306'].includes(url.port) && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash);
  for (const role of ['customer', 'collection', 'operator']) {
    const issued = config.credentials?.[role];
    assert.ok(issued && ['token', 'csrf'].every(key => typeof issued[key] === 'string' && issued[key].length > 0 &&
      !/[\r\n]/.test(issued[key])));
  }
  assert.equal(new Set(Object.values(config.credentials).map(value => value.token)).size, 3);
  assert.equal(typeof config.browser?.newContext, 'function');
  return url.origin;
}

// The page renderer represents every primitive as visible text; never coerce Money or Longs to Number.
export function readFields(element) {
  if (element.tagName === 'SPAN') return element.textContent;
  if (element.tagName === 'UL') return Array.from(element.children, child => readFields(child.firstElementChild));
  if (element.tagName !== 'DL') throw new Error('Unexpected rendered value');
  const value = Object.create(null);
  const children = Array.from(element.children);
  if (children.length % 2) throw new Error('Incomplete rendered object');
  for (let index = 0; index < children.length; index += 2) {
    const key = children[index];
    const field = children[index + 1];
    if (key.tagName !== 'DT' || field.tagName !== 'DD' || Object.hasOwn(value, key.textContent))
      throw new Error('Invalid rendered field');
    value[key.textContent] = readFields(field.firstElementChild);
  }
  return value;
}

export async function runBankBrowserFunds(config) {
  const records = [];
  let phase = 'configuration';
  let context;
  let active;
  try {
    const baseURL = configuration(config);
    context = await config.browser.newContext({ baseURL, serviceWorkers: 'block' });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    phase = 'shell';
    assert.equal((await page.goto(baseURL + '/bank/v1', { waitUntil: 'load' })).status(), 200);
    await page.waitForFunction(() => document.getElementById('bank-app')?.dataset.ready === 'true');
    assert.equal(await page.locator('form[data-endpoint]').count(), 14);
    async function hygiene(signedIn) {
      const clean = await page.evaluate(({ secrets, signedIn }) => {
        const values = Array.from(document.querySelectorAll('input,textarea'), input => input.value);
        return localStorage.length === 0 && sessionStorage.length === 0 &&
          document.getElementById('bank-login-token').value === '' && document.getElementById('bank-login-csrf').value === '' &&
          document.getElementById('bank-workspace').hidden === !signedIn &&
          secrets.every(secret => !document.documentElement.outerHTML.includes(secret) && values.every(value => !value.includes(secret)));
      }, { secrets: Object.values(config.credentials).flatMap(value => [value.token, value.csrf]), signedIn });
      assert.ok(clean && (await context.cookies()).length === 0);
    }
    async function response(meta, path, trigger, requestPhase) {
      const waiting = page.waitForResponse(result => {
        const url = new URL(result.url());
        return url.origin === baseURL && url.pathname === path && result.request().method() === meta.method;
      });
      const [result] = await Promise.all([waiting, trigger()]);
      await page.waitForFunction(({ id, status, requestPhase }) => {
        const app = document.getElementById('bank-app');
        const state = document.getElementById('bank-status');
        return app.dataset.busy === 'false' && state.dataset.endpoint === id && state.dataset.phase === requestPhase &&
          state.dataset.status === String(status);
      }, { id: meta.endpointId, status: result.status(), requestPhase });
      records.push({ phase, endpoint: meta.endpointId, method: meta.method, status: result.status() });
      return result;
    }
    async function login(role) {
      if (active === role) return;
      if (active) {
        await page.locator('#bank-logout').click();
        await hygiene(false);
        active = undefined;
      }
      const audience = role === 'operator' ? 'operator' : 'customer';
      const meta = actions.get(audience === 'operator' ? 'operations-pending' : 'account-me');
      await page.locator('#bank-login-role').selectOption(audience);
      await page.locator('#bank-login-token').fill(config.credentials[role].token);
      await page.locator('#bank-login-csrf').fill(config.credentials[role].csrf);
      assert.equal((await response(meta, meta.path, () => page.locator('#bank-login-submit').click(), 'login')).status(), 200);
      await hygiene(true);
      active = role;
    }
    async function action(id, fields = {}, expectedStatus = 200, role = actions.get(id).role) {
      const meta = actions.get(id);
      await login(role);
      await page.locator('#bank-nav-' + id).click();
      const form = page.locator('#bank-form-' + id);
      for (const [name, value] of Object.entries(fields)) {
        assert.ok(meta.fields.includes(name) && typeof value === 'string');
        await form.locator('[name="' + name + '"]').fill(value);
      }
      const path = meta.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key) => encodeURIComponent(fields[key]));
      const result = await response(meta, path, () => form.locator('button[type="submit"]').click(), 'action');
      assert.equal(result.status(), expectedStatus);
      await hygiene(true);
      assert.ok((await page.locator('#bank-results').textContent()).includes(disclaimer));
      return page.locator('#bank-results main > dl').evaluate(readFields);
    }
    async function eventually(id, fields, predicate, role) {
      const deadline = Date.now() + 75000;
      for (;;) {
        const value = await action(id, fields, 200, role);
        if (predicate(value)) return value;
        assert.ok(Date.now() < deadline, 'Business view did not converge');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    const caught = value => value.metadata?.disposition === 'caught-up';
    if (config.mode === 'replay') {
      const orders = [];
      for (const clientRequestId of ['browser-cash', 'browser-refund']) {
        phase = 'replay-' + clientRequestId;
        const request = await eventually('cash-original', { clientRequestId }, value => caught(value) && value.request !== 'none');
        const original = request.request.original;
        const order = await eventually('order-detail', { orderId: original.payment.fundOrderId }, value => caught(value) &&
          (clientRequestId === 'browser-cash' ? value.order?.taStatus === 'confirmed' : value.order?.taStatus === 'rejected' && value.order?.refundStatus === 'succeeded'));
        orders.push({ original, order: order.order, metadata: order.metadata });
      }
      assert.equal(orders[0].order.taShares.shares, '80.0000');
      assert.equal(orders[0].order.taShares.nav, '1.2345');
      phase = 'replay-sip';
      const listed = await eventually('sip-list', { limit: '10', after: '0' }, value => value.plans?.length === 1);
      assert.equal(listed.metadata.disposition, 'unknown');
      const planId = listed.plans[0].planId;
      const plan = await eventually('sip-detail', { planId }, value => caught(value) && value.plan?.successTotal === '2');
      assert.equal(plan.plan.failureTotal, '0');
      assert.equal(plan.plan.startCount, '2');
      const occurrences = await eventually('sip-occurrences', { planId, limit: '10', after: '0' }, value => caught(value) &&
        value.occurrences?.length === 2 && value.occurrences.every(row => row.firstTerminal === 'succeeded'));
      phase = 'replay-conservation';
      const customer = await eventually('account-me', {}, value => caught(value) && value.account?.available.minorUnits === '88000', 'customer');
      const collection = await eventually('account-me', {}, value => caught(value) && value.account?.available.minorUnits === '12000', 'collection');
      assert.equal(customer.account.reserved.minorUnits, '0');
      assert.equal(collection.account.reserved.minorUnits, '0');
      await page.locator('#bank-logout').click();
      await hygiene(false);
      await context.close(); context = undefined;
      return { schemaVersion: 'bank-browser-funds/v1', completed: true, mode: config.mode, records, orders, plan, occurrences,
        accounts: { customer, collection }, transport: 'Chromium rendered GET forms only; no business writes' };
    }
    const cash = { clientRequestId: config.mode === 'refund' ? 'browser-refund' : 'browser-cash',
      fundCode: 'fund', minorUnits: '10000', currency: 'CNY' };
    phase = 'starting-balance';
    const initial = await eventually('account-me', {}, value => caught(value) && value.account !== 'none');
    assert.equal(initial.account.available.minorUnits, config.mode === 'initial' ? '100000' : config.mode === 'resume-cash' ? '90000' : '88000');
    phase = 'cash-submit';
    const ack = await action('cash-submit', cash);
    const original = ack.original;
    assert.ok(original?.payment?.fundOrderId && original.payment.operationId);
    phase = 'cash-duplicate';
    assert.deepEqual((await action('cash-submit', cash)).original, original);
    phase = 'cash-conflict';
    await action('cash-submit', { ...cash, minorUnits: '10001' }, 409);
    phase = 'cash-original';
    const persisted = await eventually('cash-original', { clientRequestId: cash.clientRequestId }, value => caught(value) && value.request !== 'none');
    assert.equal(persisted.request.original.payment.fundOrderId, original.payment.fundOrderId);
    const orderFields = { orderId: original.payment.fundOrderId };
    phase = 'cash-ta-accepted';
    await eventually('order-detail', orderFields, value => caught(value) && ['accepted', 'confirmed'].includes(value.order?.taStatus));
    if (config.mode !== 'restart') {
      phase = 'cash-ta-tick';
      await action('business-tick', { slot: config.mode === 'refund' ? '22' : '1' });
    }
    phase = config.mode === 'refund' ? 'refund-completed' : 'cash-confirmed';
    const terminal = await eventually('order-detail', orderFields, value => caught(value) && value.order?.paymentStatus === 'succeeded' &&
      (config.mode === 'refund' ? value.order.taStatus === 'rejected' && value.order.refundStatus === 'succeeded' : value.order.taStatus === 'confirmed'));
    let planEvidence;
    if (config.mode === 'refund') {
      assert.ok(terminal.order.refundOperationId && terminal.order.refundOperationId !== 'none' && terminal.order.refundOperationId !== original.payment.operationId);
      phase = 'refund-duplicate';
      assert.deepEqual((await action('cash-submit', cash)).original, original);
    } else {
      assert.equal(terminal.order.taShares.shares, '80.0000');
      assert.equal(terminal.order.taShares.nav, '1.2345');
      const sip = { clientRequestId: 'browser-sip', fundCode: 'fund', minorUnits: '1000', currency: 'CNY', effectiveSlot: '0', dueSlots: '10,20' };
      phase = 'sip-create';
      const plan = await action('sip-create', sip);
      assert.ok(plan.planId);
      assert.equal((await action('sip-create', sip)).planId, plan.planId);
      if (['initial', 'resume-cash'].includes(config.mode)) {
        phase = 'sip-clock-initialization'; await action('business-tick', { slot: '1' });
        phase = 'sip-pause'; await action('sip-pause', { planId: plan.planId });
        phase = 'sip-resume'; await action('sip-resume', { planId: plan.planId });
        phase = 'sip-tick'; await action('business-tick', { slot: '20' });
        phase = 'sip-accepted';
        await eventually('sip-occurrences', { planId: plan.planId, limit: '10', after: '0' }, value => value.occurrences?.length === 2 &&
          value.occurrences.every(row => ['accepted', 'confirmed'].includes(row.taStatus)));
        phase = 'sip-ta-tick'; await action('business-tick', { slot: '21' });
      }
      phase = 'sip-terminal';
      const state = await eventually('sip-detail', { planId: plan.planId }, value => caught(value) && value.plan?.successTotal === '2');
      assert.equal(state.plan.failureTotal, '0');
      assert.equal(state.plan.startCount, '2');
      assert.equal(state.plan.observedCount, '2');
      const occurrences = await action('sip-occurrences', { planId: plan.planId, limit: '10', after: '0' });
      assert.equal(occurrences.occurrences.length, 2);
      assert.ok(occurrences.occurrences.every(row => row.taStatus === 'confirmed' && row.firstTerminal === 'succeeded'));
      planEvidence = { plan: state.plan, metadata: state.metadata, occurrences: occurrences.occurrences };
    }
    phase = 'conservation';
    const customer = await eventually('account-me', {}, value => caught(value) && value.account?.available.minorUnits === '88000', 'customer');
    const collection = await eventually('account-me', {}, value => caught(value) && value.account?.available.minorUnits === '12000', 'collection');
    assert.equal(customer.account.reserved.minorUnits, '0');
    assert.equal(collection.account.reserved.minorUnits, '0');
    phase = 'refresh-wipes-authentication';
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('bank-app')?.dataset.ready === 'true');
    await hygiene(false);
    assert.equal(await page.locator('#bank-results').textContent(), '');
    await context.close(); context = undefined;
    return { schemaVersion: 'bank-browser-funds/v1', completed: true, mode: config.mode, records,
      balances: { customer: '88000', collection: '12000', reserved: '0', currency: 'CNY' },
      original, terminal: terminal.order, planEvidence, accounts: { customer, collection },
      transport: 'Chromium rendered forms only; no direct API writes' };
  } catch (_) {
    if (context) { try { await context.close(); } catch (_) { /* preserve the original redacted failure */ } }
    throw new BankBrowserFundsError({ schemaVersion: 'bank-browser-funds/v1', completed: false, mode: config?.mode, failureAt: phase, records });
  }
}

async function cli(args) {
  let browser;
  try {
    assert.equal(args.length, 6);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      assert.ok(['--config', '--browser-module', '--browser-executable'].includes(args[index]) && !options[args[index]] && isAbsolute(args[index + 1]));
      options[args[index]] = args[index + 1];
    }
    const config = (await import(pathToFileURL(options['--config']).href)).default;
    configuration({ ...config, browser: { newContext() {} } });
    const installed = await import(pathToFileURL(options['--browser-module']).href);
    browser = await (installed.chromium ?? installed.default.chromium).launch({ executablePath: options['--browser-executable'], headless: true,
      args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    process.stdout.write(JSON.stringify(await runBankBrowserFunds({ ...config, browser })) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify(error instanceof BankBrowserFundsError ? error.report : {
      schemaVersion: 'bank-browser-funds/v1', completed: false, failureAt: 'cli-configuration-or-browser', records: [],
    }) + '\n');
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) { process.exitCode = 1; } }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cli(process.argv.slice(2));
