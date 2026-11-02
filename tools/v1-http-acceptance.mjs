import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainPath } from './v1-release-generation.mjs';
import { sourceInventory } from './v1-release-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function externalSources() {
  return Object.fromEntries(['v1/handwritten', 'v1/test'].flatMap(part =>
    Object.entries(sourceInventory(join(ROOT, part))).map(([path, hash]) => ['bank-wealth-demo/' + part + '/' + path, hash.slice(7)])));
}
export function verifyHttpReport(report, mode) {
  assert.equal(report.schemaVersion, 'bank-http-acceptance/v1');
  assert.equal(report.mode, mode);
  assert.equal(report.paymentCount, 3);
  assert.deepEqual(Object.keys(report.queries).sort(), ['lost', 'race', 'same']);
  assert.ok(Object.keys(report.journal).length > 3);
  assert.equal(report.replayBytesEqual, mode === 'replay');
  if (mode === 'exercise') {
    const names = report.cases.map(c => c.case);
    assert.equal(new Set(names).size, names.length);
    const get = name => { const row = report.cases.find(c => c.case === name); assert.ok(row, 'missing HTTP assertion: ' + name); return row; };
    for (const [name, status] of [['unauthenticated', 401], ['operator-cannot-purchase', 403], ['csrf', 403], ['customer-cannot-reconcile', 403]]) {
      assert.equal(get(name).status, status);
    }
    for (const name of ['principalId', 'roles', 'accountId', 'investorAccountId', 'fundCollectionAccountId', 'taReceipt', 'forcedResult', 'refundDestination', 'authorization', 'transactionId']) {
      assert.equal(get('reject-' + name).status, 400);
    }
    const denied = get('all-rejections-zero-journal-events');
    assert.deepEqual(denied.after, denied.before);
    assert.ok(Object.keys(denied.before).length > 0);
    const lost = get('actual-socket-response-loss');
    assert.equal(lost.upstreamStatus, 200);
    assert.equal(lost.clientResponseBytes, 0);
    assert.equal(lost.noNewEvents, true);
    assert.ok(lost.retriedAcknowledgement);
    assert.deepEqual(get('eight-concurrent-identical').statuses, Array(8).fill(200));
    const conflict = get('eight-concurrent-conflicting').statuses;
    assert.equal(conflict.length, 8);
    assert.deepEqual([...conflict].sort(), [200, 200, 200, 200, 409, 409, 409, 409]);
    assert.equal(new Set(conflict.slice(0, 4)).size, 1);
    assert.equal(new Set(conflict.slice(4)).size, 1);
  } else assert.deepEqual(report.cases, []);
}
function verifyClasspath(captured) {
  for (const [path, value] of Object.entries(captured.classpath)) {
    if (typeof value === 'string') assert.equal(sha(path), value, 'classpath JAR differs');
    else if (value.absent) assert.equal(existsSync(path), false);
    else assert.deepEqual(sourceInventory(path), Object.fromEntries(Object.entries(value).map(([k, v]) => [k, 'sha256:' + v])), 'compiled classes differ');
  }
}
export function validateHttpAcceptance(config) {
  assert.deepEqual(Object.keys(config).sort(), ['buildReceipt', 'java', 'ownedRoot', 'target']);
  plainPath(config.java);
  plainPath(config.target);
  plainPath(config.buildReceipt);
  plainPath(config.ownedRoot, true);
  const parts = relative(join(ROOT, '.scratch'), config.ownedRoot).split('/');
  assert.ok(parts.length === 2 && /^p26-p32-bank-v1-[A-Za-z0-9_-]+$/.test(parts[0]) && /^http-[A-Za-z0-9_-]+$/.test(parts[1]), 'fresh owned HTTP evidence root required');
  const targetParts = relative(join(ROOT, 'target/bank-wealth-release-v1'), config.target).split('/');
  assert.ok(targetParts.length === 3 && targetParts.every(p => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(p)) && ['js-app', 'bc-app'].includes(targetParts[2]));
  assert.ok(config.buildReceipt.startsWith(dirname(config.ownedRoot) + '/') && config.buildReceipt.endsWith('-app.json'));
  const build = json(config.buildReceipt);
  assert.equal(build.cwd, config.target);
  assert.equal(build.exitCode, 0);
  assert.equal(build.waited, true);
  assert.equal(build.timedOut, false);
  assert.equal(build.sourceUnchanged, true);
  const base = config.buildReceipt.slice(0, -'-app.json'.length);
  const outer = json(base + '.json');
  assert.equal(outer.exitCode, 0);
  assert.equal(outer.waited, true);
  assert.deepEqual(outer.protectedDrift, []);
  assert.equal(sha(base + '-app.stdout.log'), build.stdoutSha256);
  assert.equal(sha(base + '-app.stderr.log'), build.stderrSha256);
  const captured = json(base + '-build-output.json');
  assert.equal(captured.buildReceiptSHA, sha(config.buildReceipt));
  assert.equal(captured.sourceReceiptSHA, sha(base + '.json'));
  verifyClasspath(captured);
  const sources = Object.entries(outer.sourceAfter).filter(([path]) => path.startsWith('bank-wealth-demo/v1/handwritten/') || path.startsWith('bank-wealth-demo/v1/test/'));
  for (const [path, hash] of sources) {
    assert.equal(outer.sourceBefore[path], hash, 'source changed during build');
    assert.equal(sha(join(dirname(ROOT), path)), hash, 'source no longer matches compiled build');
  }
  assert.ok(sources.some(([path]) => path.endsWith('/BankHttpAcceptanceMain.scala')));
  assert.deepEqual(externalSources(), Object.fromEntries(sources), 'complete external source inventory must match build');
  assert.deepEqual(sourceInventory(config.target, { afterBuild: true }), Object.fromEntries(Object.entries(build.sourceAfter).map(([k, v]) => [k, 'sha256:' + v])));
  const classpath = [...readFileSync(base + '-app.stdout.log', 'utf8').matchAll(/Attributed\(([^\n]+)\)/g)].map(m => m[1]);
  assert.deepEqual(classpath, Object.keys(captured.classpath));
  return { classpath, bytecode: captured, sources: Object.fromEntries(sources), buildSha: sha(config.buildReceipt) };
}
async function invoke(config, mode, classpath) {
  const invocation = join(config.ownedRoot, 'runs', mode);
  mkdirSync(invocation);
  const stdout = join(invocation, 'stdout.log'), stderr = join(invocation, 'stderr.log');
  const out = openSync(stdout, 'wx'), err = openSync(stderr, 'wx');
  const args = ['-Xmx1G', '-cp', classpath.join(':'), 'example.bankwealth.service.BankHttpAcceptanceMain', mode, config.ownedRoot, invocation];
  let child, timer, killer, timedOut = false, cancelled = null;
  const terminate = signal => {
    cancelled = signal;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      if (!killer) killer = setTimeout(() => child.kill('SIGKILL'), 15000);
    }
  };
  const onTerm = () => terminate('SIGTERM'), onInt = () => terminate('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  const env = { HOME: config.ownedRoot, JAVA_HOME: dirname(dirname(config.java)), PATH: dirname(config.java) + ':/usr/bin:/bin', LANG: 'en_US.UTF-8' };
  try {
    child = spawn(config.java, args, { cwd: config.target, env, stdio: ['ignore', out, err] });
    const ended = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), 15000);
    }, 150000);
    const result = await ended;
    clearTimeout(timer); clearTimeout(killer);
    const record = { command: [config.java, ...args], cwd: config.target, environment: env, pid: child.pid, ...result, timedOut, cancelled, waited: true,
      stdoutSha: sha(stdout), stderrSha: sha(stderr) };
    save(join(invocation, 'process.json'), record);
    assert.equal(timedOut, false);
    assert.equal(cancelled, null);
    assert.equal(result.code, 0, 'HTTP child failed; retained stdout/stderr contain details');
    assert.equal(result.signal, null);
    for (const path of [stdout, stderr]) assert.doesNotMatch(readFileSync(path, 'utf8'), /\bERROR\b|Exception in thread|RejectedExecutionException|Unsupported OP_QUERY|localhost:27017|mongodb:\/\/|jdbc:mysql/);
    assert.equal(json(join(invocation, 'closed.json')).closed, true);
    assert.equal(json(join(invocation, 'closed.json')).pid, child.pid);
    const report = json(join(invocation, 'result.json'));
    assert.equal(report.pid, child.pid);
    verifyHttpReport(report, mode);
    return { invocation, process: record, report };
  } finally {
    clearTimeout(timer); clearTimeout(killer);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
    closeSync(out); closeSync(err);
  }
}
export async function runHttpAcceptance(config) {
  const captured = validateHttpAcceptance(config);
  mkdirSync(config.ownedRoot);
  mkdirSync(join(config.ownedRoot, 'runs'));
  save(join(config.ownedRoot, 'input.json'), { ...config, ...captured });
  const exercise = await invoke(config, 'exercise', captured.classpath);
  verifyClasspath(captured.bytecode);
  const replay = await invoke(config, 'replay', captured.classpath);
  verifyClasspath(captured.bytecode);
  assert.notEqual(exercise.process.pid, replay.process.pid);
  assert.deepEqual(replay.report.journal, exercise.report.journal);
  assert.deepEqual(replay.report.queries, exercise.report.queries);
  assert.deepEqual(replay.report.acknowledgements, exercise.report.acknowledgements);
  assert.equal(replay.report.raceMinor, exercise.report.raceMinor);
  assert.equal(replay.report.replayBytesEqual, true);
  assert.deepEqual(externalSources(), captured.sources, 'complete external source inventory changed during HTTP acceptance');
  const result = { schemaVersion: 'bank-http-acceptance-controller/v1', buildSha: captured.buildSha,
    modes: [exercise, replay], socketAckLossVerified: true, concurrentSameAndConflictingBodiesVerified: true,
    unauthorizedAndInjectedRequestsZeroEvents: true, newJvmPersistentHistoryEqual: true,
    productionFactoryOrMongoMySql: false, all25PackagesAccepted: false };
  save(join(config.ownedRoot, 'result.json'), result);
  return result;
}
