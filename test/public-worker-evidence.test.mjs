import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRuntimeWorker, inspectRuntimeWorker } from '../tools/truthsrc-worker-evidence.mjs';
import { ACTOR_SUPPORT, verifyActorWorkers } from '../tools/truthsrc-actor-tests.mjs';
import { canonicalJson, digest } from '../simulator/contract.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const write = (file, value) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
function fixture({ crash = false, pid = 50001 } = {}) {
  const round = mkdtempSync(join(realpathSync(tmpdir()), 'public-worker-'));
  const root = join(round, 'owned'), invocation = join(root, 'logs');
  mkdirSync(root); mkdirSync(invocation);
  const transcript = join(invocation, 'worker.jsonl');
  const args = { root, transcript, round, configSha256: 'a'.repeat(64), fixtureSha256: 'b'.repeat(64), crash };
  const receipt = { schemaVersion: 'bank.truthsrc-runtime-ta-worker/v1', pid, closed: true,
    journalPath: join(root, 'ta.jsonl'), ownedRoot: root, roundRoot: round,
    configSha256: args.configSha256, fixtureSha256: args.fixtureSha256, configurationDigest: 'c'.repeat(64) };
  const rows = [{ kind: 'worker-started', pid }, ...crash ? [] : [
    { id: 3, op: 'close', input: null }, { id: 3, ok: true, result: { closed: true } },
    { kind: 'worker-exited', pid, waited: true, exitCode: 0 }]];
  const receiptFile = join(root, `ta-worker-${pid}.json`), stderr = join(invocation, 'worker.stderr.log');
  write(transcript, jsonl(rows)); write(receiptFile, receipt); write(stderr, '');
  return { args, rows, receipt, receiptFile, stderr };
}
const rewriteRows = f => writeFileSync(f.args.transcript, jsonl(f.rows));
const rewriteReceipt = f => writeFileSync(f.receiptFile, JSON.stringify(f.receipt) + '\n');

test('static runtime inspection preserves the saved worker shape and references, without PID probes', t => {
  t.mock.method(process, 'kill', () => { throw new Error('historical PID must never be probed'); });
  for (const crash of [false, true]) {
    const f = fixture({ crash, pid: process.pid });
    const inspected = inspectRuntimeWorker(f.args);
    assert.deepEqual(inspected.worker, { pid: process.pid, absent: true, cleanCloseReceipt: f.receipt,
      jvmWaited: !crash, transcriptSha256: hash(readFileSync(f.args.transcript)) });
    assert.deepEqual(inspected.references, [f.args.transcript, f.receiptFile, f.stderr].map(file => {
      const bytes = readFileSync(file); return { file, bytes: bytes.length, sha256: hash(bytes) };
    }));
    assert.deepEqual(inspectRuntimeWorker({ ...f.args, embedded: inspected.worker }), inspected);
    assert.throws(() => inspectRuntimeWorker({ ...f.args, embedded: { ...inspected.worker, absent: false } }), /embedded worker/);
  }
  assert.equal(process.kill.mock.callCount(), 0);
});

test('live checker retains async arguments/result, waits for current owned worker, snapshots caller input', async t => {
  const f = fixture(); let calls = 0;
  const originalConfig = f.args.configSha256;
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(pid, f.receipt.pid); assert.equal(signal, 0);
    f.args.configSha256 = 'd'.repeat(64);
    if (++calls <= 1) return true;
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  const promise = checkRuntimeWorker(f.args);
  assert.ok(promise instanceof Promise);
  const worker = await promise;
  assert.equal(worker.cleanCloseReceipt.configSha256, originalConfig);
  assert.equal(worker.absent, true); assert.equal(worker.jvmWaited, true);
  assert.equal(worker.transcriptSha256, hash(readFileSync(f.args.transcript)));
  assert.ok(calls >= 2);
});

test('runtime close result policy is retained while IDs and ordering are now correlated', () => {
  for (const ok of [false, undefined]) {
    const f = fixture();
    if (ok === undefined) delete f.rows[2].ok; else f.rows[2].ok = ok;
    rewriteRows(f); assert.equal(inspectRuntimeWorker(f.args).worker.jvmWaited, true);
  }
  for (const mutate of [
    f => { f.rows[2].id = 4; },
    f => { f.rows.reverse(); },
    f => { f.rows.push({ ...f.rows[0] }); },
    f => { f.rows.at(-1).pid++; },
    f => { f.rows.at(-1).waited = false; },
    f => { f.rows.at(-1).exitCode = 1; },
    f => { f.rows.splice(1, 1); },
    f => { f.rows[2].result.closed = false; },
    f => { f.rows.splice(1, 0, { id: 0, op: 'snapshot' }, { id: 0, result: { closed: true } }); f.rows[4].id = 9; },
  ]) { const f = fixture(); mutate(f); rewriteRows(f); assert.throws(() => inspectRuntimeWorker(f.args)); }
});

