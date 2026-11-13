import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { sessionArgs, sessionCli, sessionCompilePlan, sessionStart, sessionStatus, sessionStop } from '../tools/bank-workshop-session.mjs';
import { acquireRuntimeLease } from '../tools/truthsrc-runtime-lease.mjs';
import { RUNTIME_MAINS, runtimeClasspathInventory } from '../tools/truthsrc-runtime-tests.mjs';
import { fileDigest, inventory, safePath } from '../tools/verify-truthsrc-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(ROOT, 'tools/scala/BankWorkshopMain.scala');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = file => ({ bytes: readFileSync(file).length, sha256: hash(readFileSync(file)) });
const write = (file, text) => { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, text, { flag: 'wx', mode: 0o600 }); };
const save = (file, value) => write(file, JSON.stringify(value));
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const flags = ['--accepted-run', '/bank/target/full', '--session', '/bank/target/truthsrc-runtime-demo', '--lease', '/bank/lease.json'];

test('explicit session CLI contract; no override, resume, browser download or arbitrary Java options', async () => {
  assert.deepEqual(sessionArgs('start', flags), { acceptedRun: flags[1], session: flags[3], lease: flags[5] });
  assert.deepEqual(sessionArgs('stop', ['--session', '/bank/owned']), { session: '/bank/owned' });
  for (const input of [[], flags.slice(2), flags.slice(0, -1), [...flags, '--lease', '/other'], [...flags, '--java-options', '-javaagent:evil'],
    [...flags, '--resume', 'yes'], [...flags, '--browser', 'auto']]) assert.throws(() => sessionArgs('start', input));
  assert.throws(() => sessionArgs('status', flags));
  assert.throws(() => sessionArgs('restart', ['--session', '/bank/owned']));
  assert.equal((await sessionCli('start', ['--help'])).exitCode, 0);
});

test('compiler is fixed supplied Scala, network denied and writes confined to new build; sealed classpath only read', () => {
  const admitted = { buildEvidence: '/bank/target/build', classpath: ['/bank/target/candidate/classes', '/bank/target/build/supply/runtime.jar'] };
  const plan = sessionCompilePlan({ admitted, session: '/bank/target/truthsrc-runtime-demo', sourceSha256: 'a'.repeat(64) });
  assert.ok(plan.compiler.every(file => file.startsWith(admitted.buildEvidence + '/supply/maven/org/scala-lang/') && file.endsWith('-2.13.14.jar')));
  assert.equal(plan.compiler.length, 3);
  assert.match(plan.profile, /\(deny network\*\)/); assert.match(plan.profile, /\(deny file-write\*\)/);
  assert.equal(plan.profile.includes('/bank/target/candidate'), false);
  assert.ok(plan.args.includes('scala.tools.nsc.Main'));
  assert.equal(plan.args[plan.args.indexOf('-classpath') + 1], admitted.classpath.join(':'));
  assert.equal(plan.args[plan.args.indexOf('-d') + 1], plan.classes);
});

