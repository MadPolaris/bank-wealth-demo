import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, TOOL, STAGES, DEFAULT_JAVA_HOME, ARCHIVE_SHA256, captureCurrent, captureSupply, checkedPath,
  doctor, fileReference, jsonText, leaseMetadata, newRunPath, readJson, requestedStages, sha256, within,
} from './bank-workshop-supply.mjs';
import { captureRuntimeFile } from './truthsrc-evidence.mjs';
import { inspectRuntimeWorker } from './truthsrc-worker-evidence.mjs';
import { inspectRuntimeProcessEvidence } from './truthsrc-runtime-process.mjs';

export const CONTRACT = 'bank.workshop-verification/v1';
// These are selectors, not copies of financial rules/oracles. Qualified identities
// retain the distinction between a command, its guard and the event member fold.
export const REQUIRED = Object.freeze([
  'knowledge:bank-wealth/bankwealth/command/CreditBalance/ReserveFunds',
  'knowledge:bank-wealth/bankwealth/guard/CreditBalance/ReserveFunds/LEDGER_POSITIVE',
  'knowledge:bank-wealth/bankwealth/fold/CreditBalance/ReserveFundsConfirmed/reservedAmount',
]);
const save = (file, value) => writeFileSync(file, jsonText(value), { flag: 'wx', mode: 0o600 });
const same = (a, b, reason) => assert.deepEqual(a, b, reason);
const allTrue = checks => checks && Object.keys(checks).length > 0 && Object.values(checks).every(value => value === true);
const stamp = value => sha256(JSON.stringify(value));
const now = () => new Date().toISOString();
const requirePassed = value => assert.equal(value, true, 'required gate did not pass');
const publicModule = name => import(pathToFileURL(join(TOOL, 'lib/project', name + '.mjs')));

// Do not forward subprocess stdout/stderr, exceptions, env or raw runtime results
// into a shareable report. The owning executors retain their private diagnostics.
export async function runTool({ script, args, base, signal }) {
  const fds = [openSync(base + '.stdout.log', 'wx', 0o600), openSync(base + '.stderr.log', 'wx', 0o600)];
  let child, interrupted = false;
  const cancel = () => { interrupted = true; child?.kill('SIGTERM'); };
  try {
    if (signal?.aborted) throw new Error('cancelled before dispatch');
    child = spawn(process.execPath, [join(ROOT, 'tools', script), ...args], {
      cwd: ROOT, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' }, stdio: ['ignore', ...fds],
    });
    signal?.addEventListener('abort', cancel, { once: true });
    // The build/runtime executors own their groups, deadlines and cleanup. Never
    // kill only their parent on an orchestration timeout and strand its children.
    const result = await new Promise(resolve => {
      let launchFailed = false;
      child.once('error', () => { launchFailed = true; });
      child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal, launchFailed, interrupted }));
    });
    save(base + '.process.json', result);
    assert.ok(result.code === 0 && !result.signal && !result.launchFailed && !result.interrupted, 'executor failed; private evidence retained');
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
    fds.forEach(closeSync);
  }
}

async function compileSource(project) {
  const { projectCli } = await publicModule('cli');
  const result = await projectCli('compile-project', ['--project', project]);
  assert.equal(result.applied, false);
  assert.equal(result.validation?.hard?.length, 0); requirePassed(result.validation?.roundtrip?.ok);
  assert.ok(result.compilation?.result, 'strict products missing');
  return { schemaVersion: 'bank.workshop-source/v1', passed: true, sources: result.sources,
    validation: result.validation, roundtrip: result.validation.roundtrip,
    strictCompile: { passed: true, digest: stamp(result.compilation.result), diagnostics: result.compilation.diagnostics ?? [] },
    snapshot: result.sourceIndex?.snapshot, canonicalDigest: stamp(result.canonical), runtimeVerified: false };
}

async function generate(project, out) {
  checkedPath(out, 'planned'); assert.ok(!existsSync(out), 'fresh output required');
  const { projectCli } = await publicModule('cli');
  const result = await projectCli('generate-project', ['--project', project, '--out', out]);
  requirePassed(result.applied);
  return { applied: true, graph: result.graph };
}

async function verifyAnchors(project, out) {
  const { verifyProject } = await publicModule('verify');
  return verifyProject({ project, out, required: REQUIRED });
}

const COMMON_CHECKS = ['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
  'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried',
  'verifierUnchanged', 'actualBuildSourcesVerified'];

