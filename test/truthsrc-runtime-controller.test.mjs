import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeArgs, verifyRuntime } from '../tools/verify-truthsrc-runtime.mjs';
import { acquireRuntimeLease } from '../tools/truthsrc-runtime-lease.mjs';
import { CRASH_CASES } from '../tools/truthsrc-runtime-crash.mjs';
import { RUNTIME_TA_CRASH_CASES } from '../tools/truthsrc-runtime-ta-worker.mjs';

const base = ['--lease', '/owned/lease.json', '--build-evidence', '/owned/build', '--evidence', '/owned/run', '--round', '/owned/ta', '--window', 'crash'];

test('runtime controller needs explicit immutable build, fresh outputs and fixed window', () => {
  assert.equal(runtimeArgs(['--help']), null);
  const options = runtimeArgs(base);
  assert.equal(options.window, 'crash'); assert.equal(options.browserModule, null); assert.equal(options.lease, '/owned/lease.json');
  for (const flags of [[], base.slice(2), [...base, '--lease', '/other.json'], [...base, '--window', 'all'], [...base, '--case', 'arbitrary'], [...base, '--browser-module', '/module'],
    base.slice(0, -1), [...base.slice(0, -1), 'whatever'], [...base, 'Test / test']]) assert.throws(() => runtimeArgs(flags));
  const browser = runtimeArgs([...base, '--browser-module', '/module', '--browser-executable', '/browser']);
  assert.equal(browser.browserExecutable, '/browser');
});

test('runtime TA owner allowlist and frozen recovery oracle cover the same 24 windows', () => {
  assert.equal(CRASH_CASES.length, 24); assert.equal(new Set(CRASH_CASES).size, 24);
  assert.deepEqual(CRASH_CASES, RUNTIME_TA_CRASH_CASES);
});

test('new controller uses current admission, independent boundary and no historical execution entry', () => {
  const file = fileURLToPath(new URL('../tools/verify-truthsrc-runtime.mjs', import.meta.url));
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes('admitBuild = admitRuntimeBuild'));
  assert.ok(source.includes('await admitBuild(options.buildEvidence)'));
  assert.ok(source.includes('acquireLease = acquireRuntimeLease'));
  assert.ok(!/AGENT_COORDINATION|backkend-codegen|18761|18762|18763/.test(source));
  assert.ok(source.includes('runtimeSandboxText(options)'));
  assert.ok(source.includes('await admitted.assertUnchanged()'));
  assert.ok(!source.includes('runBankCrashRecovery('));
  assert.ok(!/rmSync|unlinkSync|pkill|docker.*rm|runBankRelease/.test(source));
  assert.ok(source.includes("runtimeRetryBackoffDeadline: 'OPEN'"));
});

