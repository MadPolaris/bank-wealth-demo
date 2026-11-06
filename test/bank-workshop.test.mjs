import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseWorkshopArgs, humanResult, workshopCli } from '../tools/bank-workshop.mjs';
import { ARCHIVE_SHA256, ROOT, doctor, fileReference, leaseMetadata, newRunPath, nodeSupported, sha256 } from '../tools/bank-workshop-supply.mjs';
import { inspectService, reportWorkshop, REQUIRED, verifyWorkshop } from '../tools/bank-workshop-verification.mjs';
import { crashCases as CRASH_CASES, sipCrashCases, taCrashCases, validateChildReport } from '../tools/v1-crash-recovery.mjs';
import { RUNTIME_NETWORK_SCOPE, RUNTIME_NETWORK_LIMITATION } from '../tools/truthsrc-runtime-sandbox.mjs';

const save = (file, value) => writeFileSync(file, JSON.stringify(value), { flag: 'wx' });
function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'bank-workshop-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true })); // Only this test's temporary root.
  mkdirSync(join(root, 'target')); mkdirSync(join(root, '.local/mock-ta'), { recursive: true });
  const archive = join(root, 'archive.tar.gz'); writeFileSync(archive, 'not a release; test double only');
  const lease = join(root, 'lease.json');
  save(lease, { schemaVersion: 'bank.truthsrc-runtime-lease/v1', owner: 'workshop-test', host: '127.0.0.1',
    ports: { http: 19761, mysql: 19762, mongo: 19763 }, runRoot: join(root, 'target/truthsrc-runtime-workshop-test') });
  const options = { through: 'service', run: join(root, 'target/run-one'), archive, lease,
    javaHome: '/no-jvm-is-used', browserModule: '/mock/browser.mjs', browserExecutable: '/mock/chrome-headless-shell' };
  const calls = [], digest = 'sha256:' + 'a'.repeat(64), snapshot = 'source-snapshot';
  const files = [{ file: 'app/Example.scala', bytes: 10, sha256: 'b'.repeat(64) }];
  const current = { project: join(root, 'truthsrc.project.json'), identity: 'captured test inputs' };
  const source = { passed: true, snapshot, sources: [current], validation: { hard: [] }, roundtrip: { ok: true }, strictCompile: { passed: true } };
  const overrides = {
    root, doctor: async () => ({ passed: true }), current: async () => structuredClone(current), source: async () => { calls.push('source'); return source; },
    archive: async file => ({ file, bytes: 1, sha256: ARCHIVE_SHA256 }),
    supply: async file => ({ archive: { file, bytes: 1, sha256: ARCHIVE_SHA256 }, files: [] }),
    generate: async (_project, out) => { calls.push('generate:' + basename(out)); mkdirSync(out); return { applied: true }; },
    anchors: async (_project, out) => ({ passed: true, snapshot, graph: { snapshot: 'graph', generation: basename(out) },
      codeDigest: digest, files, checks: { mockedPublicVerifier: true }, diagnostics: [], counts: { files: 1 } }),
    runner: async ({ script, args }) => {
      calls.push({ script, args });
      if (script === 'verify-truthsrc-build.mjs' || script === 'verify-truthsrc-runtime.mjs') {
        const evidence = args[args.indexOf('--evidence') + 1]; mkdirSync(evidence); save(join(evidence, 'result.json'), { testDouble: true });
      }
      return { code: 0, signal: null, launchFailed: false, interrupted: false };
    },
    build: async ({ evidence }) => ({ passed: true, refs: [await fileReference(join(evidence, 'result.json'))] }),
    service: async ({ evidence }) => ({ passed: true, refs: [await fileReference(join(evidence, 'result.json'))] }),
  };
  return { root, options, overrides, calls, current, source };
}

