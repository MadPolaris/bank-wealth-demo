import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { admitRuntimeBuild, captureRuntimeFile } from './truthsrc-runtime-admission.mjs';
import { acquireRuntimeLease } from './truthsrc-runtime-lease.mjs';
import { issueRuntimeCredentials, productionConfiguration } from './truthsrc-runtime-config.mjs';
import { OwnedRuntimeDatabases } from './truthsrc-runtime-databases.mjs';
import { runRuntimeProcess } from './truthsrc-runtime-process.mjs';
import { runtimeSandboxText, runtimeProbeSource, validateRuntimeSandboxPaths, RUNTIME_NETWORK_SCOPE, RUNTIME_NETWORK_LIMITATION } from './truthsrc-runtime-sandbox.mjs';
import { runtimeClasspathInventory } from './truthsrc-runtime-tests.mjs';
import { checkRuntimeWorker } from './truthsrc-runtime-crash.mjs';
import { fileDigest, inventory, safePath } from './verify-truthsrc-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = 'example.bankwealth.workshop.BankWorkshopMain';
const SOURCE = join(ROOT, 'tools/scala/BankWorkshopMain.scala');
const WORKER = join(ROOT, 'tools/truthsrc-runtime-ta-worker.mjs');
const FIXTURE = join(ROOT, 'test/fixtures/truthsrc-actor-ta.json');
const SCHEMA = 'bank.workshop-session/v1';
const SANDBOX = '/usr/bin/sandbox-exec';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = ({ bytes, sha256 }) => ({ bytes, sha256 });
const capture = file => stamp(captureRuntimeFile(file, { limit: 512 * 1024 * 1024 }));
const read = file => captureRuntimeFile(file, { json: true }).value;
const write = (file, text) => writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
const save = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n');
const mkdir = file => mkdirSync(file, { mode: 0o700 });
const inside = (a, b) => b.toLowerCase() === a.toLowerCase() || b.toLowerCase().startsWith(a.toLowerCase() + '/');
const disjoint = (a, b) => assert.ok(!inside(a, b) && !inside(b, a), 'session and accepted inputs must be disjoint');
const snapshots = files => Object.fromEntries(files.map(file => [file, capture(file)]));
const same = assert.deepEqual;
const SUPPORT = [fileURLToPath(import.meta.url), SOURCE, WORKER, FIXTURE,
  ...['truthsrc-runtime-admission', 'truthsrc-runtime-lease', 'truthsrc-runtime-config', 'truthsrc-runtime-databases',
    'truthsrc-runtime-db-relay', 'truthsrc-runtime-db-exec', 'truthsrc-runtime-process', 'truthsrc-runtime-sandbox',
    'truthsrc-runtime-tests', 'truthsrc-actor-ta-worker', 'truthsrc-runtime-crash', 'v1-crash-recovery',
    'v1-release-build-evidence', 'truthsrc-runtime-jars', 'verify-truthsrc-build'].map(name => join(ROOT, 'tools', name + '.mjs')),
  join(ROOT, '../metarch-truthsrc/lib/strict-json.mjs'),
  join(ROOT, 'tools/historical-assets.mjs'), join(ROOT, 'docs/V1-RETIREMENT-MANIFEST.json'),
  ...['contract', 'journal', 'mock-ta-core'].map(name => join(ROOT, 'simulator', name + '.mjs'))];
const loadedSupport = snapshots(SUPPORT);
const now = () => new Date().toISOString();
const lifetime = value => value && Object.fromEntries(['pid', 'ppid', 'pgid', 'uid', 'birth'].map(key => [key, value[key]]));

export const SESSION_HELP = 'start --accepted-run <full-pipeline-report-directory> --session <new-bank-target/truthsrc-runtime-OWNER> --lease <new-owner-lease.json> | status|stop --session <owned-session>';
export function sessionArgs(command, args) {
  assert.ok(['start', 'status', 'stop'].includes(command), SESSION_HELP);
  const fields = command === 'start' ? { '--accepted-run': 'acceptedRun', '--session': 'session', '--lease': 'lease' } : { '--session': 'session' };
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = fields[args[i]];
    assert.ok(key && !Object.hasOwn(options, key) && args[i + 1] && !args[i + 1].startsWith('--'), SESSION_HELP);
    options[key] = args[i + 1];
  }
  same(Object.keys(options).sort(), Object.values(fields).sort(), SESSION_HELP);
  return options;
}

// Adapter only: the report implementation remains the authority for full-pipeline
// and freshness gates. Never accept a caller-supplied boolean or a saved summary.
// Required normalized fields are kept independent of its evolving index schema.
export async function acceptedWorkshopRun(run) {
  safePath(run); assert.ok(inside(join(ROOT, 'target'), run));
  const files = ['run.json', 'results.json'].map(name => join(run, name));
  const before = snapshots(files), index = read(files[1]);
  const { reportWorkshop } = await import('./bank-workshop-verification.mjs');
  const result = await reportWorkshop({ run });
  same(snapshots(files), before, 'report changed during admission');
  assert.equal(result.schemaVersion, 'bank.workshop-report/v1');
  assert.equal(result.run, run); assert.equal(result.fullPipelinePassed, true);
  assert.equal(result.requestedScopePassed, true); assert.equal(result.through, 'service');
  assert.equal(result.executionKind, 'real'); same(result.diagnostics, []);
  same(result.stages.map(row => [row.id, row.status, row.rechecked]),
    ['source', 'anchors', 'code', 'service'].map(id => [id, 'passed', true]));
  const candidates = index.candidates.filter(row => row.mode === 'runtime'); assert.equal(candidates.length, 1);
  const candidate = candidates[0]; assert.equal(candidate.built, true);
  same([candidate.snapshot, candidate.codeDigest], [result.snapshot, result.codeDigest]);
  assert.match(result.codeDigest, /^sha256:[a-f0-9]{64}$/);
  const service = read(join(index.runtime.evidence, 'result.json'));
  assert.equal(service.buildEvidence, candidate.evidence);
  assert.equal(typeof service.owner, 'string');
  return { run, fullPipelinePassed: true, snapshot: result.snapshot, codeDigest: result.codeDigest,
    buildEvidence: candidate.evidence, output: candidate.output, previousOwner: service.owner,
    receipts: before };
}