// Only Node fixtures/doubles. No JVM, sandbox-exec, Docker, worker or application
// is invoked, and no historical credentials/configuration are read.
function harness(t, window = 'crash') {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'runtime-controller-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'target/build'), { recursive: true }); mkdirSync(join(root, '.local/mock-ta'), { recursive: true });
  const owner = 'onboarding-test', evidence = join(root, 'target/truthsrc-runtime-' + owner);
  const ports = { http: 28761, mysql: 28762, mongo: 28763 };
  const options = { lease: join(root, 'lease.json'), evidence, round: join(root, '.local/mock-ta/truthsrc-runtime-' + owner),
    buildEvidence: join(root, 'target/build'), window, browserModule: null, browserExecutable: null };
  writeFileSync(options.lease, JSON.stringify({ schemaVersion: 'bank.truthsrc-runtime-lease/v1', owner, host: '127.0.0.1', ports, runRoot: evidence }));
  const calls = [], signals = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  let held;
  const deps = {
    acquireLease: async args => {
      calls.push('lease'); held = await acquireRuntimeLease(args, { root, probePort: async port => calls.push('probe:' + port) }); return held;
    },
    admitBuild: async build => {
      assert.equal(build, options.buildEvidence); held.assertHeld(); calls.push('admit');
      return { javaHome: '/fixture-jdk', node: process.execPath, before: { fixture: true }, assertUnchanged: async () => calls.push('unchanged') };
    },
    checkBoundary: async args => {
      assert.equal(args.httpPort, ports.http); assert.equal(args.round, options.round);
      calls.push('boundary'); return { sandbox: { fixture: true }, recheck: () => calls.push('boundary-recheck') };
    },
    runCrash: async context => {
      held.assertHeld(); assert.equal(context.owner, owner); assert.deepEqual(context.ports, ports);
      await context.recheck(); calls.push('crash'); return { passed: true, count: 24, fixture: true };
    },
    runDatabase: async context => {
      held.assertHeld(); assert.equal(context.owner, owner); assert.deepEqual(context.ports, ports);
      await context.recheck(); calls.push('database'); return { passed: true, cleanup: { stopped: true }, fixture: true };
    },
    processRunner: async () => { throw new Error('Node contract must not launch a real process'); },
    checkPort: async port => calls.push('pre-database:' + port),
  };
  const registry = join(root, 'target/truthsrc-runtime-leases');
  return { root, owner, ports, options, deps, calls, held: () => held,
    assertReleased() {
      assert.deepEqual(readdirSync(registry).filter(name => name.endsWith('.lock')), []);
      assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], signals);
    },
  };
}

for (const window of ['crash', 'database', 'all']) test('controller binds lease owner/ports and releases after mocked ' + window + ' window', async t => {
  const h = harness(t, window), result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'passed'); assert.equal(result.owner, h.owner); assert.equal(result.leaseRelease.released, true);
  assert.ok(h.calls.indexOf('probe:28763') < h.calls.indexOf('admit'));
  assert.equal(h.calls.includes('crash'), window !== 'database'); assert.equal(h.calls.includes('database'), window !== 'crash');
  assert.equal(h.calls.includes('pre-database:28763'), window !== 'crash');
  const inputs = JSON.parse(readFileSync(join(h.options.evidence, 'inputs.json')));
  assert.equal(inputs.lease.owner, h.owner); assert.deepEqual(inputs.lease.ports, h.ports);
  assert.equal(inputs.networkScope, window === 'crash' ? 'deny-all' : 'host-local-reserved-ports');
  assert.equal(Object.hasOwn(inputs, 'reservation'), false);
  assert.equal(existsSync(join(h.options.round, 'runtime-ta.json')), true);
  h.assertReleased();
});

test('missing lease rejects before admission, data creation or process dispatch', async t => {
  const h = harness(t);
  await assert.rejects(verifyRuntime({ ...h.options, lease: undefined }, h.deps), /historical reservation has been returned/);
  assert.deepEqual(h.calls, []); assert.equal(existsSync(h.options.evidence), false);
});

test('lease/port conflict blocks before build admission or fresh data creation', async t => {
  const h = harness(t);
  h.deps.acquireLease = args => acquireRuntimeLease(args, { root: h.root, probePort: async () => { throw new Error('occupied test port'); } });
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.match(result.errors.join('\n'), /occupied test port/);
  assert.equal(h.calls.includes('admit'), false); assert.equal(existsSync(h.options.evidence), false);
  h.assertReleased();
});

test('failed current-source build admission releases lease without creating runtime data', async t => {
  const h = harness(t); h.deps.admitBuild = async () => { throw new Error('stale source manifest'); };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.equal(result.leaseRelease.released, true);
  assert.equal(existsSync(h.options.evidence), false); assert.equal(existsSync(h.options.round), false);
  h.assertReleased();
});