test('strict CLI syntax and shared scope/format vocabulary', () => {
  assert.equal(parseWorkshopArgs(['verify', '--through', 'source', '--run', '/new', '--format', 'json']).format, 'json');
  for (const args of [
    ['verify', '--through', 'service'], ['report', '--run', '/x', '--archive', '/a'], ['verify', '--through', 'other', '--run', '/x'],
    ['doctor', '--through', 'source', '--probe-resources'], ['doctor', '--through', 'source', '--format', 'xml'],
    ['doctor', '--through', 'source', '--through', 'code'], ['verify', '--through', 'code', '--run', '/x', '--historical'],
  ]) assert.throws(() => parseWorkshopArgs(args));
  assert.equal(nodeSupported('22.12.9'), false); assert.equal(nodeSupported('22.13.0'), true);
  assert.equal(nodeSupported('22.23.4'), true); assert.equal(nodeSupported('20.19.0'), false);
  assert.ok(REQUIRED.every(value => value.startsWith('knowledge:bank-wealth/bankwealth/')));
});

test('session commands delegate, preserve failure and do not invent success', async () => {
  const calls = [];
  const result = await workshopCli(['stop', '--session', '/owned', '--format', 'json'], {
    session: async (...args) => { calls.push(args); return { passed: false, status: 'blocked' }; },
  });
  assert.deepEqual(calls, [['stop', ['--session', '/owned']]]); assert.equal(result.exitCode, 2);
  await assert.rejects(workshopCli(['start', '--session', '/new'], { session: async () => { throw new Error('secret-value'); } }));
});

test('doctor is metadata-only by default, missing materials do not dispatch probes', async t => {
  const { root, options } = fixture(t);
  let probes = 0;
  const before = readdirSync(root);
  const report = await doctor({ ...options, archive: undefined }, { root, tool: root, probePorts: () => { probes++; }, probeImages: () => { probes++; } });
  assert.equal(report.passed, false); assert.equal(report.metadataOnly, true); assert.equal(probes, 0);
  assert.equal(report.checks.find(row => row.id === 'archive').status, 'blocked');
  assert.equal(report.checks.find(row => row.id === 'resources').status, 'not-run');
  assert.deepEqual(readdirSync(root), before);
  const explicit = await doctor({ ...options, probeResources: true }, { root, tool: root, probePorts: () => { probes++; }, probeImages: () => { probes++; } });
  assert.equal(probes, 4); assert.equal(explicit.metadataOnly, false);
  assert.ok(explicit.checks.filter(row => row.kind === 'explicit-resource-probe').every(row => row.status === 'passed'));
});

test('lease metadata enforces owner evidence/TA roots, no historical reuse or overlap', t => {
  const { root, options } = fixture(t);
  const valid = leaseMetadata(options.lease, { root, run: options.run });
  assert.equal(valid.round, join(root, '.local/mock-ta/truthsrc-runtime-workshop-test'));
  assert.throws(() => leaseMetadata(options.lease, { root, run: valid.spec.runRoot }));
  const bad = JSON.parse(readFileSync(options.lease)); bad.runRoot = options.run;
  const file = join(root, 'bad-lease.json'); save(file, bad);
  assert.throws(() => leaseMetadata(file, { root }));
  mkdirSync(valid.spec.runRoot); assert.throws(() => leaseMetadata(options.lease, { root }));
});

test('source double requires no archive or runner, retains exclusive attempts and is never full', async t => {
  const f = fixture(t);
  const options = { through: 'source', run: f.options.run };
  f.overrides.archive = f.overrides.supply = f.overrides.runner = () => assert.fail('source must not touch supply/executors');
  const result = await verifyWorkshop(options, f.overrides);
  assert.equal(result.requestedScopePassed, true); assert.equal(result.fullPipelinePassed, false);
  assert.equal(result.executionKind, 'test-double'); assert.equal(result.onboardingComplete, false);
  assert.ok(readdirSync(join(options.run, 'attempts/0001')).includes('completed.json'));
  assert.ok(readdirSync(options.run).includes('results.json'));
  assert.deepEqual(JSON.parse(readFileSync(join(options.run, 'report.json'))), result);
  assert.equal(result.staticSnapshot, true);
  assert.match(readFileSync(join(options.run, 'report.md'), 'utf8'), /Static snapshot checked at/);
  for (const name of ['report.json', 'report.md']) assert.equal(statSync(join(options.run, name)).mode & 0o777, 0o600);
  await assert.rejects(verifyWorkshop(options, f.overrides));
  assert.ok(humanResult(result).includes('银行完整验收：未完成'));
});

