import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDoc } from '../../metarch-truthsrc/lib/shared.mjs';
import { ConflictError, PersistentMockTACore } from '../simulator/mock-ta-core.mjs';
import { canonicalJson, clone, digest, validateMockConfiguration } from '../simulator/contract.mjs';
import { readPinnedJson } from '../tools/truthsrc-actor-ta-worker.mjs';

const bank = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(bank, 'tools', 'truthsrc-actor-ta-worker.mjs');
const fixtureFile = path.join(bank, 'test', 'fixtures', 'truthsrc-actor-ta.json');
const fixtureBytes = fs.readFileSync(fixtureFile);
const fixtureSha256 = digest(fixtureBytes);
const fixture = JSON.parse(fixtureBytes);
const configuration = fixture.configuration;
const rounds = path.join(bank, '.local', 'mock-ta');
fs.mkdirSync(rounds, { recursive: true, mode: 0o700 });
const roundRoot = fs.mkdtempSync(path.join(rounds, 'truthsrc-actors-ta-tests-'));
let sequence = 0;

// All created files (including failed inputs and journals) remain in this NEW round.
// Never discover or run the historical mock-ta tests or import the real snapshot loader.
test.after(() => console.log(`Retained actor TA test round: ${roundRoot}`));
const writeNew = (file, bytes) => fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
function context() {
  const owned = path.join(roundRoot, `owner-b-application-test-${++sequence}`);
  fs.mkdirSync(owned, { mode: 0o700 });
  const config = { schemaVersion: 'bank.truthsrc-actor-ta/v1', ownedRoot: roundRoot,
    fixture: { file: fixtureFile, sha256: fixtureSha256 } };
  const configPath = path.join(owned, 'config.json');
  const bytes = JSON.stringify(config, null, 2) + '\n';
  writeNew(configPath, bytes);
  return { owned, journalPath: path.join(owned, 'ta.jsonl'), config, configPath,
    env: { BANK_ACTOR_TA_CONFIG: configPath, BANK_ACTOR_TA_CONFIG_SHA256: digest(bytes) } };
}
function recapture(ctx, value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  const file = path.join(ctx.owned, `capture-${++sequence}.json`);
  writeNew(file, bytes);
  return { BANK_ACTOR_TA_CONFIG: file, BANK_ACTOR_TA_CONFIG_SHA256: digest(bytes) };
}
const request = (scenario = 'confirmed', requestId = `request-${scenario}`) => ({ requestId,
  orderId: `order-${requestId}`, paymentTxId: `payment-${requestId}`,
  investorAccountId: 'test-investor', fundCollectionAccountId: 'test-collection',
  fundCode: 'test-fund', scenario, amount: { minorUnits: '10000', currency: configuration.currency } });
const message = (id, op, input = null) => ({ id, op, input });
const lines = (messages) => messages.map((value) => JSON.stringify(value)).join('\n') + '\n';
const stop = message(99, 'close');
function run(ctx, { args = [ctx.journalPath, ctx.owned], env = ctx.env, input = lines([stop]) } = {}) {
  const result = spawnSync(process.execPath, [worker, ...args], {
    cwd: ctx.owned, env, input, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const output = result.stdout ? result.stdout.trimEnd().split('\n').map((line) => {
    const parsed = JSON.parse(line);
    assert.equal(canonicalJson(parsed), line, 'stdout must contain only canonical protocol responses');
    return parsed;
  }) : [];
  return { ...result, output };
}
const receiptPath = (ctx, pid) => path.join(ctx.owned, `ta-worker-${pid}.json`);
function assertClosed(ctx, result, env = ctx.env) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const file = receiptPath(ctx, result.pid);
  assert.equal(fs.lstatSync(file).isFile(), true);
  assert.equal(fs.lstatSync(file).nlink, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), {
    schemaVersion: 'bank.truthsrc-actor-ta-worker/v1', pid: result.pid, journalPath: ctx.journalPath,
    ownedRoot: ctx.owned, roundRoot, configSha256: env.BANK_ACTOR_TA_CONFIG_SHA256,
    fixtureSha256, configurationDigest: digest(canonicalJson(configuration)), closed: true,
  });
  assert.ok(fs.statSync(ctx.journalPath).size > 0);
  assert.equal(fs.existsSync(`${ctx.journalPath}.lock`), false);
}
function assertFailed(ctx, result, pattern) {
  assert.equal(result.status, 1);
  assert.match(result.stderr, pattern);
  assert.equal(fs.existsSync(receiptPath(ctx, result.pid)), false, 'failure cannot attest closed:true');
}
function core(t, ctx = context(), options = {}) {
  const ta = new PersistentMockTACore({ configuration, journalPath: ctx.journalPath, ...options });
  t.after(() => ta.close());
  return { ta, ctx };
}