export function sessionCompilePlan({ admitted, session, sourceSha256 }) {
  const build = join(session, 'build'), classes = join(build, 'classes'), source = join(build, 'BankWorkshopMain.scala');
  const compiler = ['scala-compiler', 'scala-library', 'scala-reflect'].map(name =>
    join(admitted.buildEvidence, 'supply/maven/org/scala-lang', name, '2.13.14', name + '-2.13.14.jar'));
  // The supplied compiler is part of the already checked clean archive inventory;
  // neither a warm cache nor an arbitrary scalac/JDK flag is admitted.
  const profile = ['(version 1)', '(allow default)', '(deny network*)', '(deny file-write*)',
    `(allow file-write* (subpath ${JSON.stringify(build)}) (literal "/dev/null"))`,
    `(deny file-write* (literal ${JSON.stringify(source)}) (literal ${JSON.stringify(join(build, 'sandbox.sb'))}))`,
    `(deny file-write-unlink (literal ${JSON.stringify(build)}))`, ''].join('\n');
  return { build, classes, source, sourceSha256, compiler, profile,
    args: ['-Xmx1G', '-XX:ActiveProcessorCount=2', '-XX:-UsePerfData', '-Duser.home=' + join(build, 'home'),
      '-Djava.io.tmpdir=' + join(build, 'tmp'), '-XX:ErrorFile=' + join(build, 'tmp/hs_err_pid%p.log'),
      '-cp', compiler.join(':'), 'scala.tools.nsc.Main', '-encoding', 'UTF-8', '-classpath', admitted.classpath.join(':'), '-d', classes, source] };
}

async function compileLauncher({ admitted, session, env, signal }) {
  const original = captureRuntimeFile(SOURCE), plan = sessionCompilePlan({ admitted, session, sourceSha256: original.sha256 });
  const compiler = snapshots(plan.compiler);
  const supply = read(join(admitted.buildEvidence, 'supply-before.json')).files;
  for (const [file, value] of Object.entries(compiler)) same(value, supply[file.slice(join(admitted.buildEvidence, 'supply').length + 1)], 'compiler not in admitted supply');
  mkdir(plan.build); for (const name of ['classes', 'tmp', 'home']) mkdir(join(plan.build, name));
  write(plan.source, original.value); write(join(plan.build, 'sandbox.sb'), plan.profile);
  const sandbox = { executable: SANDBOX, profile: join(plan.build, 'sandbox.sb'), profileSha256: hash(plan.profile) };
  const receipt = await runRuntimeProcess({ executable: admitted.java, args: plan.args, cwd: plan.build,
    env: { ...env, HOME: join(plan.build, 'home'), TMPDIR: join(plan.build, 'tmp') },
    base: join(plan.build, 'compile'), timeoutMs: 120_000, sandbox, signal });
  assert.equal(receipt.passed, true, 'workshop launcher compile failed');
  same(capture(SOURCE), stamp(original)); same(capture(plan.source), stamp(original)); same(snapshots(plan.compiler), compiler);
  const files = inventory(plan.classes), prefix = MAIN.replaceAll('.', '/');
  assert.ok(files[prefix + '.class'] && files[prefix + '$.class'], 'compiled workshop main missing');
  assert.ok(Object.keys(files).every(file => file === prefix + '.class' || file.startsWith(prefix + '$') && file.endsWith('.class')), 'foreign session classes');
  const launcher = { source: { file: SOURCE, ...stamp(original) }, stagedSource: { file: plan.source, ...stamp(original) },
    classes: plan.classes, files, compiler, compileReceipt: { file: join(plan.build, 'compile.json'), ...capture(join(plan.build, 'compile.json')) },
    compiled: true, previouslyServiceTested: false };
  save(join(plan.build, 'launcher.json'), launcher);
  return launcher;
}

// No args/env inspection. PID birth, parent/group and executable name are read
// only for PIDs captured by this session. Kernel PID reuse is not ownership.
export async function sessionProcessIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  try {
    const { stdout } = await promisify(execFile)('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,uid=,lstart=,comm='],
      { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 16384 });
    const match = stdout.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/);
    assert.ok(match); assert.equal(Number(match[1]), pid);
    return { pid, ppid: Number(match[2]), pgid: Number(match[3]), uid: Number(match[4]), birth: match[5], executable: match[6] };
  } catch (error) { if (error.code === 1 && !error.stdout?.trim()) return null; throw new Error('session PID identity unavailable'); }
}

async function verifyListener(pid, port) {
  const { stdout } = await promisify(execFile)('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fpn'],
    { env: { PATH: '/usr/bin:/bin' }, timeout: 5000, maxBuffer: 16384 });
  assert.ok(stdout.split('\n').includes('p' + pid));
  same(stdout.trim().split('\n').filter(line => line.startsWith('n')), ['n127.0.0.1:' + port], 'unexpected JVM listener');
}