test('missing supply blocks BEFORE compile/generate and preserves failed attempt, no downgrade', async t => {
  const f = fixture(t);
  f.overrides.doctor = async () => ({ passed: false, checks: [{ id: 'archive', status: 'blocked' }] });
  const result = await verifyWorkshop(f.options, f.overrides);
  assert.equal(result.requestedScopePassed, false); assert.equal(result.fullPipelinePassed, false); assert.deepEqual(f.calls, []);
  const index = JSON.parse(readFileSync(join(f.options.run, 'results.json')));
  assert.equal(index.candidates.length, 0); assert.ok(index.diagnostics.length);
});

test('code double generates TWO fresh outputs and invokes both explicit fixed-test modes', async t => {
  const f = fixture(t);
  const result = await verifyWorkshop({ ...f.options, through: 'code' }, f.overrides);
  assert.equal(result.requestedScopePassed, true); assert.equal(result.fullPipelinePassed, false);
  assert.deepEqual(f.calls.filter(row => typeof row === 'string' && row.startsWith('generate:')), ['generate:actor-output', 'generate:readside-output']);
  const builds = f.calls.filter(row => row.script === 'verify-truthsrc-build.mjs');
  assert.equal(builds.length, 2); assert.ok(builds[0].args.includes('--run-actor-tests')); assert.ok(builds[1].args.includes('--run-readside-tests'));
  assert.notEqual(builds[0].args[1], builds[1].args[1]);
  for (const build of builds) {
    const evidence = build.args[build.args.indexOf('--evidence') + 1];
    assert.equal(dirname(evidence), join(f.root, 'target'), 'unchanged actor helper requires direct target child');
    assert.ok(basename(evidence).startsWith(basename(f.options.run) + '-'), 'TA round must be unique to the run');
  }
});

test('service double uses THIRD fresh runtime build, all window, explicit lease AND browser', async t => {
  const f = fixture(t), result = await verifyWorkshop(f.options, f.overrides);
  assert.equal(result.requestedScopePassed, true); assert.equal(result.fullPipelinePassed, false, 'mock execution never certifies real engineering');
  const build = f.calls.filter(row => row.script === 'verify-truthsrc-build.mjs');
  assert.equal(build.length, 3); assert.ok(build[2].args.includes('--compile-runtime-tests'));
  const runtime = f.calls.find(row => row.script === 'verify-truthsrc-runtime.mjs');
  for (const flag of ['--lease', '--browser-module', '--browser-executable']) assert.ok(runtime.args.includes(flag));
  assert.equal(runtime.args[runtime.args.indexOf('--window') + 1], 'all');
  assert.equal(runtime.args[runtime.args.indexOf('--evidence') + 1], join(f.root, 'target/truthsrc-runtime-workshop-test'));
});

test('candidate digest mismatch stops code/service and does not copy generated code', async t => {
  const f = fixture(t), base = f.overrides.anchors;
  f.overrides.anchors = async (project, out) => ({ ...await base(project, out), ...(out.includes('readside') ? { codeDigest: 'sha256:' + 'c'.repeat(64) } : {}) });
  const result = await verifyWorkshop(f.options, f.overrides);
  assert.equal(result.requestedScopePassed, false); assert.equal(result.fullPipelinePassed, false);
  assert.equal(f.calls.filter(row => row.script === 'verify-truthsrc-build.mjs').length, 1);
  assert.ok(!f.calls.some(row => row.script === 'verify-truthsrc-runtime.mjs'));
});

test('failed executor retains failure and raw secret error is absent from report', async t => {
  const f = fixture(t), base = f.overrides.runner;
  f.overrides.runner = async args => { if (args.script === 'verify-truthsrc-build.mjs') throw new Error('TOKEN=private-test-secret'); return base(args); };
  const result = await verifyWorkshop(f.options, f.overrides);
  assert.equal(result.requestedScopePassed, false); assert.equal(result.stages.find(row => row.id === 'code').status, 'failed');
  assert.ok(!JSON.stringify(result).includes('private-test-secret'));
  assert.ok(!readFileSync(join(f.options.run, 'results.json'), 'utf8').includes('private-test-secret'));
  for (const name of ['report.json', 'report.md']) assert.ok(!readFileSync(join(f.options.run, name), 'utf8').includes('private-test-secret'));
  assert.match(readFileSync(join(f.options.run, 'attempts/0001/failure.json'), 'utf8'), /private-test-secret/, 'private failure evidence is retained');
});

