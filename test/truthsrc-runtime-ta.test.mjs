import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { canonicalJson, digest } from '../simulator/contract.mjs';
import { RUNTIME_TA_CRASH_CASES } from '../tools/truthsrc-runtime-ta-worker.mjs';

const bank = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(bank, 'tools', 'truthsrc-runtime-ta-worker.mjs');
const fixtureFile = path.join(bank, 'test', 'fixtures', 'truthsrc-actor-ta.json');
const fixtureBytes = fs.readFileSync(fixtureFile);
const fixtureSha256 = digest(fixtureBytes);
const { configuration } = JSON.parse(fixtureBytes);
const rounds = path.join(bank, '.local', 'mock-ta');
fs.mkdirSync(rounds, { recursive: true, mode: 0o700 });
const prefix = path.join(rounds, `truthsrc-runtime-ta-tests-${process.pid}-${Date.now()}-`);
let roundCount = 0;
let sequence = 0;
// Each context is a NEW direct runtime round. Keep all captures, journals, failures
// and receipts; never load the historical snapshot/controller or clean evidence.
test.after(() => console.log(`Retained runtime TA test rounds (${roundCount}): ${prefix}*`));
const writeNew = (file, bytes) => fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
function context(owner = 'service') {
  const roundRoot = fs.mkdtempSync(prefix);
  roundCount++;
  const owned = path.join(roundRoot, owner);
  fs.mkdirSync(owned, { mode: 0o700 });
  const config = { schemaVersion: 'bank.truthsrc-runtime-ta/v1', ownedRoot: roundRoot,
    fixture: { file: fixtureFile, sha256: fixtureSha256 } };
  const configPath = path.join(roundRoot, 'config.json');
  const bytes = JSON.stringify(config, null, 2) + '\n';
  writeNew(configPath, bytes);
  return { roundRoot, owned, journalPath: path.join(owned, 'ta.jsonl'), config, configPath,
    env: { BANK_RUNTIME_TA_CONFIG: configPath, BANK_RUNTIME_TA_CONFIG_SHA256: digest(bytes) } };
}
function recapture(ctx, value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  const file = path.join(ctx.owned, `capture-${++sequence}.json`);
  writeNew(file, bytes);
  return { BANK_RUNTIME_TA_CONFIG: file, BANK_RUNTIME_TA_CONFIG_SHA256: digest(bytes) };
}
const request = (scenario = 'confirmed') => ({ requestId: `request-${scenario}`,
  orderId: `order-${scenario}`, paymentTxId: `payment-${scenario}`,
  investorAccountId: 'test-investor', fundCollectionAccountId: 'test-collection',
  fundCode: 'test-fund', scenario, amount: { minorUnits: '10000', currency: configuration.currency } });
