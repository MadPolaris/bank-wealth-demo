import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { admitRuntimeBuild } from './truthsrc-runtime-admission.mjs';
import { acquireRuntimeLease, assertRuntimePortFree as freePort } from './truthsrc-runtime-lease.mjs';
import { fileDigest, inventory, isMainModule, safePath, snapshotFiles } from './verify-truthsrc-build.mjs';
import { runtimeSandboxText, runtimeProbeSource, validateRuntimeSandboxPaths, RUNTIME_NETWORK_SCOPE, RUNTIME_NETWORK_LIMITATION } from './truthsrc-runtime-sandbox.mjs';
import { processEvidencePaths, runRuntimeProcess } from './truthsrc-runtime-process.mjs';
import { CRASH_CASES, runRuntimeCrashCases } from './truthsrc-runtime-crash.mjs';
import { checkRuntimeWorker } from './truthsrc-worker-evidence.mjs';
import { OwnedRuntimeDatabases } from './truthsrc-runtime-databases.mjs';
import { issueRuntimeCredentials, productionConfiguration } from './truthsrc-runtime-config.mjs';
import { exerciseProductionHttp, exerciseTransportAuth } from './truthsrc-runtime-http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test/fixtures/truthsrc-actor-ta.json');
const WORKER = join(ROOT, 'tools/truthsrc-runtime-ta-worker.mjs');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const write = (file, text) => writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
const json = file => parseStrictJson(readFileSync(file));
const usage = 'Usage: node tools/verify-truthsrc-runtime.mjs --lease <absolute-json> --build-evidence <absolute> --evidence <lease.runRoot> --round <owner-TA-root> --window crash|database|all [--browser-module <absolute> --browser-executable <absolute>]';

export function runtimeArgs(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    assert.ok(['--lease', '--build-evidence', '--evidence', '--round', '--window', '--browser-module', '--browser-executable'].includes(flag) &&
      !values.has(flag) && args[i + 1] && !args[i + 1].startsWith('--'), usage);
    values.set(flag, args[i + 1]);
  }
  for (const flag of ['--lease', '--build-evidence', '--evidence', '--round', '--window']) assert.ok(values.has(flag), usage);
  assert.ok(['crash', 'database', 'all'].includes(values.get('--window')), usage);
  assert.equal(values.has('--browser-module'), values.has('--browser-executable'), usage);
  return { lease: values.get('--lease'), buildEvidence: values.get('--build-evidence'), evidence: values.get('--evidence'), round: values.get('--round'),
    window: values.get('--window'), browserModule: values.get('--browser-module') ?? null, browserExecutable: values.get('--browser-executable') ?? null };
}