// The ONLY historical file read by this suite. The worker never reads this file.
test('fixture is the complete mechanical seven-scenario extraction with full-file SHA and pointer', () => {
  assert.deepEqual(Object.keys(fixture).sort(), ['configuration', 'interpretation', 'schemaVersion', 'source']);
  assert.equal(fixture.schemaVersion, 'bank.truthsrc-actor-ta-fixture/v1');
  assert.equal(fixture.interpretation, 'historical-frozen-test-fixture');
  assert.equal(fixture.source.file, 'tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml');
  assert.equal(fixture.source.pointer, '/payload/info/artifact/body/mockConfiguration');
  const bytes = fs.readFileSync(path.join(bank, fixture.source.file));
  assert.equal(fixture.source.sha256, digest(bytes));
  const original = fixture.source.pointer.slice(1).split('/').reduce((value, key) => value[key], parseDoc(bytes.toString('utf8')));
  assert.deepEqual(configuration, original);
  assert.equal(validateMockConfiguration(configuration), configuration);
  assert.deepEqual(configuration.scenarios.map(({ id }) => id), [
    'confirmed', 'rejected', 'delayed', 'unknown', 'accepted', 'duplicate-identical', 'duplicate-conflicting',
  ]);
  assert.deepEqual(configuration.scenarios[0].fixture, { shares: '80.0000', nav: '1.2345' });
  assert.deepEqual(configuration.scenarios.at(-1).conflictFixture, { shares: '81.0000', nav: '1.2468' });
});