const message = (id, op, input = null) => ({ id, op, input });
const lines = (messages) => messages.map((value) => JSON.stringify(value)).join('\n') + '\n';
const stop = message(99, 'close');
function parseReply(line) {
  const parsed = JSON.parse(line);
  assert.equal(canonicalJson(parsed), line, 'stdout contains only canonical protocol replies');
  return parsed;
}
function run(ctx, { args = [ctx.journalPath, ctx.owned], env = ctx.env, input = lines([stop]) } = {}) {
  const result = spawnSync(process.execPath, [worker, ...args], {
    cwd: ctx.owned, env, input, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { ...result, output: result.stdout ? result.stdout.trimEnd().split('\n').map(parseReply) : [] };
}
const receiptPath = (ctx, pid) => path.join(ctx.owned, `ta-worker-${pid}.json`);
function assertClosed(ctx, result, env = ctx.env) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const file = receiptPath(ctx, result.pid);
  const stat = fs.lstatSync(file);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.nlink, 1);
  assert.equal(stat.mode & 0o777, 0o600);
  const receipt = { schemaVersion: 'bank.truthsrc-runtime-ta-worker/v1', pid: result.pid,
    journalPath: ctx.journalPath, ownedRoot: ctx.owned, roundRoot: ctx.roundRoot,
    configSha256: env.BANK_RUNTIME_TA_CONFIG_SHA256, fixtureSha256,
    configurationDigest: digest(canonicalJson(configuration)), closed: true };
  assert.equal(fs.readFileSync(file, 'utf8'), canonicalJson(receipt) + '\n');
  assert.ok(fs.statSync(ctx.journalPath).size > 0);
  assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false, 'worker itself releases its lock');
}
function assertFailed(ctx, result, pattern) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, pattern);
  assert.equal(fs.existsSync(receiptPath(ctx, result.pid)), false, 'no clean-close attestation on failure');
}
function live(t, ctx) {
  const child = spawn(process.execPath, [worker, ctx.journalPath, ctx.owned], {
    cwd: ctx.owned, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(child, 'close').then(([status, signal]) => ({ status, signal, stderr, pid: child.pid }));
  const output = readline.createInterface({ input: child.stdout });
  const responses = output[Symbol.asyncIterator]();
  t.after(() => { child.stdin.end(); output.close(); child.stdout.resume(); });
  return { child, output, exited, next: async () => parseReply((await responses.next()).value) };
}

test('runtime entry is a shared-loop adapter with a frozen closed 24-case manifest', () => {
  assert.equal(RUNTIME_TA_CRASH_CASES.length, 24);
  assert.equal(new Set(RUNTIME_TA_CRASH_CASES).size, 24);
  assert.equal(Object.isFrozen(RUNTIME_TA_CRASH_CASES), true);
  const text = fs.readFileSync(worker, 'utf8');
  assert.deepEqual([...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]), [
    'node:path', 'node:url', '../simulator/contract.mjs', './truthsrc-actor-ta-worker.mjs',
  ]);
  assert.match(text, /runConfiguredWorker\(loadInputs\)/);
  assert.doesNotMatch(text, /loadSnapshot|truth-source|child_process|new PersistentMockTA|requestLines|process\.stdout/);
});

for (const name of RUNTIME_TA_CRASH_CASES) {
  test(`runtime admits the direct fixed case owner case-${name}`, () => {
    const ctx = context(`case-${name}`);
    const result = run(ctx);
    assertClosed(ctx, result);
    assert.deepEqual(result.output, [{ id: 99, ok: true, result: { closed: true } }]);
  });
}

test('service owner uses the unchanged seven scenes and pinned fixture with an in-owner config', () => {
  const ctx = context();
  const env = recapture(ctx, ctx.config);
  const scenarios = configuration.scenarios;
  assert.deepEqual(scenarios.map(({ id }) => id), [
    'confirmed', 'rejected', 'delayed', 'unknown', 'accepted', 'duplicate-identical', 'duplicate-conflicting',
  ]);
  const result = run(ctx, { env, input: lines([
    ...scenarios.map(({ id }, index) => message(index, 'submit', request(id))),
    message(10, 'advance', Math.max(...scenarios.map(({ delayTicks }) => delayTicks))),
    ...scenarios.map(({ id }, index) => message(20 + index, 'query', request(id).requestId)), stop,
  ]) });
  assertClosed(ctx, result, env);
  assert.equal(result.output.every(({ ok }) => ok), true);
  scenarios.forEach((scenario, index) => {
    const response = result.output[8 + index].result;
    assert.equal(response.status, scenario.outcome);
    assert.equal(response.pending, !['confirmed', 'rejected'].includes(scenario.outcome));
    assert.deepEqual(response.request, request(scenario.id));
    if (scenario.outcome === 'confirmed') {
      assert.deepEqual(response.canonicalReceipts.at(-1).shares, { fundCode: 'test-fund', ...scenario.fixture });
    }
    if (scenario.outcome === 'rejected') assert.equal(response.receipts.at(-1).reason, scenario.reason);
    if (scenario.delivery === 'identical-duplicate') assert.deepEqual(response.receipts.at(-1), response.receipts.at(-2));
    if (scenario.delivery === 'conflicting-duplicate') assert.equal(response.conflicts[0].code, 'RECEIPT_CONFLICT');
  });
});

test('EOF closes without a close request and permits a byte-preserving same-journal reopen', () => {
  const ctx = context('case-ta-intent-before-submit');
  const first = run(ctx, { input: JSON.stringify(message(1, 'submit', request('delayed'))) });
  assertClosed(ctx, first);
  const before = fs.readFileSync(ctx.journalPath);
  const second = run(ctx, { input: lines([
    message(2, 'query', request('delayed').requestId), message(3, 'submit', request('delayed')), stop,
  ]) });
  assertClosed(ctx, second);
  assert.notEqual(first.pid, second.pid);
  assert.deepEqual(second.output[0].result, first.output[0].result);
  assert.deepEqual(second.output[1].result, first.output[0].result);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
  assert.ok(fs.existsSync(receiptPath(ctx, first.pid)));
});

test('empty stdin EOF still produces a clean runtime receipt', () => {
  const ctx = context();
  const result = run(ctx, { input: '' });
  assertClosed(ctx, result);
  assert.deepEqual(result.output, []);
});

for (const [label, change, pattern] of [
  ['missing env', () => ({}), /are required/],
  ['actor env is not a fallback', (ctx) => ({ BANK_ACTOR_TA_CONFIG: ctx.configPath,
    BANK_ACTOR_TA_CONFIG_SHA256: ctx.env.BANK_RUNTIME_TA_CONFIG_SHA256 }), /are required/],
  ['missing SHA', (ctx) => ({ BANK_RUNTIME_TA_CONFIG: ctx.configPath }), /are required/],
  ['missing config', (ctx) => ({ BANK_RUNTIME_TA_CONFIG_SHA256: ctx.env.BANK_RUNTIME_TA_CONFIG_SHA256 }), /are required/],
  ['bad SHA', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG_SHA256: 'A'.repeat(64) }), /lowercase SHA-256/],
  ['wrong SHA', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG_SHA256: '0'.repeat(64) }), /SHA-256 mismatch/],
  ['actor schema', (ctx) => recapture(ctx, { ...ctx.config, schemaVersion: 'bank.truthsrc-actor-ta/v1' }), /schema or round/],
  ['wrong round', (ctx) => recapture(ctx, { ...ctx.config, ownedRoot: ctx.owned }), /round ownership/],
  ['round alias', (ctx) => recapture(ctx, { ...ctx.config, ownedRoot: ctx.roundRoot + '/.' }), /round ownership/],
  ['injected receipt schema', (ctx) => recapture(ctx, { ...ctx.config, receiptSchema: 'anything' }), /unexpected fields/],
  ['missing fixture', (ctx) => recapture(ctx, { schemaVersion: ctx.config.schemaVersion, ownedRoot: ctx.roundRoot }), /unexpected fields/],
  ['duplicate field', (ctx) => recapture(ctx, JSON.stringify(ctx.config).replace('{', '{"schemaVersion":"duplicate",')), /duplicate object key/],
  ['duplicate nested field', (ctx) => recapture(ctx, JSON.stringify(ctx.config).replace('"fixture":{', '"fixture":{"file":"duplicate",')), /duplicate object key/],
  ['invalid JSON', (ctx) => recapture(ctx, '{not-json'), /expected string/],
  ['invalid UTF-8', (ctx) => recapture(ctx, Buffer.from([0xff])), /invalid UTF-8/],
  ['null config', (ctx) => recapture(ctx, 'null'), /plain object/],
  ['fixture wrong SHA', (ctx) => recapture(ctx, { ...ctx.config, fixture: { file: fixtureFile, sha256: '0'.repeat(64) } }), /SHA-256 mismatch/],
  ['fixture bad SHA', (ctx) => recapture(ctx, { ...ctx.config, fixture: { file: fixtureFile, sha256: 'invalid' } }), /lowercase SHA-256/],
  ['fixture extra field', (ctx) => recapture(ctx, { ...ctx.config, fixture: { ...ctx.config.fixture, extra: true } }), /unexpected fields/],
  ['fixture substitution', (ctx) => recapture(ctx, { ...ctx.config, fixture: { ...ctx.config.fixture, file: ctx.configPath } }), /fixed repository/],
  ['fixture alias', (ctx) => recapture(ctx, { ...ctx.config, fixture: { ...ctx.config.fixture,
    file: path.dirname(fixtureFile) + '/./truthsrc-actor-ta.json' } }), /fixed repository/],
  ['relative config path', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG: 'config.json' }), /canonical absolute/],
  ['config path alias', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG: ctx.roundRoot + '/./config.json' }), /canonical absolute/],
  ['config case alias', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG: path.join(ctx.roundRoot, 'CONFIG.json') }), /aliases|ENOENT/],
  ['config outside round', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG: fixtureFile }), /inside this runtime round/],
  ['config missing file', (ctx) => ({ ...ctx.env, BANK_RUNTIME_TA_CONFIG: path.join(ctx.owned, 'absent.json') }), /ENOENT/],
]) {
  test(`runtime rejects ${label} before journal creation`, () => {
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
  ['journal wrong name', (ctx) => [ctx.owned + '/other.jsonl', ctx.owned]],
  ['journal outside owner', (ctx) => [ctx.roundRoot + '/ta.jsonl', ctx.owned]],
  ['journal nested below owner', (ctx) => [ctx.owned + '/nested/ta.jsonl', ctx.owned]],
  ['owner trailing slash', (ctx) => [ctx.journalPath, ctx.owned + '/']],
  ['owner nested below round', (ctx) => [ctx.owned + '/service/ta.jsonl', ctx.owned + '/service']],
  ['unknown case', (ctx) => [ctx.roundRoot + '/case-unknown/ta.jsonl', ctx.roundRoot + '/case-unknown']],
  ['empty case', (ctx) => [ctx.roundRoot + '/case-/ta.jsonl', ctx.roundRoot + '/case-']],
  ['case prefix suffix', (ctx) => [ctx.roundRoot + '/case-request-before-start-extra/ta.jsonl', ctx.roundRoot + '/case-request-before-start-extra']],
  ['service suffix', (ctx) => [ctx.roundRoot + '/service-extra/ta.jsonl', ctx.roundRoot + '/service-extra']],
  ['actor owner', (ctx) => [ctx.roundRoot + '/owner-b-application-test/ta.jsonl', ctx.roundRoot + '/owner-b-application-test']],
  ['actor round', () => [rounds + '/truthsrc-actors-not-created/service/ta.jsonl', rounds + '/truthsrc-actors-not-created/service']],
  ['empty runtime round', () => [rounds + '/truthsrc-runtime-/service/ta.jsonl', rounds + '/truthsrc-runtime-/service']],
  ['ancestor case alias', (ctx) => [ctx.journalPath.replace('/.local/mock-ta/', '/.LOCAL/mock-ta/'), ctx.owned.replace('/.local/mock-ta/', '/.LOCAL/mock-ta/')]],
]) {
  test(`runtime rejects ${label} without writing a journal`, () => {
    const ctx = context();
    assertFailed(ctx, run(ctx, { args: args(ctx) }), /WORKER_PATH/);
    assert.equal(fs.existsSync(ctx.journalPath), false);
  });
}

test('a same-prefix sibling config is outside the selected round', () => {
  const ctx = context();
  const sibling = ctx.roundRoot + '-sibling';
  fs.mkdirSync(sibling, { mode: 0o700 });
  const file = path.join(sibling, 'config.json');
  writeNew(file, JSON.stringify(ctx.config));
  assertFailed(ctx, run(ctx, { env: { ...ctx.env, BANK_RUNTIME_TA_CONFIG: file } }), /inside this runtime round/);
  assert.equal(fs.existsSync(ctx.journalPath), false);
});

for (const kind of ['symlink', 'hardlink', 'directory']) {
  for (const target of ['config', 'journal', 'lock']) {
    test(`runtime rejects ${kind} ${target} without altering its target`, () => {
      const ctx = context();
      const sentinel = Buffer.from('test-only unchanged link target');
      const targetFile = path.join(ctx.owned, 'target');
      writeNew(targetFile, sentinel);
      const candidate = target === 'config' ? path.join(ctx.owned, 'linked-config.json')
        : ctx.journalPath + (target === 'lock' ? '.lock' : '');
      if (kind === 'symlink') fs.symlinkSync(targetFile, candidate);
      else if (kind === 'hardlink') fs.linkSync(targetFile, candidate);
      else fs.mkdirSync(candidate);
      const env = target === 'config' ? { ...ctx.env, BANK_RUNTIME_TA_CONFIG: candidate } : ctx.env;
      assertFailed(ctx, run(ctx, { env }), /WORKER_PATH/);
      assert.deepEqual(fs.readFileSync(targetFile), sentinel);
    });
  }
}

test('runtime rejects symlinked round, owner and configuration ancestors', () => {
  const ctx = context();
  const roundAlias = ctx.roundRoot + '-alias';
  fs.symlinkSync(ctx.roundRoot, roundAlias);
  const roundOwner = path.join(roundAlias, 'service');
  assertFailed(ctx, run(ctx, { args: [path.join(roundOwner, 'ta.jsonl'), roundOwner] }), /Symlinks/);
  const ownerAlias = path.join(ctx.roundRoot, 'case-request-before-start');
  fs.symlinkSync(ctx.owned, ownerAlias);
  assertFailed(ctx, run(ctx, { args: [path.join(ownerAlias, 'ta.jsonl'), ownerAlias] }), /Symlinks/);
  const configAlias = path.join(ctx.owned, 'config-parent');
  fs.symlinkSync(ctx.roundRoot, configAlias);
  assertFailed(ctx, run(ctx, { env: { ...ctx.env, BANK_RUNTIME_TA_CONFIG: path.join(configAlias, 'config.json') } }), /Symlinks/);
  assert.equal(fs.existsSync(ctx.journalPath), false);
});

test('runtime requires existing real round and owner directories', () => {
  const ctx = context();
  const ownerFile = path.join(ctx.roundRoot, 'case-payment-prepare');
  writeNew(ownerFile, 'test-only not a directory');
  assertFailed(ctx, run(ctx, { args: [ownerFile + '/ta.jsonl', ownerFile] }), /WORKER_PATH/);
  const roundFile = ctx.roundRoot + '-file';
  writeNew(roundFile, 'test-only not a directory');
  assertFailed(ctx, run(ctx, { args: [roundFile + '/service/ta.jsonl', roundFile + '/service'] }), /WORKER_PATH/);
  const absentOwner = path.join(ctx.roundRoot, 'case-refund-prepare');
  assertFailed(ctx, run(ctx, { args: [absentOwner + '/ta.jsonl', absentOwner] }), /ENOENT/);
  assert.equal(fs.existsSync(absentOwner), false);
  assert.equal(fs.existsSync(ctx.journalPath), false);
});

test('runtime refuses existing locks without controller deletion or journal initialization', () => {
  const ctx = context();
  const sentinel = 'test-only lock not owned by the worker';
  writeNew(ctx.journalPath + '.lock', sentinel);
  assertFailed(ctx, run(ctx), /JOURNAL_LOCKED/);
  assert.equal(fs.readFileSync(ctx.journalPath + '.lock', 'utf8'), sentinel);
  assert.equal(fs.existsSync(ctx.journalPath), false);
});

for (const [label, input, pattern] of [
  ['malformed JSON', '{', /expected string/],
  ['duplicate request id', '{"id":1,"id":1,"op":"close","input":null}\n', /duplicate object key/],
  ['invalid UTF-8', Buffer.from([0xff, 0x0a]), /invalid UTF-8/],
  ['invalid id', lines([message(-1, 'query', 'missing-test')]), /safe integer/],
  ['oversized unfinished line', ' '.repeat(65537), /capacity exceeded/],
  ['oversized terminated line', ' '.repeat(65537) + '\n', /capacity exceeded/],
]) {
  test(`shared protocol rejects ${label} without attesting clean close`, () => {
    const ctx = context();
    assertFailed(ctx, run(ctx, { input }), pattern);
    assert.ok(fs.statSync(ctx.journalPath).size > 0);
    assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false);
  });
}