async function verifyListener(pid, port) {
  const { spawn } = await import('node:child_process');
  const child = spawn('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP:' + port, '-sTCP:LISTEN', '-Fpn'],
    { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const code = await new Promise((yes, no) => { child.once('error', no); child.once('close', yes); }).finally(() => clearTimeout(timer));
  assert.equal(code, 0); assert.equal(stderr, '');
  assert.deepEqual(stdout.trim().split('\n').filter(line => line.startsWith('n')), ['n127.0.0.1:' + port], 'actual listener is not exact IPv4 loopback');
  assert.ok(stdout.split('\n').includes('p' + pid));
  return { pid, host: '127.0.0.1', port, verified: true };
}

function baseEnvironment(evidence, javaHome) {
  for (const name of ['home', 'tmp']) mkdirSync(join(evidence, name), { mode: 0o700 });
  return { HOME: join(evidence, 'home'), TMPDIR: join(evidence, 'tmp'), JAVA_HOME: javaHome,
    PATH: join(javaHome, 'bin') + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', NODE_V8_COVERAGE: '' };
}

async function boundary({ root, writeRoot, round, httpPort, immutable, readOnlyRoots = [], protectedEvidence = [], env, network = false, databases = [], processRunner = runRuntimeProcess }) {
  mkdirSync(root, { mode: 0o700 });
  const profile = join(root, 'runtime-sandbox.sb'), probe = join(root, 'runtime-probe.py');
  const canaryRoot = mkdtempSync(join(ROOT, 'target/truthsrc-runtime-canary-')), canary = join(canaryRoot, 'unchanged');
  write(canary, 'owned immutable outside canary\n');
  const options = { evidence: writeRoot ?? root, taRoot: round, httpPort, databasePorts: databases,
    readOnlyFiles: [...immutable, ...readOnlyRoots, ...protectedEvidence, ...Object.values(processEvidencePaths(join(root, 'probe'))), profile, probe],
    networkScope: network ? RUNTIME_NETWORK_SCOPE : 'deny-all' };
  write(profile, runtimeSandboxText(options));
  write(probe, runtimeProbeSource({ ...options,
    readOnlyFiles: [...immutable, ...readOnlyRoots, profile, probe, ...Object.values(processEvidencePaths(join(root, 'probe')))],
    canary, positiveNetwork: network, probeName: 'runtime-probe-' + basename(root) }));
  validateRuntimeSandboxPaths(options);
  const before = snapshotFiles([profile, probe, canary, ...immutable]);
  const sandbox = { executable: '/usr/bin/sandbox-exec', profile, profileSha256: fileDigest(profile) };
  const receipt = await processRunner({ executable: '/usr/bin/python3', args: ['-I', '-S', probe], cwd: root, env,
    base: join(root, 'probe'), timeoutMs: 30_000, sandbox });
  assert.equal(receipt.passed, true, 'runtime boundary probe failed');
  const stdout = readFileSync(join(root, 'probe.stdout.log'), 'utf8');
  for (const depth of [0, 1, 2]) assert.ok(stdout.includes('TRUTHSRC-RUNTIME-SANDBOX-OK scope=' + options.networkScope + ' depth=' + depth));
  assert.deepEqual(snapshotFiles(Object.keys(before)), before);
  save(join(root, 'boundary.json'), { passed: true, networkScope: options.networkScope, limitation: network ? RUNTIME_NETWORK_LIMITATION : null,
    before, syscallProbe: receipt });
  return { sandbox, options, before, recheck: () => assert.deepEqual(snapshotFiles(Object.keys(before)), before) };
}

const runtimeFiles = [
  'tools/verify-truthsrc-runtime.mjs', 'tools/truthsrc-runtime-admission.mjs', 'tools/truthsrc-runtime-lease.mjs', 'tools/truthsrc-runtime-sandbox.mjs',
  'tools/truthsrc-runtime-process.mjs', 'tools/truthsrc-runtime-crash.mjs', 'tools/truthsrc-worker-evidence.mjs', 'tools/truthsrc-evidence.mjs',
  'tools/truthsrc-runtime-databases.mjs', 'tools/truthsrc-runtime-db-relay.mjs', 'tools/truthsrc-runtime-db-exec.mjs',
  'tools/truthsrc-runtime-config.mjs', 'tools/truthsrc-runtime-http.mjs', 'tools/truthsrc-runtime-browser.mjs',
  'tools/truthsrc-runtime-ta-worker.mjs', 'tools/truthsrc-actor-ta-worker.mjs', 'simulator/mock-ta-core.mjs',
  'simulator/contract.mjs', 'simulator/journal.mjs', 'tools/v1-crash-recovery.mjs', 'tools/v1-release-build-evidence.mjs',
  'tools/v1-browser-funds.mjs', 'tools/v1-browser-check.mjs', 'test/fixtures/truthsrc-actor-ta.json',
  'tools/historical-assets.mjs', 'docs/V1-RETIREMENT-MANIFEST.json',
].map(file => join(ROOT, file)).concat(['strict-json', 'immutable-data', 'verification/files', 'verification/inventory', 'verification/outcome', 'verification/lease', 'verification/callbacks', 'verification/worker-evidence', 'verification/process']
  .map(name => join(ROOT, '../metarch-truthsrc/lib', name + '.mjs')));

async function runDatabaseWindow({ admitted, evidence, round, owner, ports, taConfig, taConfigSha256, fixtureSha256, env, options, recheck, signal, runProcess }) {
  const { http: HTTP, mysql: MYSQL, mongo: MONGO } = ports;
  const root = join(evidence, 'database'); mkdirSync(root, { mode: 0o700 });
  const databases = new OwnedRuntimeDatabases({ evidence: root, owner, mysqlPort: MYSQL, mongoPort: MONGO, signal });
  const credentials = issueRuntimeCredentials(), playSecret = randomBytes(32).toString('hex'), machineToken = randomBytes(32).toString('hex');
  const secrets = [...Object.values(credentials).flatMap(row => [row.token, row.csrf]), playSecret, machineToken, ...databases.credentialsList];
  const namespace = 'truthsrc_' + createHash('sha256').update(evidence).digest('hex').slice(0, 16), replaySchema = namespace + '_replay';
  const serviceRoot = join(round, 'service'); mkdirSync(serviceRoot, { mode: 0o700 });
  const serviceRuns = join(serviceRoot, 'runs'); mkdirSync(serviceRuns, { mode: 0o700 });
  const result = { passed: false, runs: [], browserVerified: false, productionFactory: true, errors: [] };
  let endpoints;
  try {
    endpoints = await databases.start();
    for (const schema of [namespace, replaySchema]) await databases.createSchema(schema);
    await freePort(HTTP);
    for (const mode of ['initial', 'restart', 'refund', 'replay']) {
      signal.throwIfAborted(); await recheck();
      const run = join(serviceRuns, mode); mkdirSync(run, { mode: 0o700 });
      const config = join(run, 'integration.conf'), logback = join(run, 'logback.xml');
      write(logback, '<configuration><appender name="console" class="ch.qos.logback.core.ConsoleAppender"><encoder><pattern>%level %logger - %msg%n</pattern></encoder></appender><root level="WARN"><appender-ref ref="console"/></root></configuration>\n');
      const value = productionConfiguration({ namespace, schema: mode === 'replay' ? replaySchema : namespace,
        httpPort: HTTP, mysqlPort: MYSQL, mongoPort: MONGO, mysqlUser: endpoints.mysql.username, mysqlPassword: endpoints.mysql.password,
        mongoUser: endpoints.mongo.username, mongoPassword: endpoints.mongo.password, credentials, playSecret, machineToken,
        node: admitted.node, worker: WORKER, taRoot: serviceRoot, run, mode });
      write(config, value.text);
      const browserConfig = join(run, 'browser.json');
      save(browserConfig, { synthetic: true, baseURL: value.origin, mode: mode === 'restart' ? 'replay' : mode, credentials });
      const runEvidence = join(root, mode);
      const b = await boundary({ root: runEvidence, writeRoot: evidence, round, httpPort: HTTP, immutable: [config, logback, browserConfig, taConfig],
        readOnlyRoots: databases.readOnlyPaths,
        protectedEvidence: ['server', 'browser'].flatMap(name => Object.values(processEvidencePaths(join(runEvidence, name)))),
        env, network: true, databases: [MYSQL, MONGO], processRunner: runProcess });
      let observation, browser, beforeGet, afterGet, negatives, listener, callbackFailure;
      let runtimePhase = 'server-start';
      const childEnv = { ...env, BANK_RUNTIME_TA_CONFIG: taConfig, BANK_RUNTIME_TA_CONFIG_SHA256: taConfigSha256 };
      const process = await runProcess({ executable: admitted.java, args: ['-Xmx1G', '-XX:ActiveProcessorCount=2', '-XX:-UsePerfData', '-Djava.net.preferIPv4Stack=true',
        '-Duser.home=' + env.HOME, '-Djava.io.tmpdir=' + env.TMPDIR, '-Dconfig.file=' + config, '-Dlogback.configurationFile=' + logback,
        '-cp', admitted.classpath.join(':'), 'example.bankwealth.service.BankProductionHttpMain', run, config],
        cwd: admitted.actualRoot, env: childEnv, base: join(runEvidence, 'server'), timeoutMs: 330_000, sandbox: b.sandbox, secrets, signal,
        onStarted: async child => {
          try {
          runtimePhase = 'server-ready-marker';
          await child.waitForFile(join(run, 'server.json'), 90_000);
          const server = json(join(run, 'server.json'));
          assert.equal(server.pid, child.pid); assert.equal(server.origin, value.origin);
          runtimePhase = 'listener-verification';
          listener = await verifyListener(child.pid, HTTP);
          runtimePhase = 'readside-ready';
          const deadline = Date.now() + 90_000;
          for (;;) {
            child.signal.throwIfAborted();
            try {
              const response = await fetch(value.origin + '/api/v1/accounts/me', { headers: { Authorization: 'Bearer ' + credentials.customer.token },
                redirect: 'error', signal: AbortSignal.timeout(5000) });
              const view = await response.json();
              if (response.status === 200 && view.metadata?.disposition === 'caught-up' && view.account) break;
            } catch { /* startup may precede read-side readiness */ }
            assert.ok(Date.now() < deadline && !child.exited(), 'production readiness deadline'); await delay(300);
          }
          if (mode === 'initial') {
            runtimePhase = 'mongo-before-auth';
            const before = await databases.mongoSnapshot(namespace);
            runtimePhase = 'transport-auth';
            negatives = await exerciseTransportAuth({ origin: value.origin, credentials });
            runtimePhase = 'mongo-after-auth';
            assert.deepEqual(await databases.mongoSnapshot(namespace), before, 'rejected transport requests changed bank journal');
            negatives.journalEventsVerified = true;
          }
          runtimePhase = 'business-observation';
          if (['restart', 'replay'].includes(mode)) beforeGet = await databases.mongoSnapshot(namespace);
          if (options.browserModule && ['initial', 'refund', 'replay'].includes(mode)) {
            const browserProcess = await runProcess({ executable: admitted.node,
              args: [join(ROOT, 'tools/truthsrc-runtime-browser.mjs'), browserConfig, options.browserModule, options.browserExecutable],
              cwd: admitted.actualRoot, env, base: join(runEvidence, 'browser'), timeoutMs: 200_000, sandbox: b.sandbox, secrets, signal: child.signal });
            assert.equal(browserProcess.passed, true, 'browser process failed');
            browser = json(join(runEvidence, 'browser.stdout.log'));
            assert.equal(browser.completed, true); assert.equal(browser.mode, mode);
            observation = await exerciseProductionHttp({ origin: value.origin, credentials, mode: mode === 'initial' ? 'restart' : 'replay' });
          } else observation = await exerciseProductionHttp({ origin: value.origin, credentials, mode });
          if (beforeGet) { afterGet = await databases.mongoSnapshot(namespace); assert.deepEqual(afterGet, beforeGet, 'GET-only replay changed the Mongo journal'); }
          runtimePhase = 'graceful-stop';
          write(join(run, 'stop'), 'stop\n');
          } catch (error) {
            callbackFailure = { phase: runtimePhase, name: error.name,
              detail: error.report ?? (secrets.some(secret => error.message?.includes(secret)) ? '[redacted]' : error.message) };
            save(join(runEvidence, 'callback-failure.json'), callbackFailure);
            try { write(join(run, 'stop'), 'stop\n'); } catch { /* original failure remains primary */ }
            throw error;
          }
        } });
      assert.equal(process.passed, true, 'production JVM failed: ' + mode + (callbackFailure ? ' at ' + callbackFailure.phase : ''));
      assert.equal(json(join(run, 'closed.json')).closed, true);
      const worker = await checkRuntimeWorker({ root: serviceRoot, transcript: join(run, 'worker.jsonl'), round,
        configSha256: taConfigSha256, fixtureSha256 });
      b.recheck(); databases.assertControlsUnchanged(); await recheck();
      const record = { mode, process, listener, observation, worker, browser: browser ?? null, transport: negatives ?? null,
        getJournalUnchanged: beforeGet ? true : null, mongoBeforeGet: beforeGet ?? null, mongoAfterGet: afterGet ?? null };
      save(join(runEvidence, 'result.json'), record); result.runs.push(record);
    }
    const [initial, restart, refund, replayed] = result.runs.map(row => row.observation);
    assert.deepEqual(initial.orders.cash, restart.orders.cash); assert.deepEqual(initial.orders.cash, replayed.orders.cash);
    assert.deepEqual(refund.orders.refund, replayed.orders.refund);
    assert.deepEqual(initial.plan, replayed.plan); assert.deepEqual(initial.occurrences, replayed.occurrences);
    assert.deepEqual(initial.accounts, replayed.accounts);
    const neg = join(root, 'mysql-negative'); mkdirSync(neg, { mode: 0o700 });
    const negativePolicy = join(neg, 'sandbox.sb'), negativeLogback = join(neg, 'logback.xml');
    write(negativeLogback, '<configuration><appender name="console" class="ch.qos.logback.core.ConsoleAppender"><encoder><pattern>%level %logger - %msg%n</pattern></encoder></appender><root level="WARN"><appender-ref ref="console"/></root></configuration>\n');
    const policy = { evidence, taRoot: round, readOnlyFiles: [...databases.readOnlyPaths, negativePolicy, negativeLogback,
      ...Object.values(processEvidencePaths(join(neg, 'process')))],
      httpPort: HTTP, databasePorts: [MYSQL], networkScope: RUNTIME_NETWORK_SCOPE };
    write(negativePolicy, runtimeSandboxText(policy));
    const negative = await runProcess({ executable: admitted.java, args: ['-Xmx1G', '-XX:ActiveProcessorCount=2', '-XX:-UsePerfData', '-Djava.net.preferIPv4Stack=true',
      '-Duser.home=' + env.HOME, '-Djava.io.tmpdir=' + env.TMPDIR, '-Dlogback.configurationFile=' + negativeLogback, '-cp', admitted.classpath.join(':'),
      'example.bankwealth.service.BankMysqlNegativeMain', neg, 'jdbc:mysql://127.0.0.1:' + MYSQL, endpoints.mysql.rootPasswordFile],
      cwd: admitted.actualRoot, env, base: join(neg, 'process'), timeoutMs: 180_000,
      sandbox: { executable: '/usr/bin/sandbox-exec', profile: negativePolicy, profileSha256: fileDigest(negativePolicy) }, secrets, signal });
    assert.equal(negative.passed, true, 'MySQL negative runtime failed');
    const checked = json(join(neg, 'result.json'));
    assert.equal(checked.scenarios.length, 5); assert.ok(checked.scenarios.every(row => row.status === 'passed'));
    result.mysqlNegative = checked;
    result.browserVerified = !!options.browserModule;
    result.passed = true;
  } catch (error) { result.errors.push(error.report ?? { message: 'database/runtime window failed', detail: secrets.some(secret => error.message?.includes(secret)) ? '[redacted]' : error.message }); }
  finally {
    result.cleanup = await databases.stop();
    if (!result.cleanup.stopped) { result.passed = false; result.errors.push({ message: 'owned database stop not verified' }); }
    save(join(root, 'result.json'), result);
  }
  return result;
}

// Dependency seams exercise controller ordering/cleanup with Node doubles only;
// the CLI never accepts an alternate admission, lease manager or process runner.
export async function verifyRuntime(options, { admitBuild = admitRuntimeBuild, acquireLease = acquireRuntimeLease,
  runCrash = runRuntimeCrashCases, runDatabase = runDatabaseWindow, checkBoundary = boundary, processRunner = runRuntimeProcess,
  checkPort = freePort } = {}) {
  options = Object.freeze({ ...options });
  assert.ok(options.lease, '--lease is required; the historical reservation has been returned');
  assert.ok(['crash', 'database', 'all'].includes(options.window), usage);
  const { evidence, round } = options;
  const cancelled = new AbortController();
  const onInt = () => cancelled.abort('SIGINT'), onTerm = () => cancelled.abort('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const result = { schemaVersion: 'bank.truthsrc-runtime/v1', status: 'blocked', owner: null, buildEvidence: options.buildEvidence,
    evidence, round, window: options.window, checks: {}, errors: [], runtimeRebuilt: false, runtimePublished: false,
    release1134Resigned: false, runtimeRetryBackoffDeadline: 'OPEN' };
  let lease, admitted, evidenceCreated = false, before, config, env, browserInputs, databaseDispatched = false, processesStopped = true;
  let activeProcesses = 0;
  const runProcess = async args => {
    activeProcesses++;
    try {
      const receipt = await processRunner({ ...args, signal: args.signal ?? cancelled.signal });
      if (receipt.groupAliveAfter !== false || receipt.directChildClosed !== true || receipt.directChildReaped !== true || receipt.barrier?.settled !== true)
        processesStopped = false;
      return receipt;
    } catch (error) { processesStopped = false; throw error; }
    finally { activeProcesses--; }
  };
  try {
    // No old reservation lookup and no candidate admission/launch before an
    // explicit new lease has passed file exclusivity and actual port preflight.
    lease = await acquireLease(options);
    const { owner, ports } = lease.spec;
    result.owner = owner; result.lease = lease.record;
    cancelled.signal.throwIfAborted(); lease.assertHeld();
    admitted = await admitBuild(options.buildEvidence);
    cancelled.signal.throwIfAborted(); lease.assertHeld();
    safePath(evidence, 'new'); safePath(round, 'new');
    mkdirSync(evidence, { mode: 0o700 }); evidenceCreated = true;
    mkdirSync(round, { mode: 0o700 });
    if (options.browserModule) {
      safePath(options.browserModule, 'file'); assert.equal(realpathSync(options.browserExecutable), options.browserExecutable);
      assert.equal(basename(options.browserExecutable), 'chrome-headless-shell', 'explicit headless-shell distribution required; application bundles need separate closure admission');
      const roots = [...new Set([dirname(options.browserModule), join(dirname(dirname(options.browserModule)), 'playwright-core'), dirname(options.browserExecutable)])];
      browserInputs = Object.fromEntries(roots.map(root => [root, inventory(root)]));
    }
    env = baseEnvironment(evidence, admitted.javaHome);
    config = join(round, 'runtime-ta.json');
    const fixtureSha256 = fileDigest(FIXTURE);
    save(config, { schemaVersion: 'bank.truthsrc-runtime-ta/v1', ownedRoot: round, fixture: { file: FIXTURE, sha256: fixtureSha256 } });
    before = snapshotFiles([...runtimeFiles, options.lease, config, ...(options.browserModule ? [options.browserModule, options.browserExecutable] : [])]);
    save(join(evidence, 'inputs.json'), { owner, build: admitted.before, runtime: before, browserInputs: browserInputs ?? null, options,
      lease: lease.record, networkScope: options.window === 'crash' ? 'deny-all' : RUNTIME_NETWORK_SCOPE, networkLimitation: RUNTIME_NETWORK_LIMITATION });
    const recheck = async () => {
      cancelled.signal.throwIfAborted(); lease.assertHeld();
      assert.deepEqual(snapshotFiles(Object.keys(before)), before, 'runtime inputs changed');
      if (browserInputs) for (const [root, expected] of Object.entries(browserInputs)) assert.deepEqual(inventory(root), expected, 'browser input changed');
      await admitted.assertUnchanged();
    };
    const context = { admitted, evidence, round, owner, ports, node: admitted.node, worker: WORKER, taConfig: config,
      taConfigSha256: fileDigest(config), fixtureSha256, env, recheck, options, signal: cancelled.signal, runProcess };
    if (options.window !== 'database') {
      await recheck();
      const b = await checkBoundary({ root: join(evidence, 'crash-boundary'), writeRoot: evidence, round, httpPort: ports.http,
        immutable: [config], protectedEvidence: CRASH_CASES.flatMap(caseName => ['crash', 'recover', 'verify']
          .flatMap(mode => Object.values(processEvidencePaths(join(round, 'case-' + caseName, 'runs', mode, 'process'))))),
        env, processRunner: runProcess });
      context.sandbox = b.sandbox;
      result.crash = await runCrash(context); b.recheck();
      result.checks.crashPassed = result.crash.passed;
      assert.equal(result.crash.passed, true, 'crash runtime window failed');
    }
    if (options.window !== 'crash') {
      await recheck();
      // Repeat the kernel preflight immediately before database creation. A
      // foreign binder after this point is rejected by bind/listener verification.
      for (const port of Object.values(ports)) await checkPort(port);
      await recheck();
      databaseDispatched = true;
      result.database = await runDatabase(context);
      result.checks.databasePassed = result.database.passed;
      if (!result.database.passed) result.errors.push('database runtime window failed');
    }
    await recheck(); result.checks.sourceBound = true;
  } catch (error) { result.errors.push(error.message ?? 'runtime verification failed'); }
  finally {
    try {
      try {
        if (before) assert.deepEqual(snapshotFiles(Object.keys(before)), before);
        if (browserInputs) for (const [root, expected] of Object.entries(browserInputs)) assert.deepEqual(inventory(root), expected);
        if (admitted) { await admitted.assertUnchanged(); result.checks.inputsUnchanged = true; }
        if (lease) lease.assertHeld();
      } catch { result.checks.inputsUnchanged = false; result.errors.push('final runtime input/lease verification failed'); }
      await new Promise(done => setImmediate(done)); await delay(0);
      result.cancelled = cancelled.signal.aborted;
      if (lease) {
        try {
          assert.ok(processesStopped && activeProcesses === 0 && (!databaseDispatched || result.database?.cleanup?.stopped === true),
            'resource exit unverified; lease retained for acquiring owner investigation');
          result.leaseRelease = lease.release(result.owner);
        } catch (error) { result.leaseRelease = { owner: result.owner, released: false }; result.errors.push(error.message); }
      }
      result.status = result.errors.length === 0 && !result.cancelled && result.checks.sourceBound && result.checks.inputsUnchanged &&
        result.leaseRelease?.released === true ? 'passed' : 'blocked';
      if (evidenceCreated) save(join(evidence, 'result.json'), result);
    } finally {
      process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    }
  }
  console.log(JSON.stringify({ status: result.status, evidence, owner: result.owner, leaseReleased: result.leaseRelease?.released ?? false,
    crashCases: result.crash?.count ?? 0, databasePassed: result.database?.passed ?? false, browserVerified: result.database?.browserVerified ?? false,
    errors: evidenceCreated ? undefined : result.errors }));
  return result;
}

if (isMainModule(process.argv[1], import.meta.url)) {
  try {
    const options = runtimeArgs(process.argv.slice(2));
    if (!options) console.log(usage);
    else if ((await verifyRuntime(options)).status !== 'passed') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