async function waitHttp({ origin, credentials, signal, exited }) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    signal.throwIfAborted(); assert.equal(exited(), false, 'server exited during readiness');
    try {
      const response = await fetch(origin + '/api/v1/accounts/me', { headers: { Authorization: 'Bearer ' + credentials.customer.token },
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= 262144); chunks.push(chunk); }
      const view = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (response.status === 200 && view.metadata?.disposition === 'caught-up' && view.account) return;
    } catch { /* no raw HTTP exception/body reaches logs or receipts */ }
    await delay(250);
  }
  throw new Error('authenticated readside readiness deadline');
}

async function runtimeBoundary({ session, round, ports, immutable, env, signal }) {
  const directory = join(session, 'boundary'); mkdir(directory);
  const profile = join(directory, 'runtime-sandbox.sb'), probe = join(directory, 'runtime-probe.py'), canary = join(session, 'canary');
  write(canary, 'unchanged\n');
  // The canary is outside BOTH writable roots. Controller receipts and private
  // credentials are never JVM-writable; only run/ and this TA round are writable.
  const options = { evidence: join(session, 'run'), taRoot: round, httpPort: ports.http, databasePorts: [ports.mysql, ports.mongo],
    readOnlyFiles: [...immutable, profile, probe], networkScope: RUNTIME_NETWORK_SCOPE };
  write(profile, runtimeSandboxText(options));
  write(probe, runtimeProbeSource({ ...options, canary, positiveNetwork: true }));
  validateRuntimeSandboxPaths(options);
  const before = snapshots([profile, probe, canary]);
  const sandbox = { executable: SANDBOX, profile, profileSha256: capture(profile).sha256 };
  const receipt = await runRuntimeProcess({ executable: '/usr/bin/python3', args: ['-I', '-S', probe], cwd: directory,
    env, base: join(directory, 'probe'), timeoutMs: 30_000, sandbox, signal });
  assert.equal(receipt.passed, true, 'runtime sandbox syscall probe failed');
  const text = captureRuntimeFile(join(directory, 'probe.stdout.log')).value.toString('utf8');
  for (const depth of [0, 1, 2]) assert.ok(text.includes('TRUTHSRC-RUNTIME-SANDBOX-OK scope=' + RUNTIME_NETWORK_SCOPE + ' depth=' + depth));
  same(snapshots(Object.keys(before)), before);
  save(join(directory, 'boundary.json'), { passed: true, before, networkScope: RUNTIME_NETWORK_SCOPE, limitation: RUNTIME_NETWORK_LIMITATION });
  return sandbox;
}

// Workshop-specific unbounded foreground lifetime; never route through the 240s
// acceptance main or mislabel a 2^31ms test timeout as an indefinite session.
// Raw JVM output is DISCARDED at the OS descriptors. No credential-bearing log is
// ever persisted then scrubbed. Structured markers and compile/probe logs suffice.
function launchServer({ admitted, launcher, session, env, sandbox, identity }) {
  assert.equal(process.platform, 'darwin');
  const profile = captureRuntimeFile(sandbox.profile).value.toString('utf8');
  assert.equal(hash(profile), sandbox.profileSha256);
  const cp = [...admitted.classpath, launcher.classes].join(':');
  assert.equal(hash(cp), identity.classpathSha256);
  const args = ['-Xmx1G', '-XX:ActiveProcessorCount=2', '-XX:-UsePerfData', '-Djava.net.preferIPv4Stack=true',
    '-Duser.home=' + env.HOME, '-Djava.io.tmpdir=' + env.TMPDIR, '-XX:ErrorFile=/dev/null',
    '-Dconfig.file=' + join(session, 'private/session.conf'), '-Dlogback.configurationFile=' + join(session, 'private/logback.xml'),
    '-cp', cp, MAIN, join(session, 'run'), join(session, 'private/session.conf')];
  const child = spawn(SANDBOX, ['-p', profile, admitted.java, ...args], { cwd: join(session, 'run'), env, detached: true, stdio: 'ignore' });
  let exited = false, closed = false, code = null, exitSignal = null, failed = false;
  const settled = new Promise(done => {
    child.once('error', () => { failed = true; if (!child.pid) { closed = true; done(); } });
    child.once('exit', () => { exited = true; });
    child.once('close', (c, s) => { closed = true; code = c; exitSignal = s; done(); });
  });
  const groupAlive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; return true; }
  };
  return { pid: child.pid, exited: () => exited || failed, settled,
    async stop(birth) {
      // Graceful marker first. Signals are fallback for THIS still-live direct
      // child only, after a fresh birth/owner check. Never kill a reused PID or an
      // orphan process group once its leader is gone; retain the lease instead.
      let forced = false;
      for (const [wait, signal] of [[100_000, 'SIGTERM'], [15_000, 'SIGKILL'], [5000, null]]) {
        const until = Date.now() + wait;
        while ((!closed || groupAlive()) && Date.now() < until) await delay(100);
        if (closed && !groupAlive()) break;
        if (!signal || exited || failed || !birth) break;
        same(lifetime(await sessionProcessIdentity(child.pid)), lifetime(birth), 'JVM identity changed before signal');
        assert.equal(birth.uid, process.getuid()); assert.equal(birth.ppid, process.pid); assert.equal(birth.pgid, child.pid);
        child.kill(signal); forced = true;
      }
      return { pid: child.pid ?? null, code, signal: exitSignal, directChildClosed: closed, directChildReaped: exited && closed,
        groupAliveAfter: groupAlive(), forced, exited: closed && !groupAlive(), clean: closed && exited && !failed && code === 0 && exitSignal === null && !forced,
        outputPolicy: 'discarded-no-raw-jvm-logs' };
    } };
}