test('shared framing accepts the exact byte boundary with CRLF and correlates nonfatal errors', () => {
  const ctx = context();
  const query = JSON.stringify(message(1, 'query', 'missing-test'));
  const result = run(ctx, { input: query + ' '.repeat(65536 - Buffer.byteLength(query)) + '\r\n' + lines([
    message(2, 'unknown-op'), message(3, 'submit', {}), message(4, 'advance', -1), stop,
  ]) });
  assertClosed(ctx, result);
  assert.deepEqual(result.output.map(({ id, ok }) => [id, ok]), [[1, true], [2, false], [3, false], [4, false], [99, true]]);
});

test('fatal framing preserves an acknowledged submission for same-journal reopen', () => {
  const ctx = context();
  const failed = run(ctx, { input: lines([message(1, 'submit', request())]) + '{' });
  assertFailed(ctx, failed, /expected string/);
  const before = fs.readFileSync(ctx.journalPath);
  const reopened = run(ctx, { input: lines([message(2, 'query', request().requestId), stop]) });
  assertClosed(ctx, reopened);
  assert.deepEqual(reopened.output[0].result, failed.output[0].result);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
});

test('broken stdout during close cannot issue a runtime success receipt', { timeout: 10000 }, async (t) => {
  const ctx = context();
  const session = live(t, ctx);
  session.child.stdin.write(lines([message(1, 'query', 'missing-test')]));
  assert.equal((await session.next()).ok, true);
  session.output.close();
  session.child.stdout.destroy();
  session.child.stdin.end(lines([stop]));
  const result = await session.exited;
  assert.equal(result.signal, null);
  assertFailed(ctx, result, /EPIPE/);
  assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false);
});