// Everything below is Node-only. Fake class bytes, process identities and owned
// database handles exercise control flow; no JVM/Docker/browser/worker/probe or
// download is dispatched, and no prior config/login/journal is read.
function harness(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'bank-session-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.local/mock-ta'), { recursive: true, mode: 0o700 });
  const owner = 'workshop-test', session = join(root, 'target/truthsrc-runtime-' + owner), buildEvidence = join(root, 'target/full/build');
  const output = join(root, 'target/full/output'), run = join(root, 'target/full');
  const ports = { http: 28761, mysql: 28762, mongo: 28763 };
  const classes = join(output, 'target/scala-2.13/classes'), testClasses = join(output, 'target/scala-2.13/test-classes');
  mkdirSync(classes, { recursive: true }); mkdirSync(buildEvidence, { recursive: true });
  for (const name of RUNTIME_MAINS) write(join(testClasses, name.replaceAll('.', '/') + '$.class'), 'not-jvm-bytecode');
  const classpath = [testClasses, classes];
  save(join(run, 'run.json'), { fixture: true }); save(join(run, 'results.json'), { fixture: true });
  const acceptedReceipt = { run, fullPipelinePassed: true, snapshot: 'fixture-snapshot', codeDigest: 'sha256:' + 'a'.repeat(64),
    buildEvidence, output, previousOwner: 'accepted-old-owner',
    receipts: Object.fromEntries(['run.json', 'results.json'].map(name => [join(run, name), stamp(join(run, name))])) };
  const lease = join(root, 'lease.json');
  save(lease, { schemaVersion: 'bank.truthsrc-runtime-lease/v1', owner, runRoot: session, ports, host: '127.0.0.1' });
  const controller = { pid: process.pid, ppid: 101, pgid: 102, uid: process.getuid(), birth: 'test-controller-birth', executable: '/node' };
  const processRecord = { pid: 7654321, ppid: process.pid, pgid: 7654321, uid: process.getuid(), birth: 'test-jvm-birth', executable: '/fake-java' };
  const calls = [], baselineSignals = ['SIGINT', 'SIGTERM'].map(sig => process.listenerCount(sig));
  let held, instance, readyResolve, launchExited = false, closedChecks = true;
  const ready = new Promise(done => { readyResolve = done; });
  const admitted = { buildEvidence, output, actualRoot: output, javaHome: '/fake-jdk', java: '/fake-jdk/bin/java', node: '/fake-node', classpath,
    before: { classpathInventory: runtimeClasspathInventory(classpath, output, buildEvidence, { safePath, inventory, fileDigest }), toolchain: {} },
    assertUnchanged: async () => { calls.push('build-recheck'); assert.ok(closedChecks, 'fake build drift'); } };
  const ops = {
    root, platform() { calls.push('platform'); },
    accept: async passedRun => { assert.equal(passedRun, run); calls.push('accept'); return acceptedReceipt; },
    admit: async evidence => { assert.equal(evidence, buildEvidence); calls.push('admit'); return admitted; },
    acquire: async options => {
      held = await acquireRuntimeLease(options, { root, probePort: async port => calls.push('probe:' + port) }); calls.push('lease'); return held;
    },
    compile: async () => {
      calls.push('compile'); held.assertHeld();
      const build = join(session, 'build'), compiled = join(build, 'classes'), staged = join(build, 'BankWorkshopMain.scala');
      const file = join(compiled, 'example/bankwealth/workshop/BankWorkshopMain$.class');
      write(file, 'node-fixture-class'); write(staged, readFileSync(source)); save(join(build, 'compile.json'), { fixture: true });
      return { classes: compiled, files: inventory(compiled), source: { file: source, ...stamp(source) }, stagedSource: { file: staged, ...stamp(staged) },
        compiler: {}, compileReceipt: { file: join(build, 'compile.json'), ...stamp(join(build, 'compile.json')) }, compiled: true, previouslyServiceTested: false };
    },
    databases: options => {
      assert.equal(options.owner, owner); assert.equal(options.evidence, join(session, 'databases'));
      return { readOnlyPaths: [],
        async start() { calls.push('db-start'); return { mysql: { username: 'new-mysql-user', password: 'new-mysql-password' },
          mongo: { username: 'new-mongo-user', password: 'new-mongo-password' } }; },
        async createSchema(name) { calls.push('schema'); assert.match(name, /^workshop_[a-f0-9]{24}$/); },
        async stop() { calls.push('db-stop'); return { stopped: true }; } };
    },
    boundary: async options => { calls.push('boundary'); assert.deepEqual(options.ports, ports); return { fixture: true }; },
    launch: options => {
      calls.push('launch'); instance = options.identity;
      assert.equal(options.env.BANK_RUNTIME_TA_CONFIG, join(root, '.local/mock-ta/truthsrc-runtime-' + owner, 'runtime-ta.json'));
      save(join(session, 'run/ready.json'), { ...instance, pid: processRecord.pid, origin: 'http://127.0.0.1:' + ports.http, bound: true });
      return { pid: processRecord.pid, exited: () => { calls.push('jvm-check'); return launchExited; },
        async stop(birth) {
          calls.push('jvm-stop'); if (birth) assert.deepEqual(birth, processRecord);
          assert.equal(readFileSync(join(session, 'run/stop.json.ready')).length, 0);
          assert.deepEqual(json(join(session, 'run/stop.json')), instance);
          save(join(session, 'run/closed.json'), { ...instance, pid: processRecord.pid, closed: true });
          return { pid: processRecord.pid, exited: true, clean: true, directChildClosed: true, directChildReaped: true, groupAliveAfter: false };
        } };
    },
    processIdentity: async pid => pid === process.pid ? controller : pid === processRecord.pid ? processRecord : null,
    listener: async (pid, port) => { calls.push('listener'); assert.equal(pid, processRecord.pid); assert.equal(port, ports.http); },
    http: async options => { calls.push('http-ready'); assert.equal(options.origin, 'http://127.0.0.1:' + ports.http); },
    worker: async () => { calls.push('worker-closed'); },
    ready: value => { calls.push('ready'); readyResolve(value); },
  };
  return { root, owner, session, buildEvidence, acceptedReceipt, lease, calls, ops, ready, admitted, processRecord,
    start: () => sessionStart({ buildEvidence, acceptedReceipt, session, lease }, ops),
    stateDeps: () => ({ root, processIdentity: ops.processIdentity }), held: () => held,
    exit: () => { launchExited = true; }, drift: () => { closedChecks = false; },
    assertReleased() {
      assert.equal(readdirSync(join(root, 'target/truthsrc-runtime-leases')).some(file => file.endsWith('.lock')), false);
      assert.deepEqual(['SIGINT', 'SIGTERM'].map(sig => process.listenerCount(sig)), baselineSignals);
    } };
}