function privateOwned(file, directory = false) {
  safePath(file, directory ? 'directory' : 'file'); const stat = lstatSync(file);
  assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o077, 0, 'private session ownership required');
  if (!directory) assert.equal(stat.nlink, 1);
  return [stat.dev, stat.ino];
}
function checkSessionPath(session, root, fresh = false) {
  assert.equal(dirname(session), join(root, 'target'));
  assert.match(basename(session), /^truthsrc-runtime-[a-z][a-z0-9_-]{0,59}$/);
  safePath(session, fresh ? 'new' : 'directory');
}
function checkBaseSeal(seal) {
  same(seal.support, snapshots(SUPPORT), 'session launcher/helper changed');
  same(runtimeClasspathInventory(seal.classpath, seal.actualRoot, seal.buildEvidence, { safePath, inventory, fileDigest }), seal.classpathInventory);
  same(snapshots(Object.keys(seal.acceptedReceipt.receipts)), seal.acceptedReceipt.receipts, 'accepted report changed');
  same(snapshots(Object.keys(seal.toolchain)), seal.toolchain, 'launch executable changed');
}
function checkSeal(seal, session) {
  checkBaseSeal(seal);
  assert.equal(seal.launcher.classes, join(session, 'build/classes'));
  same(inventory(seal.launcher.classes), seal.launcher.files, 'session class bytes changed');
  same(capture(seal.launcher.stagedSource.file), stamp(seal.launcher.stagedSource));
  same(snapshots(Object.keys(seal.launcher.compiler)), seal.launcher.compiler);
  same(capture(seal.launcher.compileReceipt.file), stamp(seal.launcher.compileReceipt));
}
function verifySessionLease(record, root, active) {
  const registry = join(root, 'target/truthsrc-runtime-leases'); privateOwned(registry, true);
  const used = join(registry, 'owner-' + record.owner + '.used.json'); privateOwned(used);
  const lease = read(used);
  same([lease.owner, lease.runRoot, lease.round, lease.pid, lease.input, lease.ports],
    [record.owner, record.session, record.round, record.controller.pid, record.leaseInput, record.ports], 'session lease identity differs');
  assert.equal(lease.host, '127.0.0.1'); assert.equal(lease.schemaVersion, 'bank.truthsrc-runtime-lease/v1');
  if (active) {
    same(capture(lease.input.file), stamp(lease.input), 'lease input changed');
    for (const name of ['owner-' + record.owner, ...Object.values(record.ports).map(port => 'port-' + port)]) {
      const file = join(registry, name + '.lock'); privateOwned(file); same(read(file), lease, 'active session lease no longer held');
    }
  }
}
function requestValue(record) {
  return { schemaVersion: SCHEMA, owner: record.owner, identity: record.identity, controller: record.controller };
}
function instanceValue(record) {
  return { schemaVersion: 'bank.workshop-instance/v1', owner: record.owner, identity: record.identity,
    classpathSha256: record.classpathSha256, launcherSha256: record.launcherSha256 };
}
function verifyMarker(marker, record, pid) {
  for (const [key, value] of Object.entries(instanceValue(record))) same(marker[key], value, 'foreign JVM marker');
  assert.equal(marker.pid, pid);
}

// This is the complete public diagnostic vocabulary, shared with the source-pinned
// Scala main. Never forward marker text, exception messages, config or HTTP bodies.
const JVM_FAILURES = Object.freeze({
  identity: ['JVM_IDENTITY_REJECTED', 'Launcher identity/classpath check failed. Retain this session and use a fresh accepted build and owner.'],
  configuration: ['JVM_CONFIGURATION_REJECTED', 'Session configuration was rejected. Check the launcher configuration wiring; do not share the private config or login contents.'],
  'application-load': ['JVM_APPLICATION_LOAD_FAILED', 'Application loading failed. Check the owned database and TA setup and the launcher wiring; no raw JVM logs were retained.'],
  'server-bind': ['JVM_SERVER_BIND_FAILED', 'The server could not bind the reserved loopback endpoint. Check this owner lease and listener; do not stop an unknown process.'],
  'ready-marker': ['JVM_READY_MARKER_FAILED', 'The bound server could not publish its ready marker. Retain the owned run directory for investigation.'],
  'stop-control': ['JVM_STOP_CONTROL_REJECTED', 'The JVM stop control failed its identity/read check. Retain this owner session; do not replace its control files.'],
  'resource-close': ['JVM_RESOURCE_CLOSE_FAILED', 'JVM resource closure failed. Retain the session data and investigate its owned resources before using a new owner.'],
});
function jvmFailure(session, record, pid) {
  const file = join(session, 'run/failure.json');
  if (!existsSync(file)) return null;
  try {
    privateOwned(file);
    const marker = captureRuntimeFile(file, { json: true, limit: 16384 }).value;
    verifyMarker(marker, record, pid);
    same(Object.keys(marker).sort(), [...Object.keys(instanceValue(record)), 'pid', 'phase', 'code'].sort());
    assert.ok(Object.hasOwn(JVM_FAILURES, marker.phase));
    const [code, message] = JVM_FAILURES[marker.phase]; assert.equal(marker.code, code);
    return { code, phase: marker.phase, message };
  } catch {
    return { code: 'SESSION_JVM_MARKER_REJECTED', phase: 'jvm-diagnostic',
      message: 'JVM diagnostic marker identity or vocabulary was rejected. No marker contents were copied; retain this owner session.' };
  }
}

