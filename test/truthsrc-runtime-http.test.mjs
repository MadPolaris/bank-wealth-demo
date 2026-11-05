import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseProductionHttp, exerciseTransportAuth } from '../tools/truthsrc-runtime-http.mjs';

const credentials = { customer: { token: 'customer-test-secret', csrf: 'customer-csrf-secret' },
  collection: { token: 'collection-test-secret', csrf: 'collection-csrf-secret' }, operator: { token: 'operator-test-secret', csrf: 'operator-csrf-secret' } };
const origin = 'http://127.0.0.1:18761';
const money = minorUnits => ({ minorUnits, currency: 'CNY' });
const original = suffix => ({ principalId: 'customer', clientRequestId: 'browser-' + suffix, authorityVersion: 'runtime-v1',
  request: { clientRequestId: 'browser-' + suffix, fundCode: 'fund', amount: money('10000') },
  payment: { operationId: 'op-' + suffix, fundOrderId: 'order-' + suffix, investorAccountId: 'customer', fundCollectionAccountId: 'collection', fundCode: 'fund', amount: money('10000') } });
const revision = { revision: 'initial', effectiveSlot: 0, investorAccountId: 'customer', fundCollectionAccountId: 'collection', fundCode: 'fund', amount: money('1000') };
const metadata = { disposition: 'caught-up' };
function fixture() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname;
    let value;
    if (path === '/api/v1/accounts/me') value = { metadata, account: { available: money(options.headers.Authorization.includes('collection') ? '12000' : '88000'), reserved: money('0') } };
    else if (path.startsWith('/api/v1/cash-requests/')) value = { metadata, request: { original: original(path.endsWith('refund') ? 'refund' : 'cash') } };
    else if (path.startsWith('/api/v1/orders/')) {
      const refund = path.endsWith('refund'), o = original(refund ? 'refund' : 'cash');
      value = { metadata, order: { orderId: o.payment.fundOrderId, operationId: o.payment.operationId, paymentTxId: 'tx-' + o.payment.operationId,
        taRequestId: 'ta-' + o.payment.operationId, investorAccountId: 'customer', fundCollectionAccountId: 'collection', fundCode: 'fund', amount: money('10000'),
        paymentStatus: 'succeeded', taStatus: refund ? 'rejected' : 'confirmed', refundStatus: refund ? 'succeeded' : 'not-required',
        ...(refund ? { refundOperationId: 'refund-op' } : { taShares: { fundCode: 'fund', shares: '80.0000', nav: '1.2345' } }) } };
    } else if (path === '/api/v1/sip-plans') value = { metadata: { disposition: 'unknown' }, plans: [{ planId: 'plan' }] };
    else if (path === '/api/v1/sip-plans/plan') value = { metadata, plan: { planId: 'plan', initialized: true, scheduleSealed: true,
      paused: false, dueSlots: [10, 20], scheduleCount: 2, observedCount: 2, startCount: 2, successTotal: 2, failureTotal: 0,
      original: { principalId: 'customer', clientRequestId: 'browser-sip', authorityVersion: 'runtime-v1', planId: 'plan', config: revision,
        request: { clientRequestId: 'browser-sip', fundCode: 'fund', amount: money('1000'), effectiveSlot: 0, dueSlots: [10, 20] } } } };
    else if (path.endsWith('/occurrences')) value = { metadata, occurrences: [10, 20].map(dueSlot => ({
      occurrence: { planId: 'plan', revision: 'initial', dueSlot, occurrenceId: 'occ-' + dueSlot, operationId: 'sip-op-' + dueSlot, fundOrderId: 'sip-order-' + dueSlot, config: revision },
      paymentStatus: 'succeeded', taStatus: 'confirmed', refundStatus: 'not-required', firstTerminal: 'succeeded',
    })) };
    else throw new Error('unexpected route');
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test('restart and replay are GET-only and preserve exact four-flow financial identity views', async () => {
  for (const mode of ['restart', 'replay']) {
    const f = fixture(), result = await exerciseProductionHttp({ origin, credentials, mode, fetchImpl: f.fetchImpl,
      pollTimeoutMs: 1000, pollIntervalMs: 1 }).catch(error => assert.fail(JSON.stringify(error.report)));
    assert.equal(result.completed, true); assert.equal(result.counts.post, 0);
    assert.equal(result.plan.successTotal, 2); assert.equal(result.plan.failureTotal, 0);
    assert.equal(result.accounts.customer.available.minorUnits, '88000');
    assert.equal(result.orders.cash.order.taShares.shares, '80.0000');
    if (mode === 'replay') assert.equal(result.orders.refund.order.refundStatus, 'succeeded');
    assert.ok(!JSON.stringify(result).includes('test-secret'));
  }
});

test('invalid origins, credentials and unknown option never reach fetch', async () => {
  for (const patch of [{ origin: 'http://example.com:18761' }, { origin: 'http://localhost:18761' }, { origin: 'http://127.0.0.1:9000' },
    { origin: 'http://127.0.0.1:18761/escape' }, { credentials: {} }, { mode: 'unknown' }, { anything: true }]) {
    let calls = 0;
    await assert.rejects(exerciseProductionHttp({ origin, credentials, mode: 'replay', fetchImpl: () => { calls++; }, ...patch }), error => error.report.failureAt === 'configuration');
    assert.equal(calls, 0);
  }
});

test('HTTP error reports do not retain exception or response secrets', async () => {
  const secret = credentials.customer.token;
  await assert.rejects(exerciseProductionHttp({ origin, credentials, mode: 'restart', fetchImpl: async () => { throw new Error(secret); } }), error => {
    assert.ok(!JSON.stringify(error).includes(secret)); assert.ok(!error.message.includes(secret));
    assert.equal(error.report.completed, false); return true;
  });
  await assert.rejects(exerciseProductionHttp({ origin, credentials, mode: 'restart', fetchImpl: async () => new Response(secret, { status: 500 }) }),
    error => !JSON.stringify(error.report).includes(secret));
});

test('transport auth and injection rejection performs no successful business writes', async () => {
  const calls = [];
  const result = await exerciseTransportAuth({ origin, credentials, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const h = options.headers;
    let status = 400;
    if (!h.Authorization || h.Authorization.includes(', ')) status = 401;
    else if (h.Authorization.includes('operator') || url.includes('/operations/') || !h.Origin || h.Origin.includes(', ') ||
      !h['X-CSRF-Token'] || h['X-CSRF-Token'].endsWith('-invalid') || h['X-CSRF-Token'].includes(', ')) status = 403;
    return new Response('{}', { status });
  } });
  assert.equal(result.completed, true);
  assert.equal(result.records.length, 21);
  assert.equal(result.journalEventsVerified, false);
  assert.ok(result.records.every(row => row.status >= 400));
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('oversized and redirected responses are rejected before receipt data escapes', async () => {
  for (const fetchImpl of [async () => new Response('{}', { headers: { 'content-length': '262145' } }),
    async () => ({ status: 200, redirected: true, url: origin + '/api/v1/accounts/me', headers: new Headers() })]) {
    await assert.rejects(exerciseProductionHttp({ origin, credentials, mode: 'restart', fetchImpl }), error => error.report.completed === false);
  }
});