test('runtime close never overwrites an exclusive PID receipt', { timeout: 10000 }, async (t) => {
  const ctx = context();
  const session = live(t, ctx);
  session.child.stdin.write(lines([message(1, 'query', 'missing-test')]));
  assert.equal((await session.next()).ok, true);
  const sentinel = '{"closed":false,"test":"retained-exclusive-receipt"}\n';
  writeNew(receiptPath(ctx, session.child.pid), sentinel);
  session.child.stdin.end(lines([stop]));
  assert.deepEqual(await session.next(), { id: 99, ok: false,
    error: { code: 'EEXIST', message: 'Exclusive worker receipt already exists' } });
  const result = await session.exited;
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(fs.readFileSync(receiptPath(ctx, result.pid), 'utf8'), sentinel);
  assert.equal(fs.existsSync(ctx.journalPath + '.lock'), false);
});

for (const directory of ['owner', 'round']) {
  test(`replaced ${directory} identity poisons the worker without a success receipt or lock theft`, { timeout: 10000 }, async (t) => {
    const ctx = context();
    const session = live(t, ctx);
    session.child.stdin.write(lines([message(1, 'submit', request())]));
    assert.equal((await session.next()).ok, true);
    const before = fs.readFileSync(ctx.journalPath);
    const lock = fs.readFileSync(ctx.journalPath + '.lock');
    const original = directory === 'owner' ? ctx.owned : ctx.roundRoot;
    const retained = original + '-retained';
    // Rename only this test's newly owned directory, retaining every original byte.
    fs.renameSync(original, retained);
    fs.mkdirSync(original, { mode: 0o700 });
    if (directory === 'round') fs.mkdirSync(ctx.owned, { mode: 0o700 });
    const retainedOwner = directory === 'owner' ? retained : path.join(retained, 'service');
    session.child.stdin.end(lines([stop]));
    const response = await session.next();
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'JOURNAL_IDENTITY');
    assertFailed(ctx, await session.exited, /JOURNAL_IDENTITY/);
    assert.equal(fs.existsSync(path.join(retainedOwner, `ta-worker-${session.child.pid}.json`)), false);
    assert.deepEqual(fs.readFileSync(path.join(retainedOwner, 'ta.jsonl')), before);
    assert.deepEqual(fs.readFileSync(path.join(retainedOwner, 'ta.jsonl.lock')), lock);
  });
}