async function waitMarker(file, child, signal, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    assert.equal(existsSync(join(dirname(file), 'failure.json')), false, 'JVM failure marker present');
    assert.equal(child.exited(), false, 'JVM exited before ready');
    if (existsSync(file)) return read(file);
    assert.ok(Date.now() < until, 'JVM readiness deadline'); await delay(100);
  }
}

// No CLI injection flags. Dependencies below are solely Node-contract seams; all
// override runs are labelled test-double and cannot certify the session launcher.
export async function sessionStart({ buildEvidence, acceptedReceipt, session, lease }, overrides = {}) {
  const ops = { root: ROOT, accept: acceptedWorkshopRun, admit: admitRuntimeBuild, acquire: acquireRuntimeLease,
    compile: compileLauncher, boundary: runtimeBoundary, databases: options => new OwnedRuntimeDatabases(options), launch: launchServer,
    processIdentity: sessionProcessIdentity, listener: verifyListener, http: waitHttp, seal: checkSeal,
    platform: () => assert.ok(process.platform === 'darwin' && process.arch === 'x64', 'native Darwin x64 sandbox required'),
    ready: value => process.stdout.write(JSON.stringify(value) + '\n'), ...overrides };
  const executionKind = Object.keys(overrides).length ? 'test-double' : 'real';
  let phase = 'admission', held, databases, child, birth, record, created = false, ready = false, stoppedByUser = false;
  let processReceipt, databaseReceipt, baseSeal, seal, recheckBuild, requestMonitor, failure = null, released = false;
  const cancellation = new AbortController(), cancelled = new Error('session stop requested');
  const cancel = () => { stoppedByUser = true; cancellation.abort(cancelled); };
  // The existing bounded helpers may wrap an AbortError or return a failed receipt.
  // Translate only their interrupted calls, not arbitrary identity/seal assertions.
  const interruptible = async action => {
    cancellation.signal.throwIfAborted();
    try { const result = await action(); cancellation.signal.throwIfAborted(); return result; }
    catch (error) { cancellation.signal.throwIfAborted(); throw error; }
  };
  const collectJvmFailure = () => {
    if (!child || !record) return;
    const diagnostic = jvmFailure(session, record, child.pid);
    if (diagnostic && (!failure || failure.code === 'SESSION_BLOCKED')) failure = diagnostic;
  };
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  const checks = { inputsUnchanged: false, workerClosed: false, serverClosed: false, resourcesExited: false };
  try {
    ops.platform(); checkSessionPath(session, ops.root, true);
    same(await interruptible(() => ops.accept(acceptedReceipt.run)), acceptedReceipt, 'full report must be freshly revalidated');
    assert.equal(acceptedReceipt.fullPipelinePassed, true); assert.equal(buildEvidence, acceptedReceipt.buildEvidence);
    disjoint(session, acceptedReceipt.run); disjoint(session, buildEvidence); disjoint(session, acceptedReceipt.output);
    same(snapshots(SUPPORT), loadedSupport);
    const admitted = await interruptible(() => ops.admit(buildEvidence));
    recheckBuild = admitted.assertUnchanged;
    assert.equal(admitted.output, acceptedReceipt.output);
    const round = join(ops.root, '.local/mock-ta', basename(session));
    held = await ops.acquire({ lease, buildEvidence, evidence: session, round });
    assert.notEqual(held.spec.owner, acceptedReceipt.previousOwner, 'session cannot inherit accepted-run owner');
    held.assertHeld(); cancellation.signal.throwIfAborted();
    mkdir(session); created = true; mkdir(round); mkdir(join(round, 'service')); mkdir(join(round, 'service/logs'));
    for (const dir of ['run', 'private', 'databases']) mkdir(join(session, dir));
    for (const name of ['home', 'tmp']) mkdir(join(session, 'run', name));
    const env = { HOME: join(session, 'run/home'), TMPDIR: join(session, 'run/tmp'), JAVA_HOME: admitted.javaHome,
      PATH: join(admitted.javaHome, 'bin') + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', NODE_V8_COVERAGE: '' };
    baseSeal = { schemaVersion: SCHEMA, acceptedReceipt, buildEvidence, actualRoot: admitted.actualRoot, output: admitted.output,
      classpath: admitted.classpath, classpathInventory: admitted.before.classpathInventory, toolchain: admitted.before.toolchain, support: loadedSupport };
    save(join(session, 'preparing-seal.json'), baseSeal);
    record = { schemaVersion: SCHEMA, executionKind, owner: held.spec.owner, identity: randomBytes(24).toString('hex'),
      session, round, createdAt: now(), directoryIdentity: privateOwned(session, true),
      controller: await ops.processIdentity(process.pid), ports: held.spec.ports, leaseInput: held.record.input,
      preparingSealSha256: capture(join(session, 'preparing-seal.json')).sha256,
      loginFile: join(session, 'private/login.json'), origin: 'http://127.0.0.1:' + held.spec.ports.http,
      previouslyServiceTested: false, networkLimitation: RUNTIME_NETWORK_LIMITATION };
    assert.equal(record.controller?.pid, process.pid); assert.equal(record.controller.uid, process.getuid());
    save(join(session, 'preparing.json'), record);
    const checkRequest = () => {
      const file = join(session, 'stop-request.json');
      if (!existsSync(file)) return false;
      privateOwned(file); same(read(file), requestValue(record), 'foreign stop request');
      return true;
    };
    // stop also works while compiling, creating databases or waiting for ready.
    requestMonitor = setInterval(() => {
      try { if (checkRequest()) cancel(); }
      catch { failure ??= { code: 'SESSION_CONTROL_CHANGED', phase: 'stop-control', message: 'Foreign stop request; owner investigation required.' }; cancellation.abort(); }
    }, 250);
    phase = 'launcher-compile';
    const launcher = await interruptible(() => ops.compile({ admitted, session, env, signal: cancellation.signal }));
    await admitted.assertUnchanged(); cancellation.signal.throwIfAborted();
    seal = { ...baseSeal, launcher };
    save(join(session, 'seal.json'), seal);
    record = { ...record, sealSha256: capture(join(session, 'seal.json')).sha256,
      classpathSha256: hash([...admitted.classpath, launcher.classes].join(':')), launcherSha256: hash(JSON.stringify(launcher)) };
    save(join(session, 'session.json'), record);
    save(join(session, 'run/identity.json'), instanceValue(record));
    const checkInputs = async () => { held.assertHeld(); await admitted.assertUnchanged(); ops.seal(seal, session); };
    const credentials = issueRuntimeCredentials(), playSecret = randomBytes(32).toString('hex'), machineToken = randomBytes(32).toString('hex');
    databases = ops.databases({ evidence: join(session, 'databases'), owner: record.owner,
      mysqlPort: record.ports.mysql, mongoPort: record.ports.mongo, signal: cancellation.signal });
    phase = 'databases';
    const endpoints = await interruptible(() => databases.start());
    const namespace = 'workshop_' + hash(record.identity).slice(0, 24);
    await interruptible(() => databases.createSchema(namespace));
    const taConfig = join(round, 'runtime-ta.json');
    save(taConfig, { schemaVersion: 'bank.truthsrc-runtime-ta/v1', ownedRoot: round,
      fixture: { file: FIXTURE, sha256: capture(FIXTURE).sha256 } });
    const configuration = productionConfiguration({ namespace, schema: namespace, httpPort: record.ports.http,
      mysqlPort: record.ports.mysql, mongoPort: record.ports.mongo, mysqlUser: endpoints.mysql.username, mysqlPassword: endpoints.mysql.password,
      mongoUser: endpoints.mongo.username, mongoPassword: endpoints.mongo.password, credentials, playSecret, machineToken,
      node: admitted.node, worker: WORKER, taRoot: join(round, 'service'), run: join(round, 'service/logs'), mode: 'initial' });
    write(join(session, 'private/session.conf'), configuration.text);
    // No appenders: sensitive exceptions cannot create an uncontrolled log sink.
    write(join(session, 'private/logback.xml'), '<configuration><root level="OFF"/></configuration>\n');
    save(record.loginFile, { private: true, session, origin: record.origin, url: record.origin + '/bank/v1',
      instructions: 'Enter these values only in the local sign-in form. Never paste into a URL, log, report or issue. System is not a login.',
      customer: credentials.customer, operator: credentials.operator });
    phase = 'sandbox';
    const immutable = [join(session, 'private'), join(session, 'build'), join(session, 'run/identity.json'), taConfig, ...databases.readOnlyPaths];
    const sandbox = await interruptible(() => ops.boundary({ session, round, ports: record.ports, immutable, env, signal: cancellation.signal }));
    await checkInputs(); cancellation.signal.throwIfAborted();
    if (checkRequest()) { cancel(); cancellation.signal.throwIfAborted(); }
    const childEnv = { ...env, BANK_RUNTIME_TA_CONFIG: taConfig, BANK_RUNTIME_TA_CONFIG_SHA256: capture(taConfig).sha256 };
    phase = 'server-start';
    child = ops.launch({ admitted, launcher, session, env: childEnv, sandbox, identity: instanceValue(record) });
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 1);
    birth = await ops.processIdentity(child.pid);
    assert.equal(birth?.uid, process.getuid()); assert.equal(birth.ppid, process.pid); assert.equal(birth.pgid, child.pid);
    save(join(session, 'starting-process.json'), { owner: record.owner, identity: record.identity,
      process: lifetime(birth), classpathSha256: record.classpathSha256 });
    // sandbox-exec execs java in the same PID. Pin its lifetime immediately, then
    // capture the final executable name after the source-bound JVM marker.
    const marker = await waitMarker(join(session, 'run/ready.json'), child, cancellation.signal);
    verifyMarker(marker, record, child.pid); assert.equal(marker.origin, record.origin); assert.equal(marker.bound, true);
    const runningBirth = await ops.processIdentity(child.pid);
    same(lifetime(runningBirth), lifetime(birth), 'PID changed during startup'); birth = runningBirth;
    save(join(session, 'process.json'), { owner: record.owner, identity: record.identity, process: birth, classpathSha256: record.classpathSha256 });
    phase = 'readiness'; await ops.listener(child.pid, record.ports.http);
    await interruptible(() => ops.http({ origin: record.origin, credentials, signal: cancellation.signal, exited: child.exited }));
    await checkInputs(); cancellation.signal.throwIfAborted();
    const state = { schemaVersion: SCHEMA, status: 'ready', owner: record.owner, session, identity: record.identity, executionKind,
      pid: child.pid, url: record.origin + '/bank/v1', loginFile: record.loginFile, readyAt: now(),
      launcherPreviouslyServiceTested: false, fullPipelinePassed: false,
      message: 'Foreground session. Ctrl+C or stop --session ends only this owner; data is retained. Private login file, never share its contents.' };
    save(join(session, 'ready.json'), state); ready = true; ops.ready(state);
    phase = 'foreground';
    let nextCheck = Date.now() + 60_000;
    while (!cancellation.signal.aborted) {
      if (checkRequest()) { cancel(); break; }
      assert.equal(existsSync(join(session, 'run/failure.json')), false, 'JVM failure marker present');
      assert.equal(child.exited(), false, 'session JVM exited unexpectedly');
      held.assertHeld();
      if (Date.now() >= nextCheck) { await checkInputs(); nextCheck = Date.now() + 60_000; }
      await delay(250);
    }
  } catch (error) {
    collectJvmFailure();
    if (error !== cancelled || !stoppedByUser) failure ??= { code: 'SESSION_BLOCKED', phase,
      message: 'Session prerequisite, identity or lifecycle gate failed. No old service substituted. Retain this session; use a new owner after resolving the recorded phase.' };
  } finally {
    clearInterval(requestMonitor);
    // Recheck BEFORE invoking closure helpers as well as after closure. Static
    // imports ensure a long-lived session never loads replacement shutdown code.
    let supportUnchanged = false;
    try { same(snapshots(SUPPORT), loadedSupport); same((seal ?? baseSeal)?.support ?? loadedSupport, loadedSupport); supportUnchanged = true; }
    catch { failure ??= { code: 'SESSION_INPUTS_CHANGED', phase: 'close-seal', message: 'Session helper inputs changed. Close only owned resources and retain the evidence.' }; }
    // Always attempt closure, even after source drift or readiness failure. Only
    // this controller owns the in-memory database handle and direct child.
    try {
      if (child && record) {
        try { save(join(session, 'run/stop.json'), instanceValue(record)); }
        catch { same(read(join(session, 'run/stop.json')), instanceValue(record)); }
        processReceipt = await child.stop(birth);
        collectJvmFailure();
        checks.serverClosed = processReceipt.clean === true;
        if (checks.serverClosed) {
          const marker = read(join(session, 'run/closed.json')); verifyMarker(marker, record, child.pid); assert.equal(marker.closed, true);
          assert.ok(supportUnchanged, 'shutdown helper seal changed');
          same(snapshots(SUPPORT), loadedSupport, 'shutdown helper changed before use');
          if (marker.applicationLoadStarted === false) {
            // A validated stop before Loader entry has no TA child to reap. Never
            // infer this from a missing transcript after a partial Loader failure.
            assert.equal(ready, false); assert.equal(existsSync(join(session, 'run/ready.json')), false);
            same(readdirSync(join(record.round, 'service')), ['logs']);
            same(readdirSync(join(record.round, 'service/logs')), []);
          } else {
            const worker = overrides.worker ?? checkRuntimeWorker;
            await worker({ root: join(record.round, 'service'), transcript: join(record.round, 'service/logs/worker.jsonl'), round: record.round,
              configSha256: capture(join(record.round, 'runtime-ta.json')).sha256, fixtureSha256: capture(FIXTURE).sha256 });
          }
          checks.workerClosed = true;
        }
        assert.ok(checks.serverClosed && checks.workerClosed);
      }
    } catch { failure ??= { code: 'SESSION_CLOSE_FAILED', phase: 'server-close', message: 'JVM or TA closure was not verified. Retain the owner lease and data; do not stop unrelated processes.' }; }
    try {
      if (databases) { databaseReceipt = await databases.stop(); assert.equal(databaseReceipt.stopped, true); }
    } catch { failure ??= { code: 'SESSION_DATABASE_CLOSE_FAILED', phase: 'database-close', message: 'Owned database closure was not verified. Retain the owner lease and data.' }; }
    checks.resourcesExited = (!child || processReceipt?.exited === true && checks.workerClosed) && (!databases || databaseReceipt?.stopped === true);
    try {
      if (recheckBuild) await recheckBuild();
      if (seal) ops.seal(seal, session);
      else if (baseSeal) checkBaseSeal(baseSeal);
      same(snapshots(SUPPORT), loadedSupport);
      checks.inputsUnchanged = supportUnchanged;
    } catch { failure ??= { code: 'SESSION_INPUTS_CHANGED', phase: 'close-seal', message: 'Session inputs changed; no current-input success can be claimed. Retain this session evidence.' }; }
    try { if (held && checks.resourcesExited) { held.release(held.spec.owner); released = true; } }
    catch { failure ??= { code: 'SESSION_LEASE_CHANGED', phase: 'lease-release', message: 'The owner lease could not be released safely. Retain its records; no takeover was attempted.' }; }
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
  }
  const orderly = stoppedByUser && !failure && (!child || checks.serverClosed) && checks.inputsUnchanged && checks.resourcesExited && (!held || released);
  const clean = ready && orderly;
  const result = { schemaVersion: SCHEMA, status: orderly ? (ready ? 'closed' : 'cancelled') : 'blocked', passed: clean && executionKind === 'real', exitCode: orderly ? 0 : 2,
    executionKind, session, owner: record?.owner ?? held?.spec.owner ?? null, identity: record?.identity ?? null,
    ...(record && existsSync(record.loginFile) ? { url: record.origin + '/bank/v1', loginFile: record.loginFile } : {}),
    closedAt: now(), ready, stoppedByUser, failure, checks, process: processReceipt ?? null,
    databasesStopped: databaseReceipt?.stopped ?? !databases, leaseReleased: released, dataPreserved: true,
    fullPipelinePassed: false, launcherPreviouslyServiceTested: false };
  if (created) save(join(session, 'closed.json'), result);
  return result;
}