test('foreground start stays pending after ready, safe status/stop closes owned resources without deleting data', async t => {
  const h = harness(t); let settled = false;
  const pending = h.start().then(result => { settled = true; return result; });
  const ready = await h.ready;
  assert.equal(settled, false); assert.equal(ready.executionKind, 'test-double'); assert.equal(ready.fullPipelinePassed, false);
  const state = await sessionStatus({ session: h.session }, h.stateDeps());
  assert.equal(state.status, 'ready'); assert.equal(state.owner, h.owner);
  const stop = sessionStop({ session: h.session }, h.stateDeps());
  const [result, stopped] = await Promise.all([pending, stop]);
  assert.equal(result.status, 'closed'); assert.equal(result.passed, false, 'Node doubles never certify a real session');
  assert.equal(result.exitCode, 0); assert.equal(stopped.status, 'closed');
  for (const file of ['stop-request.json.ready', 'run/stop.json.ready'])
    assert.equal(readFileSync(join(h.session, file)).length, 0);
  assert.ok(result.checks.workerClosed && result.checks.resourcesExited && result.leaseReleased);
  assert.ok(h.calls.indexOf('compile') < h.calls.indexOf('db-start'));
  assert.ok(h.calls.indexOf('boundary') < h.calls.indexOf('launch'));
  assert.ok(h.calls.indexOf('http-ready') < h.calls.indexOf('ready'));
  assert.ok(h.calls.indexOf('jvm-stop') < h.calls.indexOf('db-stop'));
  assert.ok(existsSync(join(h.session, 'private/login.json')));
  assert.ok(existsSync(join(h.session, 'build/classes/example/bankwealth/workshop/BankWorkshopMain$.class')));
  assert.equal((await sessionStop({ session: h.session }, h.stateDeps())).status, 'closed');
  h.assertReleased();
});