test('SIGKILL of a Node stdin-writer surrogate leaves TA to close on EOF and reopen without lock deletion', { timeout: 15000 }, async (t) => {
  const ctx = context('case-ta-submitted-before-bank-accept');
  // Simulate only descriptor lifetime, not JVM/business recovery. The TA inherits
  // the drained stdout/stderr pipes directly, so killing its stdin writer gives
  // it EOF without breaking its response channel. No services or network.
  const script = `
    import { spawn } from 'node:child_process';
    const [worker, journal, owned] = process.argv.slice(1);
    const ta = spawn(process.execPath, [worker, journal, owned], {
      stdio: ['pipe', process.stdout, process.stderr], env: process.env,
    });
    process.stdout.write(JSON.stringify({ workerPid: ta.pid }) + '\\n');
    ta.stdin.write(${JSON.stringify(lines([message(1, 'submit', request())]))});
  `;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script, worker, ctx.journalPath, ctx.owned], {
    cwd: ctx.owned, env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  parent.stderr.setEncoding('utf8');
  parent.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(parent, 'close');
  const output = readline.createInterface({ input: parent.stdout });
  const responses = output[Symbol.asyncIterator]();
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); output.close(); parent.stdout.resume(); });
  const { workerPid } = JSON.parse((await responses.next()).value);
  assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
  const submitted = parseReply((await responses.next()).value);
  assert.equal(submitted.result.status, 'accepted');
  assert.equal(fs.existsSync(ctx.journalPath + '.lock'), true);
  assert.equal(parent.kill('SIGKILL'), true);
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  assert.equal((await responses.next()).done, true, 'TA independently closed its inherited output');
  // No inferred worker exit status: validate its exclusive receipt after pipe EOF.
  assert.equal(stderr, '');
  assertClosed(ctx, { status: 0, stderr, pid: workerPid });
  const before = fs.readFileSync(ctx.journalPath);
  const reopened = run(ctx, { input: lines([message(2, 'query', request().requestId), stop]) });
  assertClosed(ctx, reopened);
  assert.deepEqual(reopened.output[0].result, submitted.result);
  assert.deepEqual(fs.readFileSync(ctx.journalPath), before);
});
