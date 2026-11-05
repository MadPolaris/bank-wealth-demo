import { isDeepStrictEqual } from 'node:util';

const schemaVersion = 'bank-truthsrc-runtime-http/v1';
const modes = ['initial', 'restart', 'refund', 'replay'];
const roles = ['customer', 'collection', 'operator'];
const check = condition => { if (!condition) throw new Error('HTTP oracle requirement failed.'); };
const equal = (a, b) => check(isDeepStrictEqual(a, b));
const keys = (value, expected) => equal(Object.keys(value).sort(), [...expected].sort());
const pick = (value, fields) => Object.fromEntries(fields.split(' ').map(key => [key, value[key] ?? null]));
const caught = value => value.metadata?.disposition === 'caught-up';
const money = minorUnits => ({ minorUnits, currency: 'CNY' });
const cashBody = clientRequestId => ({ clientRequestId, fundCode: 'fund', amount: money('10000') });
const sipBody = clientRequestId => ({ clientRequestId, fundCode: 'fund', amount: money('1000'), effectiveSlot: 0, dueSlots: [10, 20] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export class RuntimeHttpError extends Error {
  constructor(report) {
    super('Production HTTP oracle failed; inspect the redacted report.');
    this.name = 'RuntimeHttpError';
    this.report = report;
  }
}

// No import-time I/O. The controller owns fresh credentials, server scenario, DB isolation,
// source binding and journal comparisons. namespace is only a public client-request prefix.
async function exercise(config, negative) {
  const records = [];
  let phase = 'configuration', mode = null;
  try {
    check(config && Object.keys(config).every(key => ['origin', 'credentials', 'mode', 'namespace', 'fetchImpl',
      'requestTimeoutMs', 'pollTimeoutMs', 'pollIntervalMs'].includes(key)));
    mode = negative ? 'transport-auth' : modes.includes(config.mode) ? config.mode : null;
    check(mode && (!negative || config.mode === undefined || config.mode === mode));
    check(typeof config.origin === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/?$/.test(config.origin));
    const url = new URL(config.origin), port = Number(url.port), origin = url.origin;
    check(port > 1024 && port < 65536 && ![9000, 2551, 27017, 3306].includes(port));
    keys(config.credentials, roles);
    const credentials = Object.fromEntries(roles.map(role => {
      const value = config.credentials[role];
      keys(value, ['token', 'csrf']);
      check([value.token, value.csrf].every(text => typeof text === 'string' && /^[A-Za-z0-9._~+/=-]{1,4096}$/.test(text)));
      return [role, { token: value.token, csrf: value.csrf }];
    }));
    check(new Set(roles.map(role => credentials[role].token)).size === 3);
    const secrets = Object.values(credentials).flatMap(value => [value.token, value.csrf]);
    const namespace = config.namespace ?? (negative ? 'http-negative' : 'browser');
    check(typeof namespace === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(namespace));
    const bounded = (key, fallback, max) => {
      const value = config[key] ?? fallback;
      check(Number.isInteger(value) && value > 0 && value <= max);
      return value;
    };
    const requestTimeout = bounded('requestTimeoutMs', 10000, 15000);
    const pollTimeout = bounded('pollTimeoutMs', 75000, 75000), interval = bounded('pollIntervalMs', 500, 1000);
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    check(typeof fetchImpl === 'function');
    const deadline = performance.now() + 180000;
    const readOnly = mode === 'restart' || mode === 'replay';
    const counts = () => ({ requests: records.length, get: records.filter(r => r.method === 'GET').length,
      post: records.filter(r => r.method === 'POST').length });
    async function request(step, path, body, role = 'customer', expected = 200, protection = 'normal', until = deadline) {
      phase = step;
      const method = body === undefined ? 'GET' : 'POST';
      check(!readOnly || method === 'GET');
      check(path.startsWith('/api/v1/') && records.length < 512);
      const remaining = Math.min(requestTimeout, deadline - performance.now(), until - performance.now());
      check(remaining > 0);
      const headers = { Accept: 'application/json' };
      if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', Origin: origin });
      if (role) headers.Authorization = 'Bearer ' + credentials[role].token;
      if (body !== undefined && role) headers['X-CSRF-Token'] = credentials[role].csrf;
      if (protection === 'missing-csrf') delete headers['X-CSRF-Token'];
      if (protection === 'missing-origin') delete headers.Origin;
      if (protection === 'wrong-csrf') headers['X-CSRF-Token'] += '-invalid';
      if (protection === 'extra-csrf') headers['X-CSRF-Token'] += ', extra';
      if (protection === 'extra-origin') headers.Origin += ', ' + origin;
      if (protection === 'extra-auth') headers.Authorization += ', ' + headers.Authorization;
      const controller = new AbortController();
      let timer, reader;
      try {
        return await Promise.race([new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('HTTP deadline exceeded.')); }, remaining);
        }), (async () => {
          const response = await fetchImpl(origin + path, { method, headers, redirect: 'error', credentials: 'omit',
            cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
            ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
          check(!controller.signal.aborted && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599);
          records.push({ step, method, status: response.status });
          check(!response.redirected && (!response.url || response.url === origin + path));
          const length = response.headers.get('content-length');
          check(length === null || (/^[0-9]+$/.test(length) && Number(length) <= 262144));
          reader = response.body?.getReader();
          check(reader);
          const chunks = [];
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            check(size <= 262144);
            chunks.push(value);
          }
          equal(response.status, expected);
          // Rejection bodies (including server errors) are never returned or inspected.
          return expected === 200 ? JSON.parse(Buffer.concat(chunks, size).toString('utf8')) : null;
        })()]);
      } finally {
        clearTimeout(timer);
        controller.abort();
        if (reader) Promise.resolve(reader.cancel()).catch(() => {});
      }
    }
    async function eventually(step, path, predicate, role) {
      const until = Math.min(deadline, performance.now() + pollTimeout);
      for (;;) {
        const value = await request(step, path, undefined, role, 200, 'normal', until);
        if (predicate(value)) return value;
        check(performance.now() + interval < until);
        await pause(interval);
      }
    }
    if (negative) {
      // Run in the controller's independent HTTP-test namespace, before any admitted writes.
      // A bad server could accept a forbidden request: never mix this oracle with four-flow funds.
      const body = cashBody(namespace + '-denied'), path = '/api/v1/cash-requests';
      await request('unauthenticated', path, body, null, 401);
      await request('operator-cannot-purchase', path, body, 'operator', 403);
      await request('customer-cannot-reconcile', '/api/v1/operations/not-existing/reconcile', {}, 'customer', 403);
      for (const protection of ['missing-csrf', 'missing-origin', 'wrong-csrf', 'extra-csrf', 'extra-origin', 'extra-auth'])
        await request(protection, path, body, 'customer', protection === 'extra-auth' ? 401 : 403, protection);
      for (const field of ['principalId', 'roles', 'accountId', 'investorAccountId', 'fundCollectionAccountId',
        'taReceipt', 'forcedResult', 'refundDestination', 'authorization', 'transactionId'])
        await request('reject-' + field, path, { ...body, [field]: 'injected' }, 'customer', 400);
      await request('reject-nested-amount-field', path, { ...body, amount: { ...body.amount, accountId: 'injected' } }, 'customer', 400);
      await request('reject-duplicate-clientRequestId', path, JSON.stringify(body).slice(0, -1) + ',"clientRequestId":"second"}', 'customer', 400);
      return { schemaVersion, completed: true, mode, records, counts: counts(), journalEventsVerified: false };
    }
    const id = suffix => namespace + '-' + suffix;
    const resource = value => {
      check(typeof value === 'string' && /^[A-Za-z0-9._:/+=-]{1,2048}$/.test(value) && value !== 'none');
      check(!secrets.some(secret => value.includes(secret)));
      return value;
    };
    const originalView = value => {
      const result = pick(value, 'principalId clientRequestId authorityVersion');
      Object.values(result).forEach(resource);
      result.request = pick(value.request, 'clientRequestId fundCode amount');
      result.request.amount = pick(value.request.amount, 'minorUnits currency');
      result.payment = pick(value.payment, 'operationId fundOrderId investorAccountId fundCollectionAccountId fundCode');
      Object.values(result.payment).forEach(resource);
      result.payment.amount = pick(value.payment.amount, 'minorUnits currency');
      equal(result.request, cashBody(result.clientRequestId));
      equal(result.payment.amount, money('10000')); equal(result.payment.fundCode, 'fund');
      return result;
    };
    const revisionView = value => {
      const result = pick(value, 'revision effectiveSlot investorAccountId fundCollectionAccountId fundCode');
      for (const key of ['revision', 'investorAccountId', 'fundCollectionAccountId', 'fundCode']) resource(result[key]);
      equal(result.revision, 'initial'); equal(result.effectiveSlot, 0); equal(result.fundCode, 'fund');
      result.amount = pick(value.amount, 'minorUnits currency'); equal(result.amount, money('1000'));
      return result;
    };
    const tick = slot => request('business-tick-' + slot, '/api/v1/business-clock/tick', { slot }, 'operator');
    const orderPath = original => '/api/v1/orders/' + encodeURIComponent(resource(original.payment.fundOrderId));
    async function accounts(customerMinor, collectionMinor) {
      const result = {};
      for (const [role, minor] of [['customer', customerMinor], ['collection', collectionMinor]]) {
        const value = await eventually('balance-' + role, '/api/v1/accounts/me', v => caught(v) && v.account?.available?.minorUnits === minor, role);
        equal(value.account.available, money(minor)); equal(value.account.reserved, money('0'));
        result[role] = { available: money(minor), reserved: money('0') };
      }
      return result;
    }
    async function readOriginal(suffix) {
      const value = await eventually('original-' + suffix, '/api/v1/cash-requests/' + id(suffix), v => caught(v) && v.request?.original);
      const original = originalView(value.request.original);
      equal(original.clientRequestId, id(suffix));
      return original;
    }
    const terminal = (order, refund) => order?.paymentStatus === 'succeeded' && (refund
      ? order.taStatus === 'rejected' && order.refundStatus === 'succeeded' : order.taStatus === 'confirmed');
    if (!readOnly) {
      await accounts(mode === 'initial' ? '100000' : '88000', mode === 'initial' ? '0' : '12000');
      const suffix = mode === 'refund' ? 'refund' : 'cash', body = cashBody(id(suffix)), path = '/api/v1/cash-requests';
      const original = originalView((await request('cash-submit', path, body)).original);
      equal(original.clientRequestId, id(suffix));
      equal(originalView((await request('cash-duplicate', path, body)).original), original);
      await request('cash-conflict', path, { ...body, amount: money('10001') }, 'customer', 409);
      equal(await readOriginal(suffix), original);
      await eventually('cash-ta-accepted', orderPath(original), v => caught(v) && v.order?.paymentStatus === 'succeeded' &&
        ['accepted', mode === 'refund' ? 'rejected' : 'confirmed'].includes(v.order?.taStatus));
      await tick(mode === 'refund' ? 22 : 1);
      const settled = await eventually('cash-terminal', orderPath(original), v => caught(v) && terminal(v.order, mode === 'refund'));
      if (mode === 'refund') equal(originalView((await request('refund-duplicate', path, body)).original), original);
      else {
        equal(settled.order.taShares, { fundCode: 'fund', shares: '80.0000', nav: '1.2345' });
        const sip = sipBody(id('sip'));
        const planId = resource((await request('sip-create', '/api/v1/sip-plans', sip)).planId);
        equal((await request('sip-duplicate', '/api/v1/sip-plans', sip)).planId, planId);
        const path = '/api/v1/sip-plans/' + encodeURIComponent(planId);
        await tick(1);
        await request('sip-pause', path + '/pause', {}); await request('sip-resume', path + '/resume', {});
        for (const [slot, count] of [[10, 1], [20, 2]]) {
          await tick(slot);
          await eventually('sip-ta-accepted', path + '/occurrences?limit=10&after=0', v => caught(v) &&
            v.occurrences?.length === count && v.occurrences.every(row => ['accepted', 'confirmed'].includes(row.taStatus)));
        }
        await tick(21);
      }
    }
    const orders = {};
    for (const suffix of ['cash', ...(['refund', 'replay'].includes(mode) ? ['refund'] : [])]) {
      const original = await readOriginal(suffix);
      const value = await eventually('terminal-' + suffix, orderPath(original), v => caught(v) && terminal(v.order, suffix === 'refund'));
      const order = pick(value.order, 'orderId operationId paymentTxId taRequestId paymentStatus taStatus refundOperationId refundStatus');
      for (const key of ['orderId', 'operationId', 'paymentTxId', 'taRequestId']) resource(order[key]);
      equal(order.orderId, original.payment.fundOrderId); equal(order.operationId, original.payment.operationId);
      equal(value.order.amount, money('10000')); equal(value.order.fundCode, 'fund');
      equal(value.order.investorAccountId, original.payment.investorAccountId);
      equal(value.order.fundCollectionAccountId, original.payment.fundCollectionAccountId);
      if (suffix === 'refund') {
        resource(order.refundOperationId); check(order.refundOperationId !== order.operationId);
        check(value.order.taShares == null);
      } else {
        equal(value.order.taShares, { fundCode: 'fund', shares: '80.0000', nav: '1.2345' });
        equal(order.refundStatus, 'not-required'); check(order.refundOperationId === null);
        order.taShares = { ...value.order.taShares };
      }
      orders[suffix] = { original, order };
    }
    const listed = await eventually('sip-list', '/api/v1/sip-plans?limit=10&after=0', v => v.plans?.length === 1);
    equal(listed.metadata.disposition, 'unknown');
    const planId = resource(listed.plans[0].planId), planPath = '/api/v1/sip-plans/' + encodeURIComponent(planId);
    const state = await eventually('sip-terminal', planPath, v => caught(v) && v.plan?.successTotal === 2);
    const plan = pick(state.plan, 'planId initialized scheduleSealed paused dueSlots scheduleCount observedCount startCount successTotal failureTotal');
    equal(plan, { planId, initialized: true, scheduleSealed: true, paused: false, dueSlots: [10, 20],
      scheduleCount: 2, observedCount: 2, startCount: 2, successTotal: 2, failureTotal: 0 });
    plan.original = pick(state.plan.original, 'principalId clientRequestId authorityVersion planId');
    Object.values(plan.original).forEach(resource);
    plan.original.request = pick(state.plan.original.request, 'clientRequestId fundCode amount effectiveSlot dueSlots');
    equal(plan.original.request, sipBody(id('sip'))); equal(plan.original.planId, planId);
    equal(plan.original.clientRequestId, id('sip')); equal(plan.original.principalId, orders.cash.original.principalId);
    equal(plan.original.authorityVersion, orders.cash.original.authorityVersion);
    plan.original.config = revisionView(state.plan.original.config);
    for (const key of ['investorAccountId', 'fundCollectionAccountId']) equal(plan.original.config[key], orders.cash.original.payment[key]);
    const page = await eventually('sip-occurrences', planPath + '/occurrences?limit=10&after=0', v => caught(v) &&
      v.occurrences?.length === 2 && v.occurrences.every(row => row.firstTerminal === 'succeeded'));
    const occurrences = page.occurrences.map(row => {
      equal(row.paymentStatus, 'succeeded'); equal(row.taStatus, 'confirmed'); equal(row.refundStatus, 'not-required');
      equal(row.occurrence.planId, planId); equal(row.occurrence.revision, 'initial');
      const occurrence = pick(row.occurrence, 'planId revision dueSlot occurrenceId operationId fundOrderId');
      for (const key of ['occurrenceId', 'operationId', 'fundOrderId']) resource(occurrence[key]);
      occurrence.config = revisionView(row.occurrence.config); equal(occurrence.config, plan.original.config);
      return { occurrence, paymentStatus: row.paymentStatus, taStatus: row.taStatus,
        refundStatus: row.refundStatus, firstTerminal: row.firstTerminal };
    });
    equal(occurrences.map(row => row.occurrence.dueSlot), [10, 20]);
    for (const key of ['occurrenceId', 'operationId', 'fundOrderId']) check(new Set(occurrences.map(row => row.occurrence[key])).size === 2);
    const balances = await accounts('88000', '12000');
    const receipt = { schemaVersion, completed: true, mode, namespace, records, counts: counts(), orders, plan, occurrences, accounts: balances,
      planListDisposition: 'unknown', scopedViewsDisposition: 'caught-up', journalEventsVerified: false,
      semantics: 'Payment success and TA acceptance are not investment success; refund is independent of committed payment.' };
    const serialized = JSON.stringify(receipt);
    check(serialized.length <= 262144 && !secrets.some(secret => serialized.includes(secret)));
    return receipt;
  } catch (_) {
    // Never expose a fetch/JSON/assertion error, response body, headers, credentials or cause.
    throw new RuntimeHttpError({ schemaVersion, completed: false, mode, failureAt: phase, records });
  }
}

export async function exerciseProductionHttp(config) { return exercise(config, false); }
export async function exerciseTransportAuth(config) { return exercise(config, true); }