// Reuse the existing inspectors and pinned test manifests. This is receipt
// composition, not another build runner or test oracle.
export async function inspectBuild({ mode, output, evidence, source }) {
  const b = await import('./verify-truthsrc-build.mjs');
  const input = readJson(join(evidence, 'input.json')), result = readJson(join(evidence, 'result.json'));
  const actual = readJson(join(evidence, 'actual-build-sources.json'));
  const before = readJson(join(evidence, 'sources-before.json')), after = readJson(join(evidence, 'sources-after.json'));
  const process = readJson(join(evidence, 'build.json'));
  const stdout = readFileSync(join(evidence, 'build.stdout.log'), 'utf8');
  assert.equal(result.schemaVersion, 'bank.truthsrc-build/v1'); assert.equal(result.status, 'passed');
  same(result.errors, []); assert.equal(result.cancelled, null); requirePassed(allTrue(result.checks));
  for (const name of COMMON_CHECKS) requirePassed(result.checks[name]);
  same([input.output, result.output, actual.admittedOutput], [output, output, output]);
  same([input.evidence, result.evidence], [evidence, evidence]); same(input.sources, source.sources, 'build came from different source/tool inputs');
  assert.equal(result.archive?.sha256, ARCHIVE_SHA256); assert.equal(input.archiveSha256, ARCHIVE_SHA256);
  const toolchain = [join(input.javaHome, 'bin/java'), join(input.javaHome, 'bin/javac'), join(input.javaHome, 'release'), '/usr/bin/python3', '/usr/bin/sandbox-exec'];
  same(Object.keys(input.toolchain).sort(), toolchain.sort());
  for (const file of toolchain) { b.safePath(file, 'file'); assert.equal(b.fileDigest(file), input.toolchain[file], 'build toolchain changed'); }
  same(input.verifier, { file: join(ROOT, 'tools/verify-truthsrc-build.mjs'), sha256: b.fileDigest(join(ROOT, 'tools/verify-truthsrc-build.mjs')) });
  same(input.verifierSupport, b.snapshotFiles(b.BUILD_SUPPORT), 'build file-evidence helpers changed');
  requirePassed(actual.passed); b.succeeded(process); same(result.phases.build, process);
  assert.equal(sha256(stdout), process.stdoutSha256);
  assert.equal(sha256(readFileSync(join(evidence, 'build.stderr.log'))), process.stderrSha256);
  assert.equal(actual.root, b.actualBuildSourceRoot(stdout, output, evidence));
  assert.equal(actual.stdoutSha256, process.stdoutSha256);
  b.compareBuildSources(before.output, actual.sources);
  same(b.inventory(output, { afterBuild: true }), before.output);
  same(b.inventory(actual.root, { afterBuild: true }), before.output, 'actual staged source changed');
  assert.equal(actual.files, Object.keys(before.output).length);
  for (const name of ['output', 'handwritten', 'localRuntime']) same(before[name], after[name]);
  same(b.inventory(join(ROOT, 'handwritten/scala')), before.handwritten);
  same(b.inventory(join(ROOT, '.local/truthsrc-runtime')), before.localRuntime);
  same(b.inventory(join(evidence, 'supply')), after.supply);
  for (const key of ['runtimeRebuilt', 'runtimePublished', 'release1134Resigned', 'servicesStarted']) assert.equal(result[key], false);
  const names = ['input.json', 'result.json', 'actual-build-sources.json', 'sources-before.json', 'sources-after.json',
    'build.json', 'build.stdout.log', 'build.stderr.log', 'build-plan.json', 'supply-before.json'];
  let tests = null;
  if (mode === 'runtime') {
    requirePassed(result.compileRuntimeTests);
    for (const key of ['actualRuntimeTestSourcesVerified', 'runtimeClasspathVerified', 'runtimeTestInputsUnchanged', 'runtimeCompilationPassed']) requirePassed(result.checks[key]);
    const { admitRuntimeBuild } = await import('./truthsrc-runtime-admission.mjs');
    const admitted = await admitRuntimeBuild(evidence); await admitted.assertUnchanged();
    names.push('runtime-build.json', 'runtime-inputs-before.json', 'runtime-inputs-after.json');
  } else {
    const actor = mode === 'actor'; assert.ok(actor || mode === 'readside');
    same([result.runActorTests, result.runReadsideTests, result.runGeneratedTests, result.compileRuntimeTests], [actor, !actor, false, false]);
    requirePassed(result.compileGeneratedTests); requirePassed(result.testsExecuted);
    const a = await import('./truthsrc-actor-tests.mjs'), r = await import('./truthsrc-readside-tests.mjs');
    const generated = b.generatedTestManifest(input.testFiles.map(file => ({ path: file, content: readFileSync(join(output, file), 'utf8') })));
    const manifest = actor ? a.combineActorManifest(generated, a.actorTestManifest()) : r.combineReadsideManifest(generated, r.readsideTestManifest());
    same(input.testManifest, manifest, 'pinned test identity differs');
    const observed = b.inspectGeneratedTests(stdout, manifest, process.pid);
    tests = b.completeGeneratedTests(observed, process, result.checks, result.cancelled, result.errors);
    requirePassed(tests.passed); requirePassed(tests.sourceBound); requirePassed(tests.completed);
    const key = actor ? 'actorTests' : 'readsideTests';
    requirePassed(result[key]?.passed); requirePassed(result[key]?.sourceBound); requirePassed(result.checks[key + 'Passed']);
    const saved = readJson(join(evidence, actor ? 'actor-tests.json' : 'readside-tests.json'));
    requirePassed(saved.passed); same(saved.totals, tests.totals); same(saved.expected, manifest);
    if (actor) {
      for (const name of ['actorInputsUnchanged', 'actorWorkersVerified', 'actorBoundaryEnforced', 'actualTestSourcesVerified']) requirePassed(result.checks[name]);
      names.push('actor-tests.json', 'actor-inputs-before.json', 'actor-inputs-after.json', 'actor-workers.json');
    } else {
      for (const name of r.READSIDE_EXECUTION_CHECKS) requirePassed(result.checks[name]);
      r.inspectReadsideSources(stdout, actual.root, input.testFiles, manifest);
      names.push('readside-tests.json', 'readside-sources-before.json', 'readside-sources-after.json');
    }
  }
  return { passed: true, actualRoot: actual.root, checks: result.checks,
    tests: tests ? { totals: tests.totals, sourceBound: tests.sourceBound } : null,
    refs: await Promise.all(names.map(name => fileReference(join(evidence, name)))) };
}

