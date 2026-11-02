import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sipCrashCases = Object.freeze(['sip-intent-before-create', 'sip-create-before-append', 'sip-append-before-next',
  'sip-before-seal', 'sip-tick-before-catchup', 'sip-occurrence-before-dispatch', 'sip-terminal-before-bridge', 'sip-terminal-ack-lost']);
export const taCrashCases = Object.freeze(['ta-register-before-assembly', 'ta-intent-before-submit', 'ta-submitted-before-bank-accept',
  'ta-accepted-before-effect-reply', 'ta-confirmed-before-ingest', 'ta-rejected-after-ingest-before-ack',
  'payment-succeeded-before-delivery-ack', 'refund-succeeded-before-delivery-ack']);
const refundCase = name => name.startsWith('refund-') || name === 'ta-rejected-after-ingest-before-ack';
export const crashCases = Object.freeze(['request-before-start', 'refund-before-assembly', 'refund-prepare',
  'refund-collection-commit', 'refund-investor-commit', 'payment-prepare', 'payment-investor-commit', 'payment-collection-commit',
  ...taCrashCases, ...sipCrashCases]);
const childMain = caseName => sipCrashCases.includes(caseName) ? 'BankSipCrashRecoveryMain' : 'BankCrashRecoveryMain';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
function existing(path, directory = false) {
  assert.ok(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !/[\r\n\0]/.test(path), 'normalized absolute path required');
  assert.equal(realpathSync(path), path, 'symlinks are not admitted');
  assert.ok(directory ? lstatSync(path).isDirectory() : lstatSync(path).isFile(), 'wrong input kind');
}
export function validateCrashConfiguration(config) {
  assert.equal(config?.synthetic, true, 'synthetic execution required');
  const keys = ['synthetic', 'caseName', 'namespace', 'ownedRoot', 'target', 'java', 'node', 'worker', 'buildReceipt', 'classpath'];
  assert.ok(Object.keys(config).every(key => keys.includes(key)), 'unknown configuration key');
  assert.ok(crashCases.includes(config.caseName), 'unknown crash case');
  assert.ok(typeof config.namespace === 'string' && /^crash_[a-zA-Z0-9_]{1,70}$/.test(config.namespace), 'isolated namespace required');
  assert.ok(typeof config.ownedRoot === 'string' && isAbsolute(config.ownedRoot) && resolve(config.ownedRoot) === config.ownedRoot);
  const parts = relative(join(ROOT, '.scratch'), config.ownedRoot).split('/');
  assert.ok(parts.length === 2 && /^p26-p32-bank-v1-[a-zA-Z0-9_-]+$/.test(parts[0]) && /^crash-[a-zA-Z0-9_-]+$/.test(parts[1]), 'fresh owned crash root required');
  existing(dirname(config.ownedRoot), true);
  assert.ok(!existsSync(config.ownedRoot), 'previous journal or evidence cannot be reused by a new run');
  existing(config.target, true);
  assert.ok(relative(join(ROOT, 'target/bank-wealth-release-v1'), config.target).split('/').every(p => p !== '..'), 'release target required');
  for (const name of ['java', 'node', 'worker', 'buildReceipt']) existing(config[name]);
  assert.equal(config.worker, join(ROOT, 'tools/v1-service-mock-ta-worker.mjs'));
  assert.ok(Array.isArray(config.classpath) && config.classpath.length > 0 && new Set(config.classpath).size === config.classpath.length, 'explicit unique classpath required');
  for (const path of config.classpath) {
    assert.ok(!path.includes(':'), 'classpath separator in path');
    if (existsSync(path)) existing(path, lstatSync(path).isDirectory());
    else {
      assert.ok(isAbsolute(path) && resolve(path) === path && path.startsWith(join(config.target, 'target') + '/'), 'only absent build output directories are admitted');
      let ancestor = dirname(path);
      while (!existsSync(ancestor)) ancestor = dirname(ancestor);
      existing(ancestor, true);
    }
  }
  assert.ok(config.classpath.includes(join(config.target, 'target/scala-2.13/test-classes')), 'compiled bank test entry required');
  const build = json(config.buildReceipt);
  assert.equal(build.cwd, config.target);
  assert.equal(build.exitCode, 0);
  assert.equal(build.waited, true);
  assert.equal(build.sourceUnchanged, true);
  assert.ok(config.buildReceipt.endsWith('-app.json'), 'captured build receipt required');
  const stdout = config.buildReceipt.replace(/\.json$/, '.stdout.log');
  assert.equal(sha(stdout), build.stdoutSha256, 'build log bytes changed');
  assert.deepEqual(config.classpath, Array.from(readFileSync(stdout, 'utf8').matchAll(/Attributed\(([^\n]+)\)/g), match => match[1]), 'classpath must match the actual successful build');
  const outer = json(config.buildReceipt.replace(/-app\.json$/, '.json'));
  assert.equal(outer.exitCode, 0);
  assert.equal(outer.waited, true);
  assert.deepEqual(outer.protectedDrift, []);
  for (const [path, hash] of Object.entries(outer.sourceAfter)) {
    if (path.startsWith('bank-wealth-demo/v1/handwritten/') || path.startsWith('bank-wealth-demo/v1/test/')) {
      assert.equal(outer.sourceBefore[path], hash, 'external source changed during build');
      assert.equal(sha(join(dirname(ROOT), path)), hash, 'external source differs from tested build');
    }
  }
  assert.ok(outer.sourceAfter[`bank-wealth-demo/v1/test/scala/${childMain(config.caseName)}.scala`], 'crash child must be captured by successful build');
  return config;
}
function files(root, excludeBuild = false) {
  const result = {};
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (excludeBuild && ['target', '.bloop', '.bsp'].includes(entry.name)) continue;
      const child = join(path, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'source symlink');
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) result[relative(root, child)] = sha(child);
    }
  }
  walk(root);
  return result;
}
function inputs(config) {
  return { generated: files(config.target, true), handwritten: files(join(ROOT, 'v1/handwritten')),
    tests: files(join(ROOT, 'v1/test')), tools: files(join(ROOT, 'tools')),
    buildReceipt: sha(config.buildReceipt), classpath: Object.fromEntries(config.classpath.map(path =>
      [path, !existsSync(path) ? { absent: true } : lstatSync(path).isDirectory() ? files(path) : sha(path)])) };
}
export function validateChildReport(report, mode, config, pid, barrier = false) {
  assert.equal(report.schemaVersion, barrier ? 'bank-crash-barrier/v1' : 'bank-crash-result/v1');
  assert.equal(report.mode, mode);
  assert.equal(report.caseName, config.caseName);
  assert.equal(report.namespace, config.namespace);
  assert.equal(report.pid, pid, 'report must belong to the actual child');
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const e = report.evidence;
  assert.ok(object(e) && object(e.original) && object(e.identities) && object(e.eventCounts) && object(e.state) && object(e.journal) && object(e.financial), 'complete durable evidence required');
  const sip = sipCrashCases.includes(config.caseName);
  assert.equal(e.original.principalId, 'alice');
  assert.equal(e.original.clientRequestId, sip ? 'crash-sip-request' : 'crash-request');
  assert.equal(e.eventCounts[sip ? 'createIntent' : 'source'], 1);
  const identity = e.identities[sip ? 'planId' : 'paymentTxId'];
  assert.ok(typeof identity === 'string' && identity.length > 0);
  assert.ok(hash(e.journal.allDurableEventsSerializedSha256) && hash(e.journal.allPbEventsSha256));
  assert.ok(Array.isArray(e.journal.streams) && e.journal.streams.length >= 3, 'account and original streams required');
  assert.deepEqual(e.journal.persistenceIds, e.journal.streams.map(stream => stream.persistenceId));
  for (const stream of e.journal.streams) {
    assert.ok(typeof stream.persistenceId === 'string' && stream.persistenceId.length > 0);
    assert.ok(Array.isArray(stream.events) && stream.events.length > 0);
    assert.equal(stream.eventCount, stream.events.length);
    assert.equal(stream.lastSequenceNr, stream.events.length);
    assert.ok(hash(stream.serializedSha256) && hash(stream.pbSha256));
    stream.events.forEach((event, index) => {
      assert.equal(event.persistenceId, stream.persistenceId);
      assert.equal(event.sequenceNr, index + 1);
      assert.ok(hash(event.serializedSha256) && (event.pbSha256 === null || hash(event.pbSha256)));
      assert.ok(typeof event.eventType === 'string' && Number.isInteger(event.serializerId) && typeof event.manifest === 'string');
    });
  }
  assert.deepEqual(e.financial.original, e.original);
  assert.deepEqual(e.financial.identities, e.identities);
  assert.deepEqual(e.financial.eventCounts, e.eventCounts);
  assert.equal(e.financial.allPbEventsSha256, e.journal.allPbEventsSha256);
  assert.ok(Array.isArray(e.financial.durablePbVector) && e.financial.durablePbVector.length >= 3);
  assert.deepEqual(e.storage, { provider: 'local', journal: 'akka.persistence.journal.leveldb', native: false, fsync: true, snapshotStore: 'akka.persistence.snapshot-store.local' });
  if (sip) validateSipEvidence(e, config.caseName, barrier);
  if (taCrashCases.includes(config.caseName)) validateTaEvidence(e, config.caseName, barrier);
  if (barrier) {
    assert.equal(e.barrierCondition, config.caseName);
    assert.equal(e.loopStarted, false);
    assert.equal(e.fault.enabled, true);
    if (config.caseName === 'request-before-start') {
      assert.equal(e.eventCounts.settlement, 0);
      assert.equal(e.eventCounts.paymentParent.RunStarted, 0);
      assert.equal(e.fault.forwardBlocked, true);
    } else if (config.caseName === 'refund-before-assembly') {
      assert.equal(e.eventCounts.refundIntent, 1);
      assert.equal(e.eventCounts.refundParent.RunStarted, 0);
      assert.equal(e.fault.forwardBlocked, true);
    } else if (!sip && !taCrashCases.includes(config.caseName)) assert.ok(e.fault.hiddenReceiptReads > 0);
  } else {
    assert.equal(report.passed, true);
    if (!sip) {
      assert.equal(e.eventCounts.settlement, 1);
      assert.equal(e.eventCounts.paymentResult, 1);
      for (const key of ['paymentParent', ...(refundCase(config.caseName) ? ['refundParent'] : [])]) {
        assert.deepEqual(e.eventCounts[key], { RunStarted: 1, StageDone: 1, RunFailedEvt: 0 });
      }
    }
    assert.equal(e.recovery.driver, 'BankRecoveryLoop');
    assert.equal(e.recovery.customerResubmissions, 0);
    assert.equal(e.recovery.preservedOriginalSerializedPrefix, true);
  }
  return report;
}
function validateTaEvidence(e, caseName, barrier) {
  const c = e.eventCounts;
  for (const key of ['taAccepted', 'taConfirmed', 'taRegistration', 'taRejection', 'taHostIntent', 'taHostObservations',
    'paymentDeliveryAcknowledged', 'refundDeliveryAcknowledged', 'refundIntent', 'refundResult']) {
    assert.ok(Number.isSafeInteger(c[key]) && c[key] >= 0, `missing TA/delivery count: ${key}`);
  }
  assert.equal(c.settlement, 1);
  assert.equal(c.paymentResult, 1);
  assert.equal(c.paymentParent.RunStarted, 1);
  assert.equal(c.paymentParent.RunFailedEvt, 0);
  if (barrier) {
    assert.equal(e.fault.forwardBlocked, true);
    const paymentAck = caseName === 'payment-succeeded-before-delivery-ack';
    assert.equal(c.paymentParent.StageDone, paymentAck ? 0 : 1);
    assert.equal(c.paymentDeliveryAcknowledged, paymentAck ? 0 : 1);
    assert.equal(c.taRegistration, paymentAck ? 0 : 1);
    const external = e.financial.ta.journal;
    assert.ok(Number.isSafeInteger(external.submissionCount));
    assert.equal(external.submissionCount, paymentAck || ['ta-register-before-assembly', 'ta-intent-before-submit'].includes(caseName) ? 0 : 1);
    if (caseName === 'ta-register-before-assembly') {
      assert.equal(c.taHostIntent, 0);
      assert.equal(c.taParent.RunStarted, 0);
    } else if (caseName === 'ta-intent-before-submit') {
      assert.equal(c.taHostIntent, 1);
      assert.equal(c.taParent.RunStarted, 1);
      assert.equal(c.taParent.StageDone, 0);
    }
    if (['ta-register-before-assembly', 'ta-intent-before-submit', 'ta-submitted-before-bank-accept'].includes(caseName)) assert.equal(c.taAccepted, 0);
    if (caseName === 'ta-accepted-before-effect-reply') {
      assert.equal(c.taAccepted, 1);
      assert.equal(c.taHostObservations, 0);
      assert.equal(c.taParent.StageDone, 0);
    }
    if (caseName === 'ta-confirmed-before-ingest') {
      assert.equal(c.taAccepted, 1);
      assert.equal(c.taConfirmed, 0);
    }
    if (caseName === 'ta-rejected-after-ingest-before-ack') {
      assert.equal(c.taRejection, 1);
      assert.equal(c.refundIntent, 0);
      assert.equal(c.refundResult, 0);
    }
    if (caseName.endsWith('-ack')) assert.ok(Number.isSafeInteger(e.fault.withheldAcks) && e.fault.withheldAcks > 0);
    if (caseName === 'refund-succeeded-before-delivery-ack') {
      assert.equal(c.refundIntent, 1);
      assert.equal(c.refundResult, 1);
      assert.equal(c.refundParent.RunStarted, 1);
      assert.equal(c.refundParent.StageDone, 0);
      assert.equal(c.refundDeliveryAcknowledged, 0);
    }
  } else {
    assert.equal(c.taRegistration, 1);
    assert.equal(c.taAccepted, 1);
    assert.equal(c.taConfirmed, caseName === 'ta-confirmed-before-ingest' ? 1 : 0);
    assert.equal(c.taRejection, refundCase(caseName) ? 1 : 0);
    assert.equal(c.taHostIntent, 1);
    assert.ok(c.taHostObservations >= 1);
    assert.equal(c.paymentDeliveryAcknowledged, 1);
    assert.equal(c.refundDeliveryAcknowledged, refundCase(caseName) ? 1 : 0);
    assert.equal(c.refundIntent, refundCase(caseName) ? 1 : 0);
    assert.equal(c.refundResult, refundCase(caseName) ? 1 : 0);
    assert.deepEqual(c.taParent, { RunStarted: 1, StageDone: 1, RunFailedEvt: 0 });
    assert.equal(e.financial.ta.journal.submissionCount, 1);
  }
}
function validateSipEvidence(e, caseName, barrier) {
  const c = e.eventCounts;
  for (const key of ['created', 'appended', 'sealed', 'clockAdvanced', 'occurrences', 'successTotal', 'failureTotal',
    'terminalSucceeded', 'terminalFailed', 'cashSettlements', 'paymentResults']) {
    assert.ok(Number.isSafeInteger(c[key]) && c[key] >= 0, `missing SIP count: ${key}`);
  }
  assert.ok(e.financial.plan && Array.isArray(e.financial.orders), 'complete SIP plan and orders required');
  for (const key of ['sipParents', 'paymentParents', 'taParents']) assert.ok(Array.isArray(c[key]), 'SIP parent vector required');
  const creation = sipCrashCases.slice(0, 4).includes(caseName);
  const terminal = caseName.startsWith('sip-terminal-');
  assert.equal(c.failureTotal, 0);
  assert.equal(c.terminalFailed, 0);
  if (barrier) {
    assert.equal(e.fault.forwardBlocked, true);
    const index = sipCrashCases.indexOf(caseName);
    assert.equal(c.created, index === 0 ? 0 : 1);
    assert.equal(c.appended, index < 2 ? 0 : index === 2 ? 1 : 2);
    assert.equal(c.sealed, creation ? 0 : 1);
    assert.equal(c.clockAdvanced, creation ? 0 : 1);
    assert.equal(c.occurrences, creation || caseName === 'sip-tick-before-catchup' ? 0 : terminal ? 1 : 2);
    const counted = caseName === 'sip-terminal-ack-lost' ? 1 : 0;
    assert.equal(c.terminalSucceeded, counted);
    assert.equal(c.successTotal, counted);
    if (counted) assert.ok(Number.isSafeInteger(e.fault.withheldAcks) && e.fault.withheldAcks > 0);
    if (!terminal) {
      assert.equal(c.cashSettlements, 0);
      assert.equal(c.paymentResults, 0);
      for (const key of ['sipParents', 'paymentParents', 'taParents']) assert.deepEqual(c[key], []);
    } else {
      assert.equal(c.cashSettlements, 1);
      assert.equal(c.paymentResults, 1);
    }
  } else {
    assert.equal(c.created, 1);
    assert.equal(c.appended, 2);
    assert.equal(c.sealed, 1);
    const occurrences = creation ? 0 : terminal ? 1 : 2;
    assert.equal(c.clockAdvanced, creation ? 0 : 1);
    assert.equal(c.occurrences, occurrences);
    assert.equal(e.financial.orders.length, occurrences, 'complete per-occurrence orders required');
    assert.equal(c.cashSettlements, occurrences);
    assert.equal(c.paymentResults, occurrences);
    assert.equal(c.successTotal, terminal ? 1 : 0);
    assert.equal(c.terminalSucceeded, terminal ? 1 : 0);
    for (const key of ['sipParents', 'paymentParents', 'taParents']) {
      assert.equal(c[key].length, occurrences);
      for (const parent of c[key]) {
        assert.equal(parent.RunStarted, 1);
        assert.equal(parent.StageDone, 1);
        assert.equal(parent.RunFailedEvt, 0);
      }
    }
  }
}
export function compareRecoveryEvidence(recovered, verified) {
  assert.deepEqual(verified.evidence.financial, recovered.evidence.financial, 'third JVM changed original, PB event bytes or financial effects');
  if (taCrashCases.includes(recovered.caseName) || sipCrashCases.includes(recovered.caseName)) {
    assert.deepEqual(verified.evidence.journal, recovered.evidence.journal, 'third JVM changed complete serialized journal');
    return;
  }
  const before = recovered.evidence.journal.streams;
  const after = verified.evidence.journal.streams;
  assert.deepEqual(after.map(s => s.persistenceId), before.map(s => s.persistenceId), 'third JVM created another durable graph');
  for (let index = 0; index < before.length; index++) {
    const old = before[index].events, current = after[index].events;
    assert.deepEqual(current.slice(0, old.length), old, 'durable prefix changed');
    for (const event of current.slice(old.length)) {
      assert.equal(event.pbSha256, null, 'third JVM appended a business PB');
      assert.ok(/^(net\.imadz\.infra\.saga\.strict\.|net\.imadz\.monarch\.persistence\.PersistentMonarch\$|example\.bankwealth\.application\.bank_(payment_hostHost|refund_hostHost|ta_effectEffectHost)\$)/.test(event.eventType));
      assert.ok(!/\$(RunStarted|StageDone|RunFailedEvt)$/.test(event.eventType), 'third JVM repeated a parent checkpoint');
    }
  }
}
async function workerExited(path) {
  if (!existsSync(path)) return [];
  const starts = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(row => row.kind === 'worker-started');
  assert.equal(starts.length, 1, 'one owned worker expected');
  const pid = starts[0].pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return [{ pid, absent: true }]; throw error; }
    await sleep(100);
  }
  throw new Error('owned worker still present after JVM exit; no successor was started');
}
async function invocation(config, mode) {
  const directory = join(config.ownedRoot, 'runs', mode);
  mkdirSync(directory, { mode: 0o700 });
  const command = [config.java, '-Xmx1G', '-cp', config.classpath.join(':'), `example.bankwealth.service.${childMain(config.caseName)}`,
    mode, config.caseName, config.ownedRoot, config.namespace, config.node, config.worker, directory];
  const out = openSync(join(directory, 'stdout.log'), 'wx', 0o600);
  const err = openSync(join(directory, 'stderr.log'), 'wx', 0o600);
  let child;
  try { child = spawn(command[0], command.slice(1), { cwd: config.target, stdio: ['ignore', out, err],
    env: { ...process.env, JAVA_HOME: dirname(dirname(config.java)), COURSIER_MODE: 'offline' } }); }
  finally { closeSync(out); closeSync(err); }
  let outcome, failure, timedOut = false, killTimer;
  const done = new Promise(resolveExit => {
    child.once('error', error => { failure = error.code ?? 'spawn-error'; });
    child.once('close', (exitCode, signal) => { outcome = { exitCode, signal, waited: true }; resolveExit(outcome); });
  });
  save(join(directory, 'process.json'), { pid: child.pid ?? null, command, cwd: config.target });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), 15000);
  }, 130000);
  let report, caught, workerStates = [];
  try {
    if (mode === 'crash') {
      const barrier = join(directory, 'barrier.json');
      while (!existsSync(barrier) && !outcome && !timedOut) await sleep(100);
      assert.ok(existsSync(barrier) && !outcome && !timedOut, 'child did not reach durable barrier');
      report = validateChildReport(json(barrier), mode, config, child.pid, true);
      assert.equal(child.kill('SIGKILL'), true, 'owned child signal was not sent');
      await done;
      assert.equal(outcome.signal, 'SIGKILL');
      assert.equal(existsSync(join(directory, 'closed.json')), false, 'crash unexpectedly ran graceful cleanup');
    } else {
      await done;
      assert.equal(outcome.exitCode, 0, 'recovery JVM failed');
      assert.equal(outcome.signal, null);
      report = validateChildReport(json(join(directory, 'result.json')), mode, config, child.pid);
      assert.equal(json(join(directory, 'closed.json')).pid, child.pid);
    }
    assert.ok(!timedOut && !failure, 'child timeout or spawn failure');
  } catch (error) { caught = error; }
  finally {
    if (!outcome) {
      child.kill('SIGTERM');
      const fallback = setTimeout(() => child.kill('SIGKILL'), 15000);
      await done;
      clearTimeout(fallback);
    }
    clearTimeout(timer); clearTimeout(killTimer);
    try { workerStates = await workerExited(join(directory, 'worker.jsonl')); }
    catch (error) { caught ??= error; }
    save(join(directory, 'exit.json'), { pid: child.pid ?? null, ...outcome, timedOut, failure: failure ?? null,
      workerStates, passed: !caught, stdoutSHA: sha(join(directory, 'stdout.log')), stderrSHA: sha(join(directory, 'stderr.log')) });
  }
  if (caught) throw caught;
  return { mode, pid: child.pid, ...outcome, workerStates, report };
}
export async function runBankCrashRecovery(config) {
  validateCrashConfiguration(config);
  const before = inputs(config);
  assert.deepEqual(before.generated, json(config.buildReceipt).sourceAfter, 'generated files differ from successful build');
  const compiled = json(config.buildReceipt.replace(/-app\.json$/, '-build-output.json'));
  assert.equal(compiled.schemaVersion, 'bank-crash-build-output/v1');
  assert.equal(compiled.buildReceiptSHA, sha(config.buildReceipt));
  assert.equal(compiled.sourceReceiptSHA, sha(config.buildReceipt.replace(/-app\.json$/, '.json')));
  assert.deepEqual(before.classpath, compiled.classpath, 'bytecode or dependency bytes differ from successful build');
  mkdirSync(config.ownedRoot, { mode: 0o700 });
  mkdirSync(join(config.ownedRoot, 'runs'), { mode: 0o700 });
  save(join(config.ownedRoot, 'inputs.json'), before);
  const results = [];
  let caught;
  try {
    for (const mode of ['crash', 'recover', 'verify']) results.push(await invocation(config, mode));
    assert.equal(new Set(results.map(row => row.pid)).size, 3, 'three separate JVMs required');
    compareRecoveryEvidence(results[1].report, results[2].report);
  } catch (error) { caught = error; }
  const after = inputs(config);
  try { assert.deepEqual(after, before, 'input changed during crash experiment'); }
  catch (error) { caught ??= error; }
  const receipt = { schemaVersion: 'bank-cross-jvm-crash/v1', caseName: config.caseName, namespace: config.namespace,
    target: config.target, passed: !caught, results, inputUnchanged: JSON.stringify(before) === JSON.stringify(after),
    inputsSHA: sha(join(config.ownedRoot, 'inputs.json')), failure: caught?.message ?? null,
    scope: 'owned LevelDB fsync / local snapshot / real generated actors; not Mongo fault injection or multi-writer certification' };
  save(join(config.ownedRoot, 'receipt.json'), receipt);
  if (caught) throw caught;
  return receipt;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  assert.ok(process.argv.length === 4 && process.argv[2] === '--config', 'Usage: --config /absolute/fresh-run-config.json');
  existing(process.argv[3]);
  const receipt = await runBankCrashRecovery(json(process.argv[3]));
  console.log(JSON.stringify({ passed: receipt.passed, caseName: receipt.caseName, pids: receipt.results.map(row => row.pid) }));
}