test('report is read-only, invalidates changed refs, current support/handwritten, failed and skipped stages', async t => {
  const f = fixture(t);
  await verifyWorkshop({ ...f.options, through: 'code' }, f.overrides);
  const indexFile = join(f.options.run, 'results.json'), sealed = readFileSync(indexFile);
  const savedReports = ['report.json', 'report.md'].map(name => {
    const file = join(f.options.run, name); return { file, bytes: readFileSync(file), mtime: statSync(file).mtimeMs };
  });
  const callsBefore = f.calls.length;
  assert.equal((await reportWorkshop({ run: f.options.run }, f.overrides)).requestedScopePassed, true);
  assert.equal(f.calls.length, callsBefore, 'report must not generate or dispatch an executor');
  assert.deepEqual(readFileSync(indexFile), sealed, 'report must not rewrite results');
  f.current.identity = 'changed handwritten/support closure';
  assert.equal((await reportWorkshop({ run: f.options.run }, f.overrides)).requestedScopePassed, false);
  for (const saved of savedReports) {
    assert.deepEqual(readFileSync(saved.file), saved.bytes); assert.equal(statSync(saved.file).mtimeMs, saved.mtime);
  }
  f.current.identity = 'captured test inputs';
  const index = JSON.parse(sealed);
  writeFileSync(index.refs[0].file, '{}');
  assert.equal((await reportWorkshop({ run: f.options.run }, f.overrides)).requestedScopePassed, false);
  for (const status of ['failed', 'skipped']) {
    index.stages.source.status = status; writeFileSync(indexFile, JSON.stringify(index));
    assert.equal((await reportWorkshop({ run: f.options.run }, f.overrides)).fullPipelinePassed, false);
  }
});

test('interrupted run without sealed results never passes; symlink targets are rejected', async t => {
  const f = fixture(t);
  mkdirSync(f.options.run);
  save(join(f.options.run, 'run.json'), { schemaVersion: 'bank.workshop-verification/v1', run: f.options.run, through: 'source', project: '/project', executionKind: 'real' });
  const result = await reportWorkshop({ run: f.options.run }, f.overrides);
  assert.equal(result.requestedScopePassed, false); assert.equal(result.fullPipelinePassed, false);
  const alias = join(f.root, 'target/alias'); symlinkSync(f.options.run, alias);
  assert.throws(() => newRunPath(alias, f.root, true));
});

test('real service receipt gate rejects aggregate success with missing browser/cleanup/stages', async t => {
  const f = fixture(t), evidence = join(f.root, 'target/runtime-evidence'); mkdirSync(evidence);
  const result = { schemaVersion: 'bank.truthsrc-runtime/v1', status: 'passed', errors: [], cancelled: false,
    window: 'database', evidence, buildEvidence: '/build', round: '/round', checks: { sourceBound: true, inputsUnchanged: true },
    database: { passed: true, browserVerified: false } };
  save(join(evidence, 'result.json'), result);
  await assert.rejects(inspectService({ evidence, buildEvidence: '/build', round: '/round', lease: f.options.lease }));
});