// status/stop never read login/config or previous process args/env. They validate
// this private owner record, source/classpath seal and the recorded PID births.
// An orphan requires owner investigation, not takeover or port-based cleanup.
function sessionRecord(session) {
  const file = join(session, existsSync(join(session, 'session.json')) ? 'session.json' : 'preparing.json');
  privateOwned(file); return read(file);
}
export async function sessionStatus({ session }, { root = ROOT, processIdentity = sessionProcessIdentity, seal: verifySeal = checkSeal } = {}) {
  checkSessionPath(session, root); privateOwned(session, true);
  const record = sessionRecord(session);
  assert.equal(record.schemaVersion, SCHEMA); assert.equal(record.session, session);
  assert.equal(session, join(root, 'target/truthsrc-runtime-' + record.owner));
  assert.equal(record.round, join(root, '.local/mock-ta', basename(session)));
  same(privateOwned(session, true), record.directoryIdentity);
  assert.match(record.identity, /^[0-9a-f]{48}$/);
  assert.equal(record.controller.uid, process.getuid());
  same(Object.keys(record.ports).sort(), ['http', 'mongo', 'mysql']);
  assert.equal(new Set(Object.values(record.ports)).size, 3);
  for (const port of Object.values(record.ports)) assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535 && ![9000, 2551, 3306, 27017].includes(port));
  assert.equal(record.origin, 'http://127.0.0.1:' + record.ports.http);
  assert.equal(record.loginFile, join(session, 'private/login.json'));
  const closed = join(session, 'closed.json');
  verifySessionLease(record, root, !existsSync(closed));
  if (record.sealSha256) {
    assert.equal(capture(join(session, 'seal.json')).sha256, record.sealSha256);
    const seal = read(join(session, 'seal.json')); verifySeal(seal, session);
    assert.equal(hash([...seal.classpath, seal.launcher.classes].join(':')), record.classpathSha256);
    assert.equal(hash(JSON.stringify(seal.launcher)), record.launcherSha256);
  } else {
    assert.equal(capture(join(session, 'preparing-seal.json')).sha256, record.preparingSealSha256);
    checkBaseSeal(read(join(session, 'preparing-seal.json')));
  }
  if (existsSync(closed)) {
    const result = read(closed); same([result.owner, result.identity, result.session], [record.owner, record.identity, session]);
    assert.equal(result.schemaVersion, SCHEMA); return result;
  }
  same(await processIdentity(record.controller.pid), record.controller, 'owner controller missing/replaced; no automatic takeover');
  const processFile = join(session, 'process.json');
  if (existsSync(join(session, 'ready.json'))) assert.ok(existsSync(processFile), 'ready session missing process identity');
  if (existsSync(processFile)) {
    const child = read(processFile);
    same([child.owner, child.identity, child.classpathSha256], [record.owner, record.identity, record.classpathSha256]);
    assert.equal(child.process.ppid, record.controller.pid); assert.equal(child.process.uid, record.controller.uid);
    assert.equal(child.process.pgid, child.process.pid);
    same(await processIdentity(child.process.pid), child.process, 'recorded JVM missing/replaced');
    verifyMarker(read(join(session, 'run/ready.json')), record, child.process.pid);
  } else if (existsSync(join(session, 'starting-process.json'))) {
    const child = read(join(session, 'starting-process.json'));
    same([child.owner, child.identity, child.classpathSha256], [record.owner, record.identity, record.classpathSha256]);
    assert.equal(child.process.ppid, record.controller.pid); assert.equal(child.process.uid, record.controller.uid);
    assert.equal(child.process.pgid, child.process.pid);
    same(lifetime(await processIdentity(child.process.pid)), child.process, 'starting JVM missing/replaced');
  }
  return { schemaVersion: SCHEMA, status: existsSync(join(session, 'stop-request.json')) ? 'stopping' : existsSync(join(session, 'ready.json')) ? 'ready' : 'starting',
    session, owner: record.owner, identity: record.identity, executionKind: record.executionKind, exitCode: 0,
    url: record.origin + '/bank/v1', loginFile: record.loginFile, fullPipelinePassed: false, dataPreserved: true };
}