test('core imports only contract and journal; worker does not import the historical wrapper', () => {
  const text = fs.readFileSync(path.join(bank, 'simulator', 'mock-ta-core.mjs'), 'utf8');
  assert.deepEqual([...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]), ['./contract.mjs', './journal.mjs']);
  assert.equal((text.match(/function fold\(/g) ?? []).length, 1);
  assert.doesNotMatch(text, /loadSnapshot|truth-source|DEFAULT_JOURNAL/);
  const entry = fs.readFileSync(worker, 'utf8');
  assert.doesNotMatch(entry, /loadSnapshot|truth-source|from ['"].*\/mock-ta\.mjs|child_process/);
  const wrapper = fs.readFileSync(path.join(bank, 'simulator', 'mock-ta.mjs'), 'utf8');
  assert.doesNotMatch(wrapper, /function fold\(/);
  assert.match(wrapper, /snapshot = loadSnapshot\(\), journalPath = DEFAULT_JOURNAL/);
});

test('compatibility wrapper retains exports, snapshot default, factory, IO and ConflictError identity without loading history', async (t) => {
  const snapshot = { atoms: [{ doc: { kind: 'note', payload: { info: { artifact: {
    id: 'contract.cash-purchase-v2', category: 'cash-purchase-contract', body: { mockConfiguration: configuration },
  } } } } }] };
  const stubUrl = `data:text/javascript,${encodeURIComponent(`export let calls = 0; export function loadSnapshot() { calls++; return ${JSON.stringify(snapshot)}; }`)}`;
  const wrapperUrl = pathToFileURL(path.join(bank, 'simulator', 'mock-ta.mjs')).href;
  const hooks = registerHooks({ resolve(specifier, ctx, next) {
    if (ctx.parentURL === wrapperUrl && specifier === '../tools/truth-source.mjs') return { url: stubUrl, shortCircuit: true };
    return next(specifier, ctx);
  } });
  let wrapper;
  try { wrapper = await import(wrapperUrl); } finally { hooks.deregister(); }
  assert.deepEqual(Object.keys(wrapper).sort(), ['ConflictError', 'PersistentMockTA', 'persistentMockTA']);
  assert.equal(wrapper.ConflictError, ConflictError);
  const stub = await import(stubUrl);
  const ctx = context();
  let barriers = 0;
  const ta = new wrapper.PersistentMockTA({ journalPath: ctx.journalPath, journalIO: {
    fsyncSync(fd) { barriers++; fs.fsyncSync(fd); },
  } });
  t.after(() => ta.close());
  assert.equal(stub.calls, 1);
  assert.equal(barriers, 1);
  assert.ok(ta instanceof PersistentMockTACore);
  ta.submit(request());
  assert.throws(() => ta.submit({ ...request(), orderId: 'different-test-order' }), wrapper.ConflictError);
  ta.close();
  const reopened = wrapper.persistentMockTA({ snapshot, journalPath: ctx.journalPath });
  t.after(() => reopened.close());
  assert.ok(reopened instanceof wrapper.PersistentMockTA);
  assert.equal(stub.calls, 1, 'explicit snapshot never uses default loading');
  assert.equal(reopened.query(request().requestId).status, 'accepted');
});

for (const scenario of configuration.scenarios) {
  test(`core preserves ${scenario.id} semantics, exact receipts and close/reopen`, (t) => {
    const { ta, ctx } = core(t);
    const input = request(scenario.id);
    const initial = ta.submit(input);
    assert.equal(initial.status, scenario.outcome === 'unknown' ? 'unknown' : 'accepted');
    assert.equal(initial.pending, true);
    assert.deepEqual(initial.request, input);
    if (scenario.delayTicks > 1) {
      ta.advanceClock(1);
      assert.equal(ta.query(input.requestId).status, 'accepted');
      ta.advanceBusinessClock(scenario.delayTicks - 1);
    } else ta.advanceClock(scenario.delayTicks);
    const final = ta.query(input.requestId);
    assert.equal(final.status, scenario.outcome);
    assert.equal(final.pending, !['confirmed', 'rejected'].includes(scenario.outcome));
    assert.deepEqual(final.canonicalReceipts[0], initial.canonicalReceipts[0]);
    for (const receipt of final.receipts) {
      for (const key of ['requestId', 'orderId', 'paymentTxId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount']) {
        assert.deepEqual(receipt[key], input[key]);
      }
    }
    if (scenario.outcome === 'confirmed') {
      assert.deepEqual(final.canonicalReceipts.at(-1).shares, { fundCode: input.fundCode, ...scenario.fixture });
      assert.notEqual(final.canonicalReceipts[0].receiptId, final.canonicalReceipts[1].receiptId);
      assert.equal(final.canonicalReceipts[0].taReference, final.canonicalReceipts[1].taReference);
    }
    if (scenario.outcome === 'rejected') assert.equal(final.canonicalReceipts.at(-1).reason, scenario.reason);
    if (scenario.delivery === 'identical-duplicate') {
      assert.equal(final.receipts.length, final.canonicalReceipts.length + 1);
      assert.deepEqual(final.receipts.at(-1), final.receipts.at(-2));
      assert.deepEqual(final.conflicts, []);
    } else if (scenario.delivery === 'conflicting-duplicate') {
      assert.equal(final.receipts.length, final.canonicalReceipts.length + 1);
      assert.equal(final.conflicts.length, 1);
      assert.equal(final.conflicts[0].code, 'RECEIPT_CONFLICT');
      assert.equal(final.receipts.at(-1).receiptId, final.receipts.at(-2).receiptId);
      assert.deepEqual(final.receipts.at(-1).shares, { fundCode: input.fundCode, ...scenario.conflictFixture });
      assert.deepEqual(final.conflicts[0].canonicalReceipt, final.canonicalReceipts.at(-1));
      assert.deepEqual(final.conflicts[0].conflictingReceipt, final.receipts.at(-1));
    } else assert.deepEqual(final.receipts, final.canonicalReceipts);
    ta.close();
    const before = fs.readFileSync(ctx.journalPath);
    const reopened = core(t, ctx).ta;
    assert.deepEqual(reopened.query(input.requestId), final);
    assert.deepEqual(reopened.submit(input), final);
    assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
  });
}

test('core validates original configuration, detaches and recursively freezes it', (t) => {
  const supplied = clone(configuration);
  const { ta } = core(t, context(), { configuration: supplied });
  supplied.scenarios.splice(0, 1);
  assert.deepEqual(ta.configuration, configuration);
  assert.notEqual(ta.configuration, configuration);
  function frozen(value) {
    if (value && typeof value === 'object') {
      assert.equal(Object.isFrozen(value), true);
      Object.values(value).forEach(frozen);
    }
  }
  frozen(ta.configuration);
  assert.throws(() => { ta.configuration.scenarios[0].fixture.nav = 'changed'; }, TypeError);
  assert.throws(() => new PersistentMockTACore(), /plain object/);
  assert.throws(() => new PersistentMockTACore({ configuration }), /journalPath/);
  const withGetter = clone(configuration);
  let evaluated = false;
  Object.defineProperty(withGetter, 'currency', { enumerable: true, get() { evaluated = true; return 'CNY'; } });
  const ctx = context();
  assert.throws(() => new PersistentMockTACore({ configuration: withGetter, journalPath: ctx.journalPath }), /accessors/);
  assert.equal(evaluated, false);
  assert.equal(fs.existsSync(ctx.journalPath), false);
});

test('core idempotence, conflicts, missing queries and zero tick are byte-preserving reads', (t) => {
  const { ta, ctx } = core(t);
  const input = request();
  const first = ta.submit(input);
  const before = fs.readFileSync(ctx.journalPath);
  assert.deepEqual(ta.submit(clone(input)), first);
  assert.throws(() => ta.submit({ ...input, paymentTxId: 'other-test-payment' }), (error) =>
    error instanceof ConflictError && error.code === 'REQUEST_CONFLICT' && error.requestId === input.requestId);
  assert.deepEqual(ta.query('absent-test-request').observation,
    { outcome: 'unknown', reason: 'REQUEST_NOT_FOUND', businessTick: configuration.initialBusinessTick });
  assert.deepEqual(ta.advanceClock(0).canonicalReceipts, []);
  for (const value of [-1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => ta.advanceClock(value), /safe integer/);
  first.request.orderId = 'mutated-response';
  first.receipts.length = 0;
  assert.equal(ta.query(input.requestId).request.orderId, input.orderId);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
  ta.close();
  ta.close();
  assert.throws(() => ta.query(input.requestId), { code: 'JOURNAL_CLOSED' });
});

test('core preserves synthetic wire precision without floating-point conversion or new fixture values', (t) => {
  const { ta } = core(t);
  const input = request();
  input.amount.minorUnits = '9'.repeat(40); // Codec boundary only, not a financial scenario default.
  ta.submit(input);
  ta.advanceClock(configuration.scenarios[0].delayTicks);
  const result = ta.query(input.requestId);
  assert.equal(result.request.amount.minorUnits, input.amount.minorUnits);
  assert.equal(result.receipts.at(-1).amount.minorUnits, input.amount.minorUnits);
  assert.deepEqual(result.receipts.at(-1).shares, { fundCode: input.fundCode, ...configuration.scenarios[0].fixture });
  assert.throws(() => ta.submit({ ...request('confirmed', 'bad-wire'), amount: { minorUnits: 10000, currency: 'CNY' } }));
});

test('core clock decisions remain lexical and pending-only scenarios do not become terminal', (t) => {
  const { ta } = core(t);
  for (const id of ['z-test', 'a-test']) ta.submit(request('confirmed', id));
  ta.submit(request('accepted'));
  ta.submit(request('unknown'));
  const advanced = ta.advanceClock(configuration.scenarios.find(({ id }) => id === 'delayed').delayTicks);
  assert.deepEqual(advanced.canonicalReceipts.map(({ requestId }) => requestId), ['a-test', 'z-test']);
  assert.deepEqual(advanced.pendingRequestIds, ['request-accepted', 'request-unknown']);
  assert.equal(ta.query('request-unknown').status, 'unknown');
});

test('core keeps Journal locking and configuration-digest checks on nonempty reopen', (t) => {
  const { ta, ctx } = core(t);
  ta.submit(request());
  const before = fs.readFileSync(ctx.journalPath);
  assert.throws(() => new PersistentMockTACore({ configuration, journalPath: ctx.journalPath }), { code: 'JOURNAL_LOCKED' });
  ta.close();
  const changed = clone(configuration);
  changed.scenarios.reverse(); // Same frozen values, different canonical configuration digest.
  assert.throws(() => new PersistentMockTACore({ configuration: changed, journalPath: ctx.journalPath }), { code: 'CONFIG_CHANGED' });
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
  assert.equal(core(t, ctx).ta.query(request().requestId).status, 'accepted');
});

test('core retains journalIO barriers, poisoning and same-journal recovery after an unacknowledged append', (t) => {
  let failBarrier = false;
  const { ta, ctx } = core(t, context(), { journalIO: { fsyncSync(fd) {
    if (failBarrier) throw new Error('test-only injected barrier failure');
    fs.fsyncSync(fd);
  } } });
  failBarrier = true;
  assert.throws(() => ta.submit(request()), { code: 'JOURNAL_IO' });
  assert.throws(() => ta.query(request().requestId), { code: 'JOURNAL_POISONED' });
  ta.close();
  const before = fs.readFileSync(ctx.journalPath);
  const reopened = core(t, ctx).ta;
  assert.equal(reopened.submit(request()).status, 'accepted');
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
});

test('pinned JSON captures exactly once and hashes the buffer it parses', (t) => {
  const ctx = context();
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', (...args) => { reads++; return original(...args); });
  const captured = readPinnedJson(ctx.configPath, ctx.env.BANK_ACTOR_TA_CONFIG_SHA256);
  assert.deepEqual(captured.value, ctx.config);
  assert.equal(captured.sha256, ctx.env.BANK_ACTOR_TA_CONFIG_SHA256);
  assert.equal(reads, 1);
});

for (const [label, bytes, pattern] of [
  ['duplicate fixture field', '{"configuration":{},"configuration":{}}', /duplicate object key/],
  ['escaped duplicate fixture key', '{"source":{"sha256":"a","sha\\u003256":"b"}}', /duplicate object key/],
  ['invalid UTF-8', Buffer.from([0xc3, 0x28]), /invalid UTF-8/],
  ['BOM', Buffer.from('﻿{}'), /expected JSON/],
  ['trailing data', '{}{}', /trailing JSON/],
  ['fractional number', '{"tick":1.5}', /safe integer/],
]) {
  test(`pinned JSON rejects ${label} even when the bytes have the expected SHA`, () => {
    const ctx = context();
    const env = recapture(ctx, bytes);
    assert.throws(() => readPinnedJson(env.BANK_ACTOR_TA_CONFIG, env.BANK_ACTOR_TA_CONFIG_SHA256), pattern);
  });
}

test('worker submit/query/advance/conflict/close protocol and exclusive receipt', () => {
  const ctx = context();
  const input = request();
  const result = run(ctx, { input: lines([
    message(1, 'submit', input), message(2, 'submit', input),
    message(3, 'submit', { ...input, orderId: 'another-test-order' }),
    message(4, 'advance', configuration.scenarios[0].delayTicks), message(5, 'query', input.requestId), stop,
  ]) });
  assertClosed(ctx, result);
  assert.deepEqual(result.output.map(({ id, ok }) => [id, ok]), [[1, true], [2, true], [3, false], [4, true], [5, true], [99, true]]);
  assert.deepEqual(result.output[0].result, result.output[1].result);
  assert.equal(result.output[2].error.code, 'REQUEST_CONFLICT');
  assert.equal(result.output[4].result.status, 'confirmed');
  assert.deepEqual(result.output[4].result.receipts.at(-1).shares, { fundCode: input.fundCode, ...configuration.scenarios[0].fixture });
  assert.deepEqual(result.output.at(-1).result, { closed: true });
  assert.equal(fs.readFileSync(ctx.journalPath, 'utf8').trimEnd().split('\n').length, 3);
});

test('worker reopens this round nonempty journal without rewriting it and emits a new PID receipt', () => {
  const ctx = context();
  const first = run(ctx, { input: lines([message(1, 'submit', request('delayed')), stop]) });
  assertClosed(ctx, first);
  const before = fs.readFileSync(ctx.journalPath);
  const second = run(ctx, { input: lines([message(1, 'query', 'request-delayed'), message(2, 'submit', request('delayed')), stop]) });
  assertClosed(ctx, second);
  assert.notEqual(first.pid, second.pid);
  assert.deepEqual(second.output[0].result, first.output[0].result);
  assert.deepEqual(second.output[1].result, first.output[0].result);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
  assert.ok(fs.existsSync(receiptPath(ctx, first.pid)));
});

test('worker treats EOF as clean close, including an unterminated final request', () => {
  const ctx = context();
  const result = run(ctx, { input: JSON.stringify(message(7, 'query', 'missing-test')) });
  assertClosed(ctx, result);
  assert.equal(result.output[0].id, 7);
  assert.equal(result.output[0].result.status, 'unknown');
});

for (const [label, change, pattern] of [
  ['no environment', () => ({}), /are required/],
  ['missing SHA', (ctx) => ({ BANK_ACTOR_TA_CONFIG: ctx.configPath }), /are required/],
  ['missing config', (ctx) => ({ BANK_ACTOR_TA_CONFIG_SHA256: ctx.env.BANK_ACTOR_TA_CONFIG_SHA256 }), /are required/],
  ['malformed SHA', (ctx) => ({ ...ctx.env, BANK_ACTOR_TA_CONFIG_SHA256: 'invalid' }), /lowercase SHA-256/],
  ['wrong config SHA', (ctx) => ({ ...ctx.env, BANK_ACTOR_TA_CONFIG_SHA256: '0'.repeat(64) }), /SHA-256 mismatch/],
  ['unknown config schema', (ctx) => recapture(ctx, { ...ctx.config, schemaVersion: 'unsupported' }), /schema or round/],
  ['unknown config field', (ctx) => recapture(ctx, { ...ctx.config, configuration }), /unexpected fields/],
  ['missing fixture', (ctx) => recapture(ctx, { schemaVersion: ctx.config.schemaVersion, ownedRoot: roundRoot }), /unexpected fields/],
  ['wrong round', (ctx) => recapture(ctx, { ...ctx.config, ownedRoot: ctx.owned }), /round ownership/],
  ['round alias', (ctx) => recapture(ctx, { ...ctx.config, ownedRoot: roundRoot + '/.' }), /round ownership/],
  ['duplicate config key', (ctx) => recapture(ctx, JSON.stringify(ctx.config).replace('{', '{"schemaVersion":"bank.truthsrc-actor-ta/v1",')), /duplicate object key/],
  ['duplicate nested key', (ctx) => recapture(ctx, JSON.stringify(ctx.config).replace('"fixture":{', '"fixture":{"sha256":"' + fixtureSha256 + '",')), /duplicate object key/],
  ['invalid config JSON', (ctx) => recapture(ctx, '{not-json'), /expected string/],
  ['null config', (ctx) => recapture(ctx, 'null'), /plain object/],
  ['fixture wrong SHA', (ctx) => recapture(ctx, { ...ctx.config, fixture: { file: fixtureFile, sha256: '0'.repeat(64) } }), /SHA-256 mismatch/],
  ['fixture bad SHA', (ctx) => recapture(ctx, { ...ctx.config, fixture: { file: fixtureFile, sha256: 'not-sha256' } }), /lowercase SHA-256/],
  ['fixture extra field', (ctx) => recapture(ctx, { ...ctx.config, fixture: { ...ctx.config.fixture, extra: true } }), /unexpected fields/],
  ['fixture path substitution', (ctx) => recapture(ctx, { ...ctx.config, fixture: { ...ctx.config.fixture, file: ctx.configPath } }), /fixed repository/],
  ['fixture path alias', (ctx) => recapture(ctx, { ...ctx.config, fixture: { ...ctx.config.fixture, file: path.dirname(fixtureFile) + '/./truthsrc-actor-ta.json' } }), /fixed repository/],
  ['relative config path', (ctx) => ({ ...ctx.env, BANK_ACTOR_TA_CONFIG: 'config.json' }), /canonical absolute/],
  ['config path alias', (ctx) => ({ ...ctx.env, BANK_ACTOR_TA_CONFIG: ctx.owned + '/./config.json' }), /canonical absolute/],
  ['config case alias', (ctx) => ({ ...ctx.env, BANK_ACTOR_TA_CONFIG: path.join(ctx.owned, 'CONFIG.json') }), /aliases|ENOENT/],
  ['config outside round', (ctx) => ({ ...ctx.env, BANK_ACTOR_TA_CONFIG: fixtureFile }), /inside this actor round/],
]) {
  test(`worker rejects ${label} before journal initialization`, () => {
    const ctx = context();
    const result = run(ctx, { env: change(ctx) });
    assertFailed(ctx, result, pattern);
    assert.deepEqual(result.output, []);
    assert.equal(fs.existsSync(ctx.journalPath), false);
  });
}

for (const [label, args] of [
  ['extra argv', (ctx) => [ctx.journalPath, ctx.owned, '--ignored']],
  ['missing argv', (ctx) => [ctx.journalPath]],
  ['relative journal', (ctx) => ['ta.jsonl', ctx.owned]],
  ['journal traversal', (ctx) => [ctx.owned + '/../ta.jsonl', ctx.owned]],
  ['journal dot alias', (ctx) => [ctx.owned + '/./ta.jsonl', ctx.owned]],
  ['journal doubled slash', (ctx) => [ctx.owned + '//ta.jsonl', ctx.owned]],
  ['journal wrong filename', (ctx) => [ctx.owned + '/other.jsonl', ctx.owned]],
  ['journal outside owner', (ctx) => [roundRoot + '/ta.jsonl', ctx.owned]],
  ['journal nested below owner', (ctx) => [ctx.owned + '/nested/ta.jsonl', ctx.owned]],
  ['owner trailing slash', (ctx) => [ctx.journalPath, ctx.owned + '/']],
  ['owner nested below round', (ctx) => [ctx.owned + '/owner-b-application-nested/ta.jsonl', ctx.owned + '/owner-b-application-nested']],
  ['owner wrong prefix', () => [roundRoot + '/other/ta.jsonl', roundRoot + '/other']],
  ['round wrong prefix', () => [rounds + '/not-an-actor-round/owner-b-application-test/ta.jsonl', rounds + '/not-an-actor-round/owner-b-application-test']],
  ['ancestor case alias', (ctx) => [ctx.journalPath.replace('bank-wealth-demo', 'Bank-wealth-demo'), ctx.owned.replace('bank-wealth-demo', 'Bank-wealth-demo')]],
]) {
  test(`worker rejects ${label} without writing a journal`, () => {
    const ctx = context();
    assertFailed(ctx, run(ctx, { args: args(ctx) }), /WORKER_PATH/);
    assert.equal(fs.existsSync(ctx.journalPath), false);
  });
}

for (const kind of ['symlink', 'hardlink', 'directory']) {
  for (const target of ['config', 'journal', 'lock']) {
    test(`worker rejects ${kind} ${target} without overwriting its target`, () => {
      const ctx = context();
      const original = Buffer.from('test-only sentinel');
      const targetFile = path.join(ctx.owned, 'link-target');
      writeNew(targetFile, original);
      const candidate = target === 'config' ? path.join(ctx.owned, 'linked-config.json')
        : ctx.journalPath + (target === 'lock' ? '.lock' : '');
      if (kind === 'symlink') fs.symlinkSync(targetFile, candidate);
      else if (kind === 'hardlink') fs.linkSync(targetFile, candidate);
      else fs.mkdirSync(candidate);
      const env = target === 'config' ? { ...ctx.env, BANK_ACTOR_TA_CONFIG: candidate } : ctx.env;
      assertFailed(ctx, run(ctx, { env }), /WORKER_PATH/);
      assert.deepEqual(fs.readFileSync(targetFile), original);
    });
  }
}

test('worker rejects symlinked owner and config ancestors', () => {
  const ctx = context();
  const alias = path.join(roundRoot, `owner-b-application-alias-${++sequence}`);
  fs.symlinkSync(ctx.owned, alias);
  assertFailed(ctx, run(ctx, { args: [path.join(alias, 'ta.jsonl'), alias] }), /Symlinks/);
  const link = path.join(ctx.owned, 'config-parent-alias');
  fs.symlinkSync(ctx.owned, link);
  assertFailed(ctx, run(ctx, { env: { ...ctx.env, BANK_ACTOR_TA_CONFIG: path.join(link, 'config.json') } }), /Symlinks/);
  assert.equal(fs.existsSync(ctx.journalPath), false);
});

test('worker never steals an existing lock or initializes over an existing empty journal', () => {
  const locked = context();
  const lockBytes = Buffer.from('retained-test-lock-not-owned-by-worker');
  writeNew(locked.journalPath + '.lock', lockBytes);
  assertFailed(locked, run(locked), /JOURNAL_LOCKED/);
  assert.deepEqual(fs.readFileSync(locked.journalPath + '.lock'), lockBytes);
  assert.equal(fs.existsSync(locked.journalPath), false);
  const empty = context();
  writeNew(empty.journalPath, '');
  assertFailed(empty, run(empty), /empty\/incomplete/);
  assert.equal(fs.statSync(empty.journalPath).size, 0);
  assert.equal(fs.existsSync(empty.journalPath + '.lock'), false);
});

test('worker refuses a live core writer, then reopens the same retained nonempty journal', (t) => {
  const { ta, ctx } = core(t);
  ta.submit(request());
  const before = fs.readFileSync(ctx.journalPath);
  const lock = fs.readFileSync(ctx.journalPath + '.lock');
  assertFailed(ctx, run(ctx), /JOURNAL_LOCKED/);
  assert.deepEqual(fs.readFileSync(ctx.journalPath + '.lock'), lock);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
  ta.close();
  const reopened = run(ctx, { input: lines([message(1, 'query', request().requestId), stop]) });
  assertClosed(ctx, reopened);
  assert.equal(reopened.output[0].result.status, 'accepted');
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
});

for (const [label, input, pattern] of [
  ['malformed JSON', '{', /expected string/],
  ['duplicate request id', '{"id":1,"id":1,"op":"close","input":null}\n', /duplicate object key/],
  ['invalid id', lines([message(-1, 'query', 'test')]), /safe integer/],
  ['invalid UTF-8', Buffer.from([0xff, 0x0a]), /invalid UTF-8/],
  ['oversized unfinished line', ' '.repeat(65537), /capacity exceeded/],
  ['oversized terminated line', ' '.repeat(65537) + '\n', /capacity exceeded/],
]) {
  test(`worker fatal ${label} does not produce a clean-close receipt`, () => {
    const ctx = context();
    assertFailed(ctx, run(ctx, { input }), pattern);
    assert.ok(fs.statSync(ctx.journalPath).size > 0);
    assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false);
  });
}

test('worker accepts the exact 65,536-byte boundary with CRLF', () => {
  const ctx = context();
  const query = JSON.stringify(message(1, 'query', 'missing-test'));
  const result = run(ctx, { input: query + ' '.repeat(65536 - Buffer.byteLength(query)) + '\r\n' + lines([stop]) });
  assertClosed(ctx, result);
  assert.equal(result.output.length, 2);
});

test('worker normal request errors remain correlated protocol replies, not fatal shutdowns', () => {
  const ctx = context();
  const result = run(ctx, { input: lines([
    message(1, 'unknown-op'), message(2, 'submit', {}), message(3, 'advance', -1),
    { ...message(4, 'query', 'test'), extra: true }, stop,
  ]) });
  assertClosed(ctx, result);
  assert.deepEqual(result.output.map(({ id, ok }) => [id, ok]), [[1, false], [2, false], [3, false], [4, false], [99, true]]);
});

test('worker fatal input retains prior submission for subsequent same-journal reopen', () => {
  const ctx = context();
  const failed = run(ctx, { input: lines([message(1, 'submit', request())]) + '{' });
  assertFailed(ctx, failed, /expected string/);
  assert.equal(failed.output[0].result.status, 'accepted');
  const before = fs.readFileSync(ctx.journalPath);
  const reopened = run(ctx, { input: lines([message(2, 'query', request().requestId), stop]) });
  assertClosed(ctx, reopened);
  assert.deepEqual(reopened.output[0].result, failed.output[0].result);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
});

test('worker broken stdout during close cannot issue a clean-close receipt', { timeout: 10000 }, async (t) => {
  const ctx = context();
  const child = spawn(process.execPath, [worker, ctx.journalPath, ctx.owned], {
    cwd: ctx.owned, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(child, 'close');
  const output = readline.createInterface({ input: child.stdout });
  const responses = output[Symbol.asyncIterator]();
  t.after(() => { child.stdin.end(); output.close(); });
  child.stdin.write(lines([message(1, 'query', 'missing-test')]));
  assert.equal(JSON.parse((await responses.next()).value).ok, true);
  output.close();
  child.stdout.destroy();
  child.stdin.end(lines([stop]));
  const [code, signal] = await exited;
  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.match(stderr, /EPIPE/);
  assert.equal(fs.existsSync(receiptPath(ctx, child.pid)), false);
  assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false);
  assert.ok(fs.statSync(ctx.journalPath).size > 0);
});

test('worker never overwrites an existing exclusive PID receipt or reports clean close after that failure', { timeout: 10000 }, async (t) => {
  const ctx = context();
  const child = spawn(process.execPath, [worker, ctx.journalPath, ctx.owned], {
    cwd: ctx.owned, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(child, 'close');
  const output = readline.createInterface({ input: child.stdout });
  const responses = output[Symbol.asyncIterator]();
  t.after(() => { child.stdin.end(); output.close(); });
  child.stdin.write(lines([message(1, 'query', 'missing-test')]));
  assert.equal(JSON.parse((await responses.next()).value).ok, true);
  const sentinel = '{"closed":false,"test":"exclusive-receipt-sentinel"}\n';
  writeNew(receiptPath(ctx, child.pid), sentinel);
  child.stdin.end(lines([stop]));
  const reply = JSON.parse((await responses.next()).value);
  assert.equal(reply.id, stop.id);
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, 'EEXIST');
  const [code, signal] = await exited;
  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.match(stderr, /EEXIST/);
  assert.equal(fs.readFileSync(receiptPath(ctx, child.pid), 'utf8'), sentinel);
  assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false);
  assert.ok(fs.statSync(ctx.journalPath).size > 0);
});