// Authored schema fixtures, never copied from private runtime evidence. The
// existing pure oracle checks every fixed case; this does not simulate a JVM.
function childReport(caseName, namespace, mode, pid, nodePid) {
  const barrier = mode === 'crash', hash = 'a'.repeat(64), sip = sipCrashCases.includes(caseName);
  const parent = () => ({ RunStarted: 1, StageDone: 1, RunFailedEvt: 0 });
  const original = { principalId: 'alice', clientRequestId: sip ? 'crash-sip-request' : 'crash-request', amount: '100.00' };
  const identities = { paymentTxId: 'original-payment', ...(sip ? { planId: 'original-plan' } : {}) };
  const counts = { source: 1, settlement: 1, paymentResult: 1, paymentParent: parent() };
  if (caseName.startsWith('refund-') || caseName === 'ta-rejected-after-ingest-before-ack') counts.refundParent = parent();
  const streams = ['investor', 'collection', 'order'].map(persistenceId => ({ persistenceId, eventCount: 1, lastSequenceNr: 1,
    serializedSha256: hash, pbSha256: hash, events: [{ persistenceId, sequenceNr: 1, eventType: 'fixture.PB',
      serializerId: 1, manifest: 'pb', serializedSha256: hash, pbSha256: hash }] }));
  const financial = { original, identities, eventCounts: counts, allPbEventsSha256: hash, durablePbVector: streams.flatMap(s => s.events) };
  const evidence = { original, identities, eventCounts: counts, state: {}, financial,
    journal: { persistenceIds: streams.map(s => s.persistenceId), streams, allDurableEventsSerializedSha256: hash, allPbEventsSha256: hash },
    processes: { javaPid: pid, nodePid, nodePidSource: 'worker.jsonl:worker-started' },
    recovery: { driver: 'BankRecoveryLoop', customerResubmissions: 0, preservedOriginalSerializedPrefix: true },
    storage: { provider: 'local', journal: 'akka.persistence.journal.leveldb', native: false, fsync: true, snapshotStore: 'akka.persistence.snapshot-store.local' } };
  if (barrier) Object.assign(evidence, { barrierCondition: caseName, loopStarted: false,
    fault: { enabled: true, forwardBlocked: true, hiddenReceiptReads: 1, withheldAcks: 1 } });
  if (barrier && caseName === 'request-before-start') { counts.settlement = 0; counts.paymentParent.RunStarted = 0; }
  if (barrier && caseName === 'refund-before-assembly') { counts.refundIntent = 1; counts.refundParent.RunStarted = 0; }
  if (taCrashCases.includes(caseName)) {
    const refund = caseName.startsWith('refund-') || caseName === 'ta-rejected-after-ingest-before-ack';
    const paymentAck = barrier && caseName === 'payment-succeeded-before-delivery-ack';
    const beforeSubmit = barrier && ['ta-register-before-assembly', 'ta-intent-before-submit'].includes(caseName);
    const beforeAccept = barrier && (beforeSubmit || paymentAck || caseName === 'ta-submitted-before-bank-accept');
    const refundIntent = refund && (!barrier || caseName !== 'ta-rejected-after-ingest-before-ack') ? 1 : 0;
    const taStarted = barrier && (paymentAck || caseName === 'ta-register-before-assembly') ? 0 : 1;
    Object.assign(counts, { taAccepted: beforeAccept ? 0 : 1, taConfirmed: !barrier && caseName === 'ta-confirmed-before-ingest' ? 1 : 0,
      taRegistration: paymentAck ? 0 : 1, taRejection: refund ? 1 : 0, taHostIntent: taStarted,
      taHostObservations: barrier && (beforeAccept || caseName === 'ta-accepted-before-effect-reply') ? 0 : 1,
      paymentDeliveryAcknowledged: paymentAck ? 0 : 1, refundDeliveryAcknowledged: !barrier && refund ? 1 : 0,
      refundIntent, refundResult: refundIntent,
      taParent: { RunStarted: taStarted, StageDone: barrier && (beforeAccept || caseName === 'ta-accepted-before-effect-reply') ? 0 : 1, RunFailedEvt: 0 },
      refundParent: refund ? { RunStarted: refundIntent, StageDone: barrier ? 0 : 1, RunFailedEvt: 0 } : null });
    counts.paymentParent.StageDone = paymentAck ? 0 : 1;
    financial.ta = { journal: { submissionCount: beforeSubmit || paymentAck ? 0 : 1 } };
  }
  if (sip) {
    const index = sipCrashCases.indexOf(caseName), creation = index < 4, terminal = caseName.startsWith('sip-terminal-');
    const occurrences = creation || barrier && caseName === 'sip-tick-before-catchup' ? 0 : terminal ? 1 : 2;
    const completed = !barrier || terminal ? occurrences : 0, counted = terminal && (!barrier || caseName === 'sip-terminal-ack-lost') ? 1 : 0;
    Object.assign(counts, { createIntent: 1, created: barrier && index === 0 ? 0 : 1,
      appended: !barrier ? 2 : index < 2 ? 0 : index === 2 ? 1 : 2, sealed: barrier && creation ? 0 : 1,
      clockAdvanced: creation ? 0 : 1, occurrences, successTotal: counted, failureTotal: 0, terminalSucceeded: counted, terminalFailed: 0,
      cashSettlements: completed, paymentResults: completed,
      sipParents: Array.from({ length: completed }, parent), paymentParents: Array.from({ length: completed }, parent), taParents: Array.from({ length: completed }, parent) });
    Object.assign(financial, { plan: { id: 'original-plan' }, orders: Array.from({ length: completed }, (_, index) => ({ id: 'order-' + index })) });
  }
  const report = { schemaVersion: barrier ? 'bank-crash-barrier/v1' : 'bank-crash-result/v1', mode, caseName, namespace, pid,
    ...(barrier ? {} : { passed: true }), evidence };
  validateChildReport(report, mode, { caseName, namespace }, pid, barrier);
  return report;
}