test('runtime crash accepts EOF and forbids exit claims; all declared bank receipt identities remain mandatory', () => {
  const crash = fixture({ crash: true });
  crash.rows.push({ id: 8, op: 'snapshot' }); rewriteRows(crash);
  assert.equal(inspectRuntimeWorker(crash.args).worker.jvmWaited, false);
  crash.rows.push({ kind: 'worker-exited', pid: crash.receipt.pid, waited: true, exitCode: 0 }); rewriteRows(crash);
  assert.throws(() => inspectRuntimeWorker(crash.args), /exit/);
  for (const key of ['schemaVersion', 'pid', 'closed', 'journalPath', 'ownedRoot', 'roundRoot',
    'configSha256', 'fixtureSha256', 'configurationDigest']) {
    const f = fixture(); delete f.receipt[key]; rewriteReceipt(f);
    assert.throws(() => inspectRuntimeWorker(f.args), undefined, key);
  }
  const f = fixture({ pid: 1 }); assert.throws(() => inspectRuntimeWorker(f.args), /PID/);
});

test('empty stderr, absent locks and complete strict JSONL are required without changing evidence', () => {
  const locked = fixture(); write(join(locked.args.root, 'ta.jsonl.lock'), 'owned');
  assert.throws(() => inspectRuntimeWorker(locked.args), /lock/);
  assert.equal(readFileSync(join(locked.args.root, 'ta.jsonl.lock'), 'utf8'), 'owned');
  const error = fixture(); writeFileSync(error.stderr, 'diagnostic');
  assert.throws(() => inspectRuntimeWorker(error.args), /stderr/);
  for (const transform of [text => text.slice(0, -1), text => text + '\n',
    text => text.replace('"pid":50001', '"pid":50001,"pid":50002'),
    text => text.replace('"id":3', '"id":3.0'), () => '\n', () => 'null\n']) {
    const f = fixture(); writeFileSync(f.args.transcript, transform(readFileSync(f.args.transcript, 'utf8')));
    assert.throws(() => inspectRuntimeWorker(f.args));
  }
  const badReceipt = fixture(); writeFileSync(badReceipt.receiptFile, '{"pid":1,"pid":2}\n');
  assert.throws(() => inspectRuntimeWorker(badReceipt.args), /duplicate/);
});

test('worker capture refuses path aliases, hardlinks and symlinks using the shared evidence mechanism', () => {
  const f = fixture();
  for (const kind of ['hardlink', 'symlink']) {
    const alias = join(f.args.root, kind + '.jsonl');
    (kind === 'hardlink' ? linkSync : symlinkSync)(f.args.transcript, alias);
    assert.throws(() => inspectRuntimeWorker({ ...f.args, transcript: alias }));
  }
  const other = fixture();
  assert.throws(() => inspectRuntimeWorker({ ...other.args, transcript: other.args.root + '/logs/../logs/worker.jsonl' }));
});

test('runtime adapter refuses getters and proxies before any live probe; embedded data is detached', async t => {
  let calls = 0;
  t.mock.method(process, 'kill', () => { calls++; throw new Error('must not probe'); });
  const f = fixture(), bad = { ...f.args };
  Object.defineProperty(bad, 'round', { enumerable: true, get() { calls++; throw new Error('must not read getter'); } });
  assert.throws(() => inspectRuntimeWorker(bad)); await assert.rejects(checkRuntimeWorker(bad));
  const proxy = new Proxy(f.args, { ownKeys() { calls++; throw new Error('must not trap'); } });
  assert.throws(() => inspectRuntimeWorker(proxy)); await assert.rejects(checkRuntimeWorker(proxy));
  const value = inspectRuntimeWorker(f.args);
  assert.ok(Object.isFrozen(value.worker.cleanCloseReceipt));
  const embedded = structuredClone(value.worker);
  Object.defineProperty(embedded.cleanCloseReceipt, 'closed', { enumerable: true, get() { calls++; return true; } });
  assert.throws(() => inspectRuntimeWorker({ ...f.args, embedded }));
  assert.equal(calls, 0);
});