for (const mode of ['throw', 'false', 'SIGINT', 'SIGTERM', 'input-drift']) test('controller preserves failed evidence and releases its own lease on ' + mode, async t => {
  const h = harness(t);
  h.deps.runCrash = async () => {
    if (mode === 'throw') throw new Error('mocked crash failure');
    if (mode === 'false') return { passed: false };
    if (mode === 'input-drift') writeFileSync(h.options.lease, '{}');
    else process.emit(mode);
    return { passed: true };
  };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.equal(result.leaseRelease.released, true);
  assert.equal(result.cancelled, ['SIGINT', 'SIGTERM'].includes(mode));
  assert.equal(JSON.parse(readFileSync(join(h.options.evidence, 'result.json'))).status, 'blocked');
  assert.equal(existsSync(join(h.options.round, 'runtime-ta.json')), true);
  h.assertReleased();
});

test('final source verification failure cannot skip lease release', async t => {
  const h = harness(t);
  const admit = h.deps.admitBuild;
  h.deps.admitBuild = async build => {
    const result = await admit(build); result.assertUnchanged = async () => { throw new Error('source changed'); }; return result;
  };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.equal(result.checks.inputsUnchanged, false); h.assertReleased();
});

test('failure to write the final receipt still releases locks and removes signal handlers', async t => {
  const h = harness(t), run = h.deps.runCrash;
  h.deps.runCrash = async context => {
    const result = await run(context); writeFileSync(join(h.options.evidence, 'result.json'), 'existing owned sentinel'); return result;
  };
  await assert.rejects(verifyRuntime(h.options, h.deps), /EEXIST/);
  assert.equal(readFileSync(join(h.options.evidence, 'result.json'), 'utf8'), 'existing owned sentinel');
  h.assertReleased();
});

for (const mode of ['port-conflict', 'SIGTERM']) test('late ' + mode + ' before database dispatch releases lease without starting databases', async t => {
  const h = harness(t, 'database');
  h.deps.checkPort = async () => {
    if (mode === 'port-conflict') throw new Error('late port conflict');
    process.emit('SIGTERM');
  };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.equal(result.leaseRelease.released, true);
  assert.equal(h.calls.includes('database'), false); h.assertReleased();
});

test('unverified database exit retains the lease rather than offering live ports to another owner', async t => {
  const h = harness(t, 'database');
  h.deps.runDatabase = async () => ({ passed: false, cleanup: { stopped: false } });
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.equal(result.leaseRelease.released, false);
  assert.match(result.errors.join('\n'), /resource exit unverified/);
  h.held().assertHeld();
  // This fixture started no resource. Explicit test-owner release is safe.
  h.held().release(h.owner); h.assertReleased();
});

test('unsettled process callback retains the lease even after direct child cleanup', async t => {
  const h = harness(t);
  h.deps.processRunner = async () => ({ groupAliveAfter: false, directChildClosed: true, directChildReaped: true,
    barrier: { settled: false, status: 'aborted' } });
  h.deps.runCrash = async context => { await context.runProcess({}); return { passed: false }; };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.leaseRelease.released, false);
  h.held().release(h.owner); h.assertReleased();
});

test('an outstanding nested invocation cannot disappear from lease accounting', async t => {
  const h = harness(t); let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  h.deps.processRunner = () => pending;
  let invocation;
  h.deps.runCrash = async context => { invocation = context.runProcess({}); return { passed: false }; };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.leaseRelease.released, false);
  finish({ groupAliveAfter: false, directChildClosed: true, directChildReaped: true, barrier: { settled: true } });
  await invocation;
  h.held().release(h.owner); h.assertReleased();
});

test('an unreaped process receipt retains the lease on failure', async t => {
  const h = harness(t);
  h.deps.processRunner = async () => ({ groupAliveAfter: true, directChildClosed: true, directChildReaped: true });
  h.deps.runCrash = async context => { await context.runProcess({}); return { passed: false }; };
  const result = await verifyRuntime(h.options, h.deps);
  assert.equal(result.status, 'blocked'); assert.equal(result.leaseRelease.released, false);
  h.held().release(h.owner); h.assertReleased();
});