async function serviceFixture(t) {
  const f = fixture(t), spec = JSON.parse(readFileSync(f.options.lease));
  const evidence = spec.runRoot, round = join(f.root, '.local/mock-ta', basename(evidence)), buildEvidence = '/build';
  mkdirSync(evidence); mkdirSync(round);
  const sandbox = join(evidence, 'sandbox.sb'); writeFileSync(sandbox, 'schema fixture profile, never executed');
  const fixtureFile = join(ROOT, 'test/fixtures/truthsrc-actor-ta.json'), fixtureRef = await fileReference(fixtureFile);
  const configFile = join(round, 'runtime-ta.json');
  save(configFile, { schemaVersion: 'bank.truthsrc-runtime-ta/v1', ownedRoot: round, fixture: { file: fixtureFile, sha256: fixtureRef.sha256 } });
  const configRef = await fileReference(configFile);
  let nextPid = 10000;
  const processReceipt = (base, stdout = '{}', crash = false) => {
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(base + '.stdout.log', stdout); writeFileSync(base + '.stderr.log', '');
    const receipt = { schemaVersion: 'bank.truthsrc-runtime-process/v1', passed: true, status: 'passed', pid: nextPid++,
      code: crash ? null : 0, signal: crash ? 'SIGKILL' : null, expectedSignal: crash ? 'SIGKILL' : null, expectedTermination: true,
      launchError: null, timedOut: false, cancelled: null, leftoverGroup: false, terminationErrors: [], outputLimitExceeded: false, outputError: false,
      barrier: { settled: true, status: crash ? 'passed' : 'not-requested' }, mainSignals: crash ? [{ signal: 'SIGKILL', sent: true }] : [],
      directChildClosed: true, directChildReaped: true, groupAliveAfter: false, sandboxProfileUnchanged: true,
      sandboxProfile: sandbox, sandboxProfileSha256: sha256(readFileSync(sandbox)),
      paths: { stdout: base + '.stdout.log', stderr: base + '.stderr.log', receipt: base + '.json' }, stdoutSha256: sha256(stdout), stderrSha256: sha256('') };
    save(base + '.json', receipt); return receipt;
  };
  const worker = (root, invocation, crash = false) => {
    mkdirSync(invocation, { recursive: true }); const pid = nextPid++;
    const cleanCloseReceipt = { schemaVersion: 'bank.truthsrc-runtime-ta-worker/v1', pid, closed: true,
      journalPath: join(root, 'ta.jsonl'), roundRoot: round, ownedRoot: root,
      configSha256: configRef.sha256, fixtureSha256: fixtureRef.sha256, configurationDigest: 'c'.repeat(64) };
    save(join(root, `ta-worker-${pid}.json`), cleanCloseReceipt);
    const rows = [{ kind: 'worker-started', pid }, ...crash ? [] : [
      { id: 1, op: 'close', input: null }, { id: 1, ok: true, result: { closed: true } }, { kind: 'worker-exited', pid, exitCode: 0, waited: true }]];
    const transcript = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(join(invocation, 'worker.jsonl'), transcript); writeFileSync(join(invocation, 'worker.stderr.log'), '');
    return { pid, absent: true, cleanCloseReceipt, jvmWaited: !crash, transcriptSha256: sha256(transcript) };
  };
  const boundary = (directory, networkScope, controls = []) => {
    mkdirSync(directory, { recursive: true });
    const profile = join(directory, 'runtime-sandbox.sb'), probe = join(directory, 'runtime-probe.py');
    const canary = join(f.root, 'outside-canary-' + nextPid);
    for (const file of [profile, probe, canary, ...controls]) {
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'synthetic boundary control, never executed');
    }
    const receipt = processReceipt(join(directory, 'probe'));
    receipt.sandboxProfile = profile; receipt.sandboxProfileSha256 = sha256(readFileSync(profile));
    writeFileSync(join(directory, 'probe.json'), JSON.stringify(receipt));
    const before = Object.fromEntries([profile, probe, canary, configFile, ...controls].map(file => {
      const bytes = readFileSync(file); return [file, { bytes: bytes.length, sha256: sha256(bytes) }];
    }));
    save(join(directory, 'boundary.json'), { passed: true, networkScope,
      limitation: networkScope === 'deny-all' ? null : RUNTIME_NETWORK_LIMITATION, before, syscallProbe: receipt });
  };
  boundary(join(evidence, 'crash-boundary'), 'deny-all');
  const cases = CRASH_CASES.map((caseName, index) => {
    const root = join(round, 'case-' + caseName), namespace = 'crash_' + sha256(evidence).slice(0, 16) + '_' + index;
    const invocations = ['crash', 'recover', 'verify'].map(mode => {
      const invocation = join(root, 'runs', mode), crash = mode === 'crash';
      const process = processReceipt(join(invocation, 'process'), '{}', crash), w = worker(root, invocation, crash);
      const report = childReport(caseName, namespace, mode, process.pid, w.pid);
      save(join(invocation, crash ? 'barrier.json' : 'result.json'), report);
      if (!crash) save(join(invocation, 'closed.json'), { schemaVersion: 'bank-crash-closed/v1', mode, caseName, namespace,
        pid: process.pid, nodePid: w.pid, workerWaited: true, actorSystemTerminated: true });
      return { mode, pid: process.pid, process, worker: w, report };
    });
    const row = { schemaVersion: 'bank.truthsrc-runtime-crash-case/v1', caseName, namespace, passed: true, sourceBound: true,
      invocations, failure: null, release1134Resigned: false, runtimeRetryBackoffDeadline: 'OPEN' };
    save(join(root, 'runtime-receipt.json'), row); return row;
  });
  const runs = ['initial', 'restart', 'refund', 'replay'].map(mode => {
    const dir = join(evidence, 'database', mode), serviceRoot = join(round, 'service'), invocation = join(serviceRoot, 'runs', mode);
    boundary(dir, RUNTIME_NETWORK_SCOPE, ['integration.conf', 'logback.xml', 'browser.json'].map(name => join(invocation, name)));
    const browser = mode !== 'restart' ? { completed: true, mode } : null;
    if (browser) processReceipt(join(dir, 'browser'), JSON.stringify(browser));
    const process = processReceipt(join(dir, 'server')), w = worker(serviceRoot, invocation);
    save(join(invocation, 'server.json'), { pid: process.pid, origin: 'http://127.0.0.1:' + spec.ports.http, scope: 'production Loader and Factory with Mongo/MySQL' });
    save(join(invocation, 'closed.json'), { closed: true });
    const row = { mode, process, browser, worker: w,
      listener: { pid: process.pid, verified: true, host: '127.0.0.1', port: spec.ports.http }, getJournalUnchanged: true,
      transport: mode === 'initial' ? { journalEventsVerified: true } : null };
    save(join(dir, 'result.json'), row); return row;
  });
  processReceipt(join(evidence, 'database/mysql-negative/process'));
  const database = { passed: true, browserVerified: true, productionFactory: true,
    cleanup: { schemaVersion: 'bank.truthsrc-runtime-databases/v1', owner: spec.owner, stopped: true }, errors: [], runs,
    mysqlNegative: { scenarios: Array.from({ length: 5 }, () => ({ status: 'passed' })) } };
  save(join(evidence, 'database/database-stop.json'), database.cleanup);
  save(join(evidence, 'database/mysql-negative/result.json'), database.mysqlNegative);
  save(join(evidence, 'database/result.json'), database);
  const leaseRef = await fileReference(f.options.lease);
  const browserRoot = join(f.root, 'schema-browser'); mkdirSync(browserRoot); writeFileSync(join(browserRoot, 'index.mjs'), 'fixture only');
  save(join(evidence, 'inputs.json'), { options: { window: 'all', buildEvidence, browserModule: '/mock', browserExecutable: '/mock' },
    runtime: Object.fromEntries([leaseRef, configRef, fixtureRef].map(ref => [ref.file, { bytes: ref.bytes, sha256: ref.sha256 }])),
    browserInputs: { [browserRoot]: { 'index.mjs': { bytes: 12, sha256: sha256('fixture only') } } } });
  const result = { schemaVersion: 'bank.truthsrc-runtime/v1', status: 'passed', errors: [], cancelled: false, window: 'all', evidence, buildEvidence, round,
    owner: spec.owner, lease: { ...spec, input: leaseRef }, leaseRelease: { owner: spec.owner, released: true, dataPreserved: true, reusable: false },
    checks: { sourceBound: true, inputsUnchanged: true, crashPassed: true, databasePassed: true },
    runtimeRebuilt: false, runtimePublished: false, release1134Resigned: false, crash: { passed: true, count: cases.length, jvms: cases.length * 3, cases }, database };
  const file = join(evidence, 'result.json'); save(file, result);
  return { ...f, evidence, round, file, result, options: { evidence, buildEvidence, round, lease: f.options.lease } };
}