export async function sessionStop({ session }, dependencies = {}) {
  const status = await sessionStatus({ session }, dependencies);
  if (['closed', 'cancelled', 'blocked'].includes(status.status)) return status;
  const record = sessionRecord(session), request = requestValue(record), file = join(session, 'stop-request.json');
  // No signal is sent by this command. A replacement between the status check and
  // this write can at worst leave a retained request, never kill an unrelated PID.
  try { save(file, request); } catch (error) { if (error.code !== 'EEXIST') throw error; privateOwned(file); same(read(file), request); }
  const until = Date.now() + 180_000;
  while (!existsSync(join(session, 'closed.json')) && Date.now() < until) await delay(250);
  if (!existsSync(join(session, 'closed.json'))) return { ...status, status: 'stopping', exitCode: 2,
    message: 'Closure deadline exceeded. Data and lease remain; no takeover or force kill was attempted.' };
  return sessionStatus({ session }, dependencies);
}

export async function sessionCli(command, args) {
  if (args.length === 1 && args[0] === '--help') return { schemaVersion: SCHEMA, help: SESSION_HELP, exitCode: 0 };
  const options = sessionArgs(command, args);
  if (command === 'status') return sessionStatus(options);
  if (command === 'stop') return sessionStop(options);
  const acceptedReceipt = await acceptedWorkshopRun(options.acceptedRun);
  return sessionStart({ ...options, buildEvidence: acceptedReceipt.buildEvidence, acceptedReceipt });
}