function actorFixture() {
  const ownedRoot = mkdtempSync(join(realpathSync(tmpdir()), 'public-worker-actor-'));
  const actor = { ownedRoot, configSha256: 'a'.repeat(64), fixtureSha256: 'b'.repeat(64), configurationDigest: 'c'.repeat(64) };
  for (const file of ['actor-owner.json', 'actor-ta.json']) write(join(ownedRoot, file), {});
  write(join(ownedRoot, 'sandbox-write-probe'), 'allowed\n');
  let pid = 50000; const transcripts = [];
  for (let index = 0; index < 15; index++) {
    const root = join(ownedRoot, 'owner-b-application-' + index); mkdirSync(root);
    const event = { schemaVersion: 'bank-wealth.mock-ta-journal/v1', seq: 1, configDigest: actor.configurationDigest,
      previousHash: null, event: { kind: 'Initialized', tick: 0 } };
    write(join(root, 'ta.jsonl'), canonicalJson({ ...event, recordHash: digest(canonicalJson(event)) }) + '\n');
    for (let reopen = 0; reopen < (index === 0 ? 2 : 1); reopen++) {
      pid++;
      const name = reopen ? 'worker-reopened-621d5b52-ef7d-49bc-a5c5-a59b7fbc22ce' : 'worker';
      const file = join(root, name + '.jsonl');
      const rows = [{ kind: 'worker-started', pid }, { id: 0, op: 'close', input: null },
        { id: 0, ok: true, result: { closed: true } }, { kind: 'worker-exited', pid, waited: true, exitCode: 0 }];
      write(file, jsonl(rows)); write(join(root, name + '.stderr.log'), '');
      write(join(root, `ta-worker-${pid}.json`), { schemaVersion: 'bank.truthsrc-actor-ta-worker/v1', pid, closed: true,
        journalPath: join(root, 'ta.jsonl'), ownedRoot: root, roundRoot: ownedRoot,
        configSha256: actor.configSha256, fixtureSha256: actor.fixtureSha256, configurationDigest: actor.configurationDigest });
      transcripts.push({ file, rows });
    }
  }
  return { actor, transcripts };
}

test('actor adapter retains exact journal/configuration policy and requires the matching close ok===true', () => {
  const f = actorFixture(); assert.equal(verifyActorWorkers(f.actor, () => false).workerCount, 16);
  const { file, rows } = f.transcripts[0];
  for (const mutate of [
    rows => { rows[2].ok = false; },
    rows => { delete rows[2].ok; },
    rows => { rows[2].id = 5; },
    rows => { [rows[1], rows[2]] = [rows[2], rows[1]]; },
    rows => { rows.unshift(rows.pop()); },
  ]) {
    const changed = structuredClone(rows); mutate(changed); writeFileSync(file, jsonl(changed));
    assert.throws(() => verifyActorWorkers(f.actor, () => false));
  }
  writeFileSync(file, jsonl(rows));
  assert.throws(() => verifyActorWorkers({ ...f.actor, configurationDigest: 'd'.repeat(64) }, () => false));
});

test('actor support covers newly loaded helpers without importing historical financial policy', () => {
  const suffixes = ['bank-wealth-demo/tools/truthsrc-evidence.mjs',
    'metarch-truthsrc/lib/verification/files.mjs', 'metarch-truthsrc/lib/verification/worker-evidence.mjs',
    'metarch-truthsrc/lib/immutable-data.mjs', 'metarch-truthsrc/lib/strict-json.mjs'];
  for (const suffix of suffixes) assert.ok(ACTOR_SUPPORT.some(file => file.endsWith('/' + suffix)), suffix);
  assert.ok(!ACTOR_SUPPORT.some(file => file.endsWith('/truth-source.mjs')));
  const adapter = readFileSync(new URL('../tools/truthsrc-worker-evidence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /v1-crash-recovery|truthsrc-runtime-crash|verify-truthsrc-build|truth-source\.mjs/);
  const crash = readFileSync(new URL('../tools/truthsrc-runtime-crash.mjs', import.meta.url), 'utf8');
  assert.match(crash, /from '\.\/v1-crash-recovery\.mjs'/);
  assert.match(crash, /export const CRASH_CASES = crashCases/);
});