test('real service inspector rechecks every schema process receipt and rejects browser/log/exit gaps', async t => {
  const { evidence, file, result, options } = await serviceFixture(t);
  assert.equal((await inspectService(options)).passed, true);
  for (const alter of [
    value => { value.leaseRelease.released = false; },
    value => { value.checks.inputsUnchanged = false; },
    value => { value.crash.cases.pop(); },
    value => { value.database.browserVerified = false; },
    value => { value.database.cleanup.stopped = false; },
  ]) {
    const changed = structuredClone(result); alter(changed); writeFileSync(file, JSON.stringify(changed));
    await assert.rejects(inspectService(options));
  }
  writeFileSync(file, JSON.stringify(result));
  writeFileSync(join(evidence, 'database/replay/browser.stdout.log'), '{"completed":false}');
  await assert.rejects(inspectService(options), 'tampered nested browser log must fail even if root says passed');
});

test('service inspector seals boundary controls and the original database stop receipt', async t => {
  const { evidence, options } = await serviceFixture(t);
  const first = await inspectService(options), references = new Set(first.refs.map(row => row.file));
  const paths = ['crash-boundary', ...['initial', 'restart', 'refund', 'replay'].map(mode => 'database/' + mode)];
  for (const directory of paths) {
    for (const name of ['boundary.json', 'runtime-probe.py']) assert.ok(references.has(join(evidence, directory, name)));
  }
  const files = [join(evidence, 'database/database-stop.json'), join(evidence, 'crash-boundary/boundary.json'),
    join(evidence, 'database/replay/runtime-probe.py')];
  for (const file of files) {
    assert.ok(references.has(file)); const bytes = readFileSync(file);
    writeFileSync(file, file.endsWith('.json') ? '{"stopped":false}' : 'changed control');
    await assert.rejects(inspectService(options));
    writeFileSync(file, bytes); unlinkSync(file);
    await assert.rejects(inspectService(options));
    writeFileSync(file, bytes, { flag: 'wx' });
  }
  assert.equal((await inspectService(options)).passed, true);
});

test('file references detect byte changes without exposing contents', async t => {
  const { root } = fixture(t), file = join(root, 'ref.json'); writeFileSync(file, 'private-body');
  const ref = await fileReference(file); assert.equal(ref.sha256, sha256('private-body')); assert.equal(ref.bytes, 12);
  assert.ok(!JSON.stringify(ref).includes('private-body')); writeFileSync(file, 'changed-body');
  assert.notEqual((await fileReference(file)).sha256, ref.sha256);
});