export async function inspectService({ evidence, buildEvidence, lease, round }) {
  const result = readJson(join(evidence, 'result.json'));
  assert.equal(result.schemaVersion, 'bank.truthsrc-runtime/v1'); assert.equal(result.status, 'passed');
  same(result.errors, []); assert.equal(result.cancelled, false); assert.equal(result.window, 'all');
  same([result.evidence, result.buildEvidence, result.round], [evidence, buildEvidence, round]);
  same(result.lease?.input?.file, lease);
  const spec = readJson(lease);
  assert.equal(spec.schemaVersion, 'bank.truthsrc-runtime-lease/v1'); assert.equal(spec.runRoot, evidence);
  const inputs = readJson(join(evidence, 'inputs.json'));
  same(inputs.options.window, 'all'); same(inputs.options.buildEvidence, buildEvidence);
  assert.ok(inputs.options.browserModule && inputs.options.browserExecutable && inputs.browserInputs && Object.keys(inputs.browserInputs).length > 0);
  const { inventory, fileDigest, safePath } = await import('./verify-truthsrc-build.mjs');
  for (const [file, expected] of Object.entries(inputs.runtime)) {
    safePath(file, 'file'); const actual = await fileReference(file);
    same({ bytes: actual.bytes, sha256: actual.sha256 }, expected, 'runtime input changed');
  }
  for (const [directory, expected] of Object.entries(inputs.browserInputs)) same(inventory(directory), expected, 'browser input changed');
  assert.equal(fileDigest(lease), result.lease.input.sha256);
  same([result.owner, result.lease?.owner, result.lease?.runRoot, result.lease?.ports, result.lease?.host],
    [spec.owner, spec.owner, evidence, spec.ports, '127.0.0.1']);
  for (const key of ['sourceBound', 'inputsUnchanged', 'crashPassed', 'databasePassed']) requirePassed(result.checks[key]);
  requirePassed(allTrue(result.checks)); requirePassed(result.leaseRelease?.released);
  assert.equal(result.leaseRelease.owner, spec.owner); requirePassed(result.leaseRelease.dataPreserved);
  assert.equal(result.leaseRelease.reusable, false);
  for (const key of ['runtimeRebuilt', 'runtimePublished', 'release1134Resigned']) assert.equal(result[key], false);
  const refs = new Map();
  const retainReference = ref => {
    if (refs.has(ref.file)) same(ref, refs.get(ref.file), 'evidence changed during inspection');
    refs.set(ref.file, ref); return ref;
  };
  const reference = async file => retainReference(await fileReference(file));
  const rawJson = async file => {
    const captured = captureRuntimeFile(file, { json: true, limit: 32 * 1024 * 1024 });
    retainReference({ file, bytes: captured.bytes, sha256: captured.sha256 });
    return captured.value;
  };
  const configFile = join(round, 'runtime-ta.json'), fixtureFile = join(ROOT, 'test/fixtures/truthsrc-actor-ta.json');
  const config = await rawJson(configFile), configRef = refs.get(configFile), fixtureRef = await reference(fixtureFile);
  same(config, { schemaVersion: 'bank.truthsrc-runtime-ta/v1', ownedRoot: round,
    fixture: { file: fixtureFile, sha256: fixtureRef.sha256 } });
  for (const ref of [configRef, fixtureRef, await reference(lease)]) {
    same(inputs.runtime[ref.file], { bytes: ref.bytes, sha256: ref.sha256 }, 'required runtime input is not sealed');
  }
  const workerEvidence = async (root, invocation, embedded, crash = false) => {
    const inspected = inspectRuntimeWorker({ root, transcript: join(invocation, 'worker.jsonl'), round,
      configSha256: configRef.sha256, fixtureSha256: fixtureRef.sha256, crash, embedded });
    inspected.references.forEach(retainReference);
    return inspected.worker.pid;
  };
  const processEvidence = async (base, embedded, expectedSignal = null) => {
    const inspected = inspectRuntimeProcessEvidence(base, { expectedSignal, ...(embedded === undefined ? {} : { embedded }) });
    inspected.references.forEach(retainReference);
    return inspected.receipt;
  };
  const { RUNTIME_NETWORK_SCOPE, RUNTIME_NETWORK_LIMITATION } = await import('./truthsrc-runtime-sandbox.mjs');
  const boundaryEvidence = async (directory, networkScope, required = []) => {
    const boundary = await rawJson(join(directory, 'boundary.json'));
    same(Object.keys(boundary).sort(), ['before', 'limitation', 'networkScope', 'passed', 'syscallProbe']);
    requirePassed(boundary.passed); assert.equal(boundary.networkScope, networkScope);
    assert.equal(boundary.limitation, networkScope === 'deny-all' ? null : RUNTIME_NETWORK_LIMITATION);
    const process = await processEvidence(join(directory, 'probe'), boundary.syscallProbe);
    assert.equal(process.sandboxProfile, join(directory, 'runtime-sandbox.sb'));
    const requiredFiles = [process.sandboxProfile, join(directory, 'runtime-probe.py'), configFile, ...required];
    for (const file of requiredFiles) assert.ok(Object.hasOwn(boundary.before, file), 'required boundary input is not sealed');
    const canaries = Object.keys(boundary.before).filter(file => !requiredFiles.includes(file));
    assert.equal(canaries.length, 1, 'exact outside canary required');
    for (const [file, expected] of Object.entries(boundary.before)) {
      safePath(file, 'file'); const ref = await reference(file);
      same({ bytes: ref.bytes, sha256: ref.sha256 }, expected, 'boundary input changed');
    }
  };
  await boundaryEvidence(join(evidence, 'crash-boundary'), 'deny-all');
  const { CRASH_CASES } = await import('./truthsrc-runtime-crash.mjs');
  const { validateChildReport, compareRecoveryEvidence } = await import('./v1-crash-recovery.mjs');
  requirePassed(result.crash?.passed); assert.equal(result.crash.count, CRASH_CASES.length);
  assert.equal(result.crash.jvms, CRASH_CASES.length * 3);
  same(result.crash.cases.map(row => row.caseName), [...CRASH_CASES]);
  for (const [index, row] of result.crash.cases.entries()) {
    const caseRoot = join(round, 'case-' + row.caseName), receiptFile = join(caseRoot, 'runtime-receipt.json');
    same(await rawJson(receiptFile), row);
    assert.equal(row.schemaVersion, 'bank.truthsrc-runtime-crash-case/v1');
    assert.equal(row.namespace, 'crash_' + sha256(evidence).slice(0, 16) + '_' + index);
    requirePassed(row.passed); requirePassed(row.sourceBound); assert.equal(row.failure, null); assert.equal(row.release1134Resigned, false);
    same(row.invocations.map(entry => entry.mode), ['crash', 'recover', 'verify']);
    const reports = [];
    for (const entry of row.invocations) {
      const invocation = join(caseRoot, 'runs', entry.mode), crash = entry.mode === 'crash';
      const process = await processEvidence(join(invocation, 'process'), entry.process, crash ? 'SIGKILL' : null);
      same(entry.pid, process.pid);
      const report = validateChildReport(await rawJson(join(invocation, crash ? 'barrier.json' : 'result.json')),
        entry.mode, row, process.pid, crash);
      same(report, entry.report, 'embedded crash report differs from raw child evidence'); reports.push(report);
      const workerPid = await workerEvidence(caseRoot, invocation, entry.worker, crash);
      same(report.evidence.processes, { javaPid: process.pid, nodePid: workerPid, nodePidSource: 'worker.jsonl:worker-started' });
      const closedFile = join(invocation, 'closed.json');
      if (crash) assert.equal(existsSync(closedFile), false, 'crash invocation cannot close normally');
      else same(await rawJson(closedFile), { schemaVersion: 'bank-crash-closed/v1', mode: entry.mode,
        caseName: row.caseName, pid: process.pid, namespace: row.namespace, nodePid: workerPid, workerWaited: true, actorSystemTerminated: true });
    }
    assert.equal(new Set(row.invocations.map(entry => entry.pid)).size, 3, 'three distinct JVMs required');
    compareRecoveryEvidence(reports[1], reports[2]);
  }
  const database = result.database;
  same(await rawJson(join(evidence, 'database/result.json')), database);
  requirePassed(database?.passed); requirePassed(database.browserVerified); requirePassed(database.productionFactory);
  requirePassed(database.cleanup?.stopped); same(database.errors, []);
  same(await rawJson(join(evidence, 'database/database-stop.json')), database.cleanup, 'database close receipt differs');
  assert.equal(database.cleanup.schemaVersion, 'bank.truthsrc-runtime-databases/v1');
  assert.equal(database.cleanup.owner, spec.owner);
  same(database.runs.map(row => row.mode), ['initial', 'restart', 'refund', 'replay']);
  for (const row of database.runs) {
    const run = join(evidence, 'database', row.mode), serviceRoot = join(round, 'service'), invocation = join(serviceRoot, 'runs', row.mode);
    same(await rawJson(join(run, 'result.json')), row);
    await boundaryEvidence(run, RUNTIME_NETWORK_SCOPE, ['integration.conf', 'logback.xml', 'browser.json'].map(name => join(invocation, name)));
    await processEvidence(join(run, 'server'), row.process);
    const server = await rawJson(join(invocation, 'server.json'));
    same([server.pid, server.origin], [row.process.pid, 'http://127.0.0.1:' + spec.ports.http]);
    same(await rawJson(join(invocation, 'closed.json')), { closed: true });
    await workerEvidence(serviceRoot, invocation, row.worker);
    if (row.mode !== 'restart') {
      await processEvidence(join(run, 'browser')); same(await rawJson(join(run, 'browser.stdout.log')), row.browser);
    }
    requirePassed(row.listener?.verified); assert.equal(row.listener.pid, row.process.pid);
    assert.equal(row.listener.host, '127.0.0.1'); assert.equal(row.listener.port, spec.ports.http);
    if (row.mode !== 'restart') { requirePassed(row.browser?.completed); assert.equal(row.browser.mode, row.mode); }
    if (['restart', 'replay'].includes(row.mode)) requirePassed(row.getJournalUnchanged);
  }
  requirePassed(database.runs[0].transport?.journalEventsVerified);
  assert.equal(database.mysqlNegative?.scenarios?.length, 5);
  assert.ok(database.mysqlNegative.scenarios.every(row => row.status === 'passed'));
  await processEvidence(join(evidence, 'database/mysql-negative/process'));
  same(await rawJson(join(evidence, 'database/mysql-negative/result.json')), database.mysqlNegative);
  await reference(join(evidence, 'result.json')); await reference(join(evidence, 'inputs.json'));
  return { passed: true, owner: spec.owner, browserVerified: true, resourcesExited: true,
    inspection: 'static-sealed-evidence', liveResourcesProbed: false, refs: [...refs.values()] };
}