function requestFor(session) {
  const { schemaVersion, owner, identity, controller } = json(join(session, 'session.json'));
  return { schemaVersion, owner, identity, controller };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Node session fixture did not settle within 5s')), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

for (const state of ['half-written', 'complete']) test('unpublished ' + state + ' request waits for its original writer', async t => {
  const h = harness(t), file = join(h.session, 'stop-request.json');
  let clock = Date.now(), writer, complete, initial, settled = false, stopping, stopSettled = false;
  // Only the deadline clock is virtual; polling still uses the ordinary event loop.
  // Cleanup can expire a broken stop waiter without leaving a 180s background task.
  t.mock.method(Date, 'now', () => clock);
  const announceReady = h.ops.ready;
  h.ops.ready = value => {
    complete = JSON.stringify(requestFor(h.session));
    initial = state === 'half-written' ? complete.slice(0, Math.floor(complete.length / 2)) : complete;
    writer = openSync(file, 'wx', 0o600); writeSync(writer, initial);
    announceReady(value);
  };
  const finishData = () => {
    if (writer === undefined) return;
    try { writeSync(writer, complete.slice(initial.length)); }
    finally { closeSync(writer); writer = undefined; }
  };
  const pending = h.start().then(result => { settled = true; return result; });
  try {
    await bounded(h.ready);
    // ready() seeds the file before the controller's first foreground read. The
    // subsequent JVM check proves that read did not parse/fail on unpublished data.
    assert.ok(h.calls.lastIndexOf('jvm-check') > h.calls.indexOf('ready'));
    assert.equal((await sessionStatus({ session: h.session }, h.stateDeps())).status, 'ready');
    const before = stamp(file);
    stopping = sessionStop({ session: h.session }, h.stateDeps())
      .then(value => ({ value }), error => ({ error }))
      .then(outcome => { stopSettled = true; return outcome; });
    // Flush async status validation so stop reaches the existing-writer wait;
    // this is an event-loop barrier, not a guessed sleep or a publication timer.
    await nextTurn();
    assert.equal(settled, false); assert.equal(stopSettled, false);
    assert.deepEqual(stamp(file), before);
    assert.equal(existsSync(file + '.ready'), false);
    assert.equal(existsSync(join(h.session, 'run/stop.json.ready')), false);
    assert.equal(h.calls.includes('jvm-stop'), false);
    assert.equal((await sessionStatus({ session: h.session }, h.stateDeps())).status, 'ready');
    finishData(); write(file + '.ready', '');
    const [result, stopped] = await bounded(Promise.all([pending, stopping]));
    assert.ifError(stopped.error);
    assert.equal(result.status, 'closed'); assert.equal(result.exitCode, 0);
    assert.equal(result.failure, null); assert.equal(result.stoppedByUser, true);
    assert.equal(stopped.value.status, 'closed'); assert.equal(stopped.value.exitCode, 0);
    assert.deepEqual(json(file), requestFor(h.session));
    for (const marker of [file + '.ready', join(h.session, 'run/stop.json.ready')])
      assert.equal(readFileSync(marker).length, 0);
    h.assertReleased();
  } finally {
    finishData();
    if (complete && !existsSync(file + '.ready')) write(file + '.ready', '');
    if (!settled) process.emit('SIGINT');
    clock += 180_001;
    await bounded(Promise.all([pending, stopping]));
  }
});

for (const problem of ['nonempty-marker', 'invalid-json', 'foreign-identity'])
  test('published stop request rejects ' + problem + ' without rewriting or republishing it', async t => {
    const h = harness(t); let settled = false;
    const pending = h.start().then(result => { settled = true; return result; });
    try {
      await bounded(h.ready);
      const file = join(h.session, 'stop-request.json'), request = requestFor(h.session);
      write(file, problem === 'invalid-json' ? '{' : JSON.stringify(problem === 'foreign-identity'
        ? { ...request, identity: request.identity.slice(0, -1) + (request.identity.endsWith('0') ? '1' : '0') } : request));
      write(file + '.ready', problem === 'nonempty-marker' ? 'x' : '');
      const dataBefore = stamp(file), markerBefore = stamp(file + '.ready');
      await assert.rejects(sessionStatus({ session: h.session }, h.stateDeps()));
      await assert.rejects(sessionStop({ session: h.session }, h.stateDeps()));
      assert.deepEqual(stamp(file), dataBefore); assert.deepEqual(stamp(file + '.ready'), markerBefore);
      assert.equal(existsSync(join(h.session, 'run/stop.json')), false);
      assert.equal(existsSync(join(h.session, 'run/stop.json.ready')), false);
      assert.equal(h.calls.includes('jvm-stop'), false);
      // The already-published bad marker is retained, not repaired. The controller
      // independently rejects it and still closes its own fake JVM/databases.
      const result = await bounded(pending);
      assert.equal(result.status, 'blocked'); assert.equal(result.passed, false); assert.ok(result.failure);
      assert.ok(result.checks.resourcesExited && result.leaseReleased);
      assert.deepEqual(stamp(file), dataBefore); assert.deepEqual(stamp(file + '.ready'), markerBefore);
      h.assertReleased();
    } finally {
      if (!settled) process.emit('SIGINT');
      await bounded(pending);
    }
  });

for (const signal of ['SIGINT', 'SIGTERM']) test(signal + ' closes the foreground session gracefully, not the bounded acceptance main', async t => {
  const h = harness(t), pending = h.start(); await h.ready;
  process.emit(signal);
  const result = await pending; assert.equal(result.status, 'closed'); assert.equal(result.stoppedByUser, true); h.assertReleased();
});

test('only private login file receives fresh credentials; output, seal and public receipts contain no secrets', async t => {
  const h = harness(t), pending = h.start(); const ready = await h.ready;
  const login = json(ready.loginFile), config = readFileSync(join(h.session, 'private/session.conf'), 'utf8');
  assert.match(config, /new-mysql-password/); assert.equal(login.private, true);
  const secrets = [...Object.values(login.customer), ...Object.values(login.operator), 'new-mysql-password', 'new-mongo-password'];
  const record = json(join(h.session, 'session.json'));
  assert.equal(record.loginFile, ready.loginFile); assert.equal(record.origin.includes('?'), false);
  for (const file of ['session.json', 'seal.json', 'process.json', 'ready.json']) {
    const text = readFileSync(join(h.session, file), 'utf8');
    for (const secret of secrets) assert.equal(text.includes(secret), false);
  }
  const original = ready.loginFile;
  // Status cannot require reading the login secret; remove its read permission.
  chmodSync(original, 0o000);
  assert.equal((await sessionStatus({ session: h.session }, h.stateDeps())).status, 'ready');
  process.emit('SIGINT'); await pending; chmodSync(original, 0o600); h.assertReleased();
});

for (const problem of ['replaced-jvm', 'replaced-controller', 'foreign-owner', 'changed-classpath', 'foreign-marker', 'changed-lease'])
  test('status/stop reject ' + problem + ' without signalling any recorded process', async t => {
    const h = harness(t), pending = h.start(); await h.ready;
    const sessionFile = join(h.session, 'session.json'), original = readFileSync(sessionFile);
    let restore = () => {};
    if (problem === 'replaced-jvm' || problem === 'replaced-controller') {
      const prior = h.ops.processIdentity;
      h.ops.processIdentity = async pid => { const record = await prior(pid); return pid === (problem === 'replaced-jvm' ? h.processRecord.pid : process.pid) ? { ...record, birth: 'reused-pid' } : record; };
      restore = () => { h.ops.processIdentity = prior; };
    } else if (problem === 'foreign-owner') {
      writeFileSync(sessionFile, JSON.stringify({ ...json(sessionFile), owner: 'someone-else' }));
      restore = () => writeFileSync(sessionFile, original);
    } else if (problem === 'changed-classpath') {
      const file = join(h.session, 'build/classes/example/bankwealth/workshop/BankWorkshopMain$.class'), bytes = readFileSync(file);
      writeFileSync(file, 'changed'); restore = () => writeFileSync(file, bytes);
    } else if (problem === 'foreign-marker') {
      const file = join(h.session, 'run/ready.json'), bytes = readFileSync(file);
      writeFileSync(file, JSON.stringify({ ...json(file), identity: '0'.repeat(48) })); restore = () => writeFileSync(file, bytes);
    } else {
      const bytes = readFileSync(h.lease); writeFileSync(h.lease, '{}'); restore = () => writeFileSync(h.lease, bytes);
    }
    await assert.rejects(sessionStatus({ session: h.session }, h.stateDeps()));
    await assert.rejects(sessionStop({ session: h.session }, h.stateDeps()));
    for (const file of ['stop-request.json', 'stop-request.json.ready', 'run/stop.json', 'run/stop.json.ready'])
      assert.equal(existsSync(join(h.session, file)), false);
    assert.equal(h.calls.includes('jvm-stop'), false);
    restore(); process.emit('SIGINT'); const result = await pending; assert.equal(result.status, 'closed'); h.assertReleased();
  });

for (const phase of ['accept', 'admit', 'compile', 'boundary', 'listener', 'http']) test('failure at ' + phase + ' never becomes an accepted launcher', async t => {
  const h = harness(t);
  h.ops[phase] = async () => { throw new Error('DO-NOT-PRINT-SECRET'); };
  const result = await h.start();
  assert.equal(result.status, 'blocked'); assert.equal(result.passed, false);
  assert.equal(JSON.stringify(result).includes('DO-NOT-PRINT-SECRET'), false);
  if (['accept', 'admit'].includes(phase)) assert.equal(existsSync(h.session), false);
  else { assert.ok(existsSync(join(h.session, 'closed.json'))); h.assertReleased(); }
  assert.equal(h.calls.includes('ready'), false);
});

test('build drift discovered at stop cannot inherit current-input success', async t => {
  const h = harness(t), pending = h.start(); await h.ready; h.drift(); process.emit('SIGINT');
  const result = await pending; assert.equal(result.status, 'blocked'); assert.equal(result.checks.inputsUnchanged, false);
  assert.equal(result.checks.resourcesExited, true); h.assertReleased();
});

test('unverified worker or database shutdown retains the owner lease and all failed data', async t => {
  const h = harness(t); h.ops.worker = async () => { throw new Error('worker closure unknown'); };
  const pending = h.start(); await h.ready; process.emit('SIGINT');
  const result = await pending;
  assert.equal(result.status, 'blocked'); assert.equal(result.leaseReleased, false);
  assert.equal(result.checks.workerClosed, false); assert.equal(result.dataPreserved, true);
  h.held().assertHeld(); h.held().release(h.owner); h.assertReleased();
});

test('unreaped launcher helper retains the owner lease before any foreground server exists', async t => {
  const h = harness(t);
  h.ops.runProcess = async () => ({ passed: false, groupAliveAfter: true, directChildClosed: false,
    directChildReaped: false, barrier: { settled: true } });
  h.ops.compile = async ({ runProcess }) => {
    const receipt = await runProcess({}); assert.equal(receipt.passed, true);
  };
  const result = await h.start();
  assert.equal(result.status, 'blocked'); assert.equal(result.checks.resourcesExited, false);
  assert.equal(result.leaseReleased, false); assert.equal(h.calls.includes('launch'), false);
  h.held().release(h.owner); h.assertReleased();
});

test('no resume and no accepted-run owner reuse', async t => {
  const h = harness(t);
  mkdirSync(h.session, { mode: 0o700 });
  const result = await h.start(); assert.equal(result.status, 'blocked'); assert.equal(h.calls.includes('lease'), false);
  assert.equal(h.calls.includes('compile'), false);
});

test('static Scala main uses real Loader/lifecycle with no acceptance timer; controller always OS-sandboxes JVM', () => {
  const scala = readFileSync(source, 'utf8');
  assert.match(scala, /new BankServiceLoader\(\)\.load\(context\)/);
  assert.match(scala, /address = "127\.0\.0\.1"/);
  assert.match(scala, /while \(!stopRequested\.get\(\)\)/);
  assert.match(scala, /lifecycle\.stop\(\)/); assert.match(scala, /actorSystem\.terminate\(\)/);
  assert.match(scala, /addShutdownHook/); assert.match(scala, /java\.class\.path/);
  const requested = scala.slice(scala.indexOf('def requested(): Boolean = {'), scala.indexOf('val hook = new Thread'));
  assert.match(requested, /val marker = owned\.resolve\("stop\.json\.ready"\)/);
  assert.match(requested, /if \(!Files\.exists\(marker, LinkOption\.NOFOLLOW_LINKS\)\) \{\s+require\(publishedStop\.isEmpty, "published stop marker disappeared"\)\s+false\s+\} else \{/);
  assert.match(requested, /val markerBefore = control\(marker, 0\)[\s\S]*?val dataBefore = control\(data, 16384\)[\s\S]*?val bytes = Files\.readAllBytes\(data\)/);
  assert.match(requested, /Json\.parse\(bytes\)\.as\[JsObject\] == identity/);
  assert.match(requested, /publishedStop\.foreach\(previous => require\(previous == captured, "published stop control changed"\)\)/);
  assert.equal(/240\.seconds|BankProductionHttpMain|Await\.result\([^\n]*Duration\.Inf|\?\?\?/.test(scala), false);
  const node = readFileSync(join(ROOT, 'tools/bank-workshop-session.mjs'), 'utf8');
  assert.match(node, /spawn\(SANDBOX,/); assert.match(node, /stdio: 'ignore'/);
  assert.equal(/spawn\(admitted\.java|pkill|rmSync|unlinkSync|execFile\([^\n]*args=/.test(node), false);
});