async function checkArchive(file) {
  const ref = await fileReference(file);
  assert.equal(ref.sha256, ARCHIVE_SHA256, 'archive SHA differs; no preparation/generation');
  return ref;
}
const defaults = { current: captureCurrent, doctor, source: compileSource, generate, anchors: verifyAnchors,
  runner: runTool, archive: checkArchive, supply: captureSupply, build: inspectBuild, service: inspectService };

function checkAnchorResult(result) {
  requirePassed(result.passed); requirePassed(allTrue(result.checks));
  assert.match(result.codeDigest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(result.snapshot && result.graph?.snapshot && result.graph?.generation && result.files?.length);
}

function summary(index, checks, diagnostics) {
  const stages = requestedStages(index.through);
  const requestedScopePassed = diagnostics.length === 0 && stages.every(id => index.stages[id]?.status === 'passed' && checks[id] === true);
  return { schemaVersion: 'bank.workshop-report/v1', run: index.run, through: index.through, executionKind: index.executionKind,
    checkedAt: now(), staticSnapshot: true, requestedScopePassed, fullPipelinePassed: requestedScopePassed && index.through === 'service' && index.executionKind === 'real',
    deliveryReady: false, usabilityAccepted: false, onboardingComplete: false,
    snapshot: index.snapshot ?? null, codeDigest: index.codeDigest ?? null,
    stages: STAGES.map(id => ({ id, status: index.stages[id]?.status ?? 'skipped', rechecked: checks[id] === true })), diagnostics,
    runtimeRetryBackoffDeadline: 'OPEN',
    limitations: ['Partial scope is not full bank acceptance.', 'Local hashes are not third-party signatures or hostile-host isolation.',
      'Delivery channel, platform minimum and independent newcomer usability are separate unaccepted gates.'] };
}

// Internal dependency seams are Node-test-only. There is no CLI runner override;
// any overridden execution is labelled test-double and can never be full-pipeline.
export async function verifyWorkshop(options, overrides = {}) {
  const ops = { ...defaults, ...overrides }, root = overrides.root ?? ROOT;
  const run = newRunPath(options.run, root), through = options.through;
  const stages = requestedStages(through), project = join(root, 'truthsrc.project.json');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const index = { schemaVersion: CONTRACT, run, through, project, executionKind: Object.keys(overrides).length ? 'test-double' : 'real',
    startedAt: now(), stages: Object.fromEntries(STAGES.map(id => [id, { status: 'skipped' }])), refs: [], candidates: [], diagnostics: [] };
  let active = 'source', current, supply, source, sequence = 0;
  mkdirSync(run, { mode: 0o700 });
  const attempts = join(run, 'attempts'), attempt = join(attempts, '0001'), results = join(attempt, 'results');
  mkdirSync(attempts, { mode: 0o700 }); mkdirSync(attempt, { mode: 0o700 }); mkdirSync(results, { mode: 0o700 });
  save(join(run, 'run.json'), { schemaVersion: CONTRACT, run, through, project, attempt: '0001', executionKind: index.executionKind, startedAt: index.startedAt });
  const record = async (name, value) => {
    const file = join(results, name + '.json'); save(file, value);
    const reference = await fileReference(file); index.refs.push(reference); return reference;
  };
  const unchanged = async () => { controller.signal.throwIfAborted(); same(await ops.current(), current, 'current input/tool/handwritten closure changed'); };
  const operation = async (id, action) => {
    controller.signal.throwIfAborted();
    const name = String(++sequence).padStart(3, '0') + '-' + id;
    save(join(attempt, name + '.started.json'), { id, startedAt: now() });
    const value = await action(join(attempt, name));
    await record(name, value); return value;
  };
  const candidate = async mode => {
    await unchanged();
    // actorOwnedRoot requires build evidence to be a direct target/ child;
    // include the exclusive run name so its TA root cannot collide across runs.
    const output = join(attempt, mode + '-output'), evidence = join(root, 'target', basename(run) + '-' + mode + '-build');
    await operation(mode + '-generate', () => ops.generate(project, output));
    const verified = await operation(mode + '-anchors', () => ops.anchors(project, output)); checkAnchorResult(verified);
    if (index.codeDigest) same(verified.codeDigest, index.codeDigest, 'fresh generated candidates differ');
    else index.codeDigest = verified.codeDigest;
    if (index.snapshot) same(verified.snapshot, index.snapshot, 'source snapshots differ');
    const row = { mode, output, evidence, snapshot: verified.snapshot, graph: verified.graph, codeDigest: verified.codeDigest,
      files: verified.files, built: false };
    index.candidates.push(row); await unchanged(); return row;
  };
  const build = async row => {
    await unchanged();
    await operation(row.mode + '-execute', base => ops.runner({ script: 'verify-truthsrc-build.mjs', base, signal: controller.signal,
      args: ['--project-output', row.output, '--archive', options.archive, '--evidence', row.evidence,
        '--java-home', options.javaHome ?? DEFAULT_JAVA_HOME,
        row.mode === 'runtime' ? '--compile-runtime-tests' : row.mode === 'actor' ? '--run-actor-tests' : '--run-readside-tests'] }));
    const checked = await operation(row.mode + '-build', () => ops.build({ ...row, source }));
    requirePassed(checked.passed); row.built = true; index.refs.push(...checked.refs);
    const post = await operation(row.mode + '-anchors-after', () => ops.anchors(project, row.output)); checkAnchorResult(post);
    same(post.codeDigest, index.codeDigest); same(post.files, row.files); await unchanged();
  };
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    // run is already exclusively claimed; preflight must not treat it as reusable.
    const { run: _run, ...preflightOptions } = options;
    const preflight = await ops.doctor({ ...preflightOptions, probeResources: through === 'service' });
    await record('preflight', preflight);
    if (!preflight.passed) {
      const blocked = preflight.checks?.find(row => row.status === 'blocked')?.id;
      active = ['archive', 'public-verifier'].includes(blocked) ? 'anchors'
        : ['platform', 'jdk11', 'sandbox-python'].includes(blocked) ? 'code'
        : ['lease', 'browser', 'docker', 'ports-free-now', 'pinned-images'].includes(blocked) ? 'service' : 'source';
    }
    requirePassed(preflight.passed);
    if (stages.includes('code')) {
      for (const mode of through === 'service' ? ['actor', 'readside', 'runtime'] : ['actor', 'readside']) {
        const evidence = join(root, 'target', basename(run) + '-' + mode + '-build');
        checkedPath(evidence, 'planned'); assert.ok(!existsSync(evidence), 'build evidence already exists');
        if (mode === 'actor') {
          const round = join(root, '.local/mock-ta', 'truthsrc-actors-' + basename(evidence));
          checkedPath(round, 'planned'); assert.ok(!existsSync(round), 'actor TA round already exists');
        }
      }
    }
    if (stages.includes('anchors')) {
      await ops.archive(options.archive);
      assert.ok(!within(run, options.archive), 'archive cannot be inside the new run');
    }
    if (through === 'service') {
      const metadata = leaseMetadata(options.lease, { root, run });
      index.runtime = { evidence: metadata.spec.runRoot, round: metadata.round, lease: options.lease };
    }
    current = await ops.current(); index.current = await record('current-inputs', current);
    source = await operation('source', () => ops.source(project));
    requirePassed(source.passed); requirePassed(source.strictCompile?.passed); requirePassed(source.roundtrip?.ok);
    same(source.validation?.hard, []); index.snapshot = source.snapshot;
    index.source = index.refs.at(-1); await unchanged(); index.stages.source.status = 'passed';
    if (stages.includes('anchors')) {
      active = 'anchors';
      await operation('prepare', base => ops.runner({ script: 'prepare-truthsrc-runtime.mjs', args: ['--archive', options.archive], base, signal: controller.signal }));
      supply = await ops.supply(options.archive); index.supply = await record('supply', supply);
      const first = await candidate(stages.includes('code') ? 'actor' : 'anchors');
      index.stages.anchors.status = 'passed';
      if (stages.includes('code')) {
        active = 'code'; await build(first); await build(await candidate('readside')); index.stages.code.status = 'passed';
      }
      if (through === 'service') {
        active = 'service'; const runtime = await candidate('runtime'); await build(runtime);
        const { readRuntimeLease } = await import('./truthsrc-runtime-lease.mjs');
        // Final authoritative lease validation after the compile evidence exists.
        if (index.executionKind === 'real') readRuntimeLease({ ...index.runtime, buildEvidence: runtime.evidence });
        await operation('service-execute', base => ops.runner({ script: 'verify-truthsrc-runtime.mjs', base, signal: controller.signal,
          args: ['--lease', options.lease, '--build-evidence', runtime.evidence, '--evidence', index.runtime.evidence,
            '--round', index.runtime.round, '--window', 'all', '--browser-module', options.browserModule, '--browser-executable', options.browserExecutable] }));
        const checked = await operation('service', () => ops.service({ ...index.runtime, buildEvidence: runtime.evidence }));
        requirePassed(checked.passed); index.refs.push(...checked.refs); index.stages.service.status = 'passed';
      }
      same(await ops.supply(options.archive), supply, 'frozen supply changed during verification');
    }
    await unchanged();
  } catch (error) {
    save(join(attempt, 'failure.json'), { stage: active, name: error.name, code: error.code ?? null,
      message: error.message ?? 'stage failed', privateDiagnostic: true });
    index.stages[active].status = 'failed';
    index.diagnostics.push({ code: controller.signal.aborted ? 'WORKSHOP_CANCELLED' : 'WORKSHOP_STAGE_FAILED', stage: active,
      message: 'Required gate failed or was blocked. Inspect the private attempt receipts; downstream stages were not substituted.',
      next: 'Retain this run and all owner data. Resolve the recorded prerequisite or source conflict, then choose a new run and (for service) a new owner.' });
  } finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    index.finishedAt = now();
    save(join(attempt, 'completed.json'), { startedAt: index.startedAt, finishedAt: index.finishedAt, stages: index.stages, diagnostics: index.diagnostics });
    index.refs.push(await fileReference(join(run, 'run.json')), await fileReference(join(attempt, 'completed.json')));
    save(join(run, 'results.json'), index);
  }
  // Only verify publishes a shareable snapshot, AFTER the final read-only recheck.
  // Never copy private process/worker logs, failure messages or raw runtime results.
  const report = await reportWorkshop({ run }, overrides);
  const reportFile = join(run, 'report.json'), markdownFile = join(run, 'report.md');
  for (const file of [reportFile, markdownFile]) {
    checkedPath(file, 'planned'); assert.ok(!existsSync(file), 'exclusive report already exists');
  }
  save(reportFile, report);
  writeFileSync(markdownFile, [
    '# Bank workshop verification', '',
    `Static snapshot checked at ${report.checkedAt}. Run report again to recheck; these files are never refreshed in place.`, '',
    `- Requested scope: ${report.through} (${report.requestedScopePassed ? 'passed' : 'not passed'})`,
    `- Full pipeline: ${report.fullPipelinePassed ? 'passed' : 'not passed'}`,
    `- Execution: ${report.executionKind}`,
    '- Delivery, usability and onboarding acceptance: not completed', '',
    '| Stage | Recorded status | Static recheck |', '| --- | --- | --- |',
    ...report.stages.map(row => `| ${row.id} | ${row.status} | ${row.rechecked ? 'passed' : 'not passed/not run'} |`), '',
    ...report.diagnostics.map(row => `- ${row.code}: ${row.message}`), '',
    'Runtime retry/backoff/deadline: OPEN.',
    ...report.limitations.map(text => '- ' + text), '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  return report;
}

export async function reportWorkshop({ run }, overrides = {}) {
  const ops = { ...defaults, ...overrides }, root = overrides.root ?? ROOT;
  newRunPath(run, root, true);
  const start = readJson(join(run, 'run.json'));
  same(start.schemaVersion, CONTRACT); same(start.run, run);
  const missing = !existsSync(join(run, 'results.json'));
  const index = missing ? { ...start, stages: {}, refs: [], diagnostics: [{ code: 'WORKSHOP_INCOMPLETE', message: 'No sealed results. Attempt records are retained; no automatic resume.' }] } : readJson(join(run, 'results.json'));
  same([index.schemaVersion, index.run, index.through, index.project, index.executionKind],
    [CONTRACT, run, start.through, start.project, start.executionKind]);
  requestedStages(index.through);
  const checks = {}, diagnostics = [...index.diagnostics];
  try {
    assert.ok(!missing);
    assert.ok(Array.isArray(index.refs) && index.refs.length > 0);
    for (const ref of index.refs) same(await fileReference(ref.file), ref, 'receipt bytes changed/missing');
    same(readJson(join(run, 'attempts/0001/completed.json')).stages, index.stages, 'stage statuses differ from sealed attempt');
    const current = readJson(index.current.file); same(await ops.current(), current, 'current inputs/tool/handwritten dependencies changed');
    const source = readJson(index.source.file);
    requirePassed(source.passed); requirePassed(source.strictCompile?.passed); requirePassed(source.roundtrip?.ok); same(source.validation?.hard, []);
    checks.source = true;
    const required = requestedStages(index.through);
    if (required.includes('anchors')) {
      const supply = readJson(index.supply.file);
      same(await ops.supply(supply.archive.file), supply, 'current frozen dependencies changed');
      const modes = index.through === 'anchors' ? ['anchors'] : index.through === 'code' ? ['actor', 'readside'] : ['actor', 'readside', 'runtime'];
      same(index.candidates.map(row => row.mode), modes, 'missing/foreign candidate stage');
      for (const row of index.candidates) {
        assert.equal(row.output, join(run, 'attempts/0001', row.mode + '-output'));
        assert.equal(row.evidence, join(root, 'target', basename(run) + '-' + row.mode + '-build'));
        const verified = await ops.anchors(index.project, row.output); checkAnchorResult(verified);
        same([verified.snapshot, verified.codeDigest, verified.files], [index.snapshot, index.codeDigest, row.files]);
        same(verified.graph, row.graph);
        if (row.mode !== 'anchors') { requirePassed(row.built); requirePassed((await ops.build({ ...row, source })).passed); }
      }
      checks.anchors = true;
      if (required.includes('code')) checks.code = true;
      if (required.includes('service')) {
        const lease = readJson(index.runtime.lease);
        assert.equal(index.runtime.evidence, join(root, 'target', 'truthsrc-runtime-' + lease.owner));
        assert.equal(index.runtime.round, join(root, '.local/mock-ta', 'truthsrc-runtime-' + lease.owner));
        requirePassed((await ops.service({ ...index.runtime, buildEvidence: index.candidates.find(row => row.mode === 'runtime').evidence })).passed);
        checks.service = true;
      }
    }
    // Recheck after read-only validation too; parallel edits never become green.
    same(await ops.current(), current);
  } catch {
    diagnostics.push({ code: 'WORKSHOP_RECHECK_FAILED', message: 'Evidence is incomplete, stale, changed or did not meet its stage contract. Nothing was rerun or repaired.' });
  }
  return summary(index, checks, diagnostics);
}
