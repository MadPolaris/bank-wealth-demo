import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR_SUPPORT, ACTOR_WORKER, actorOwnedRoot, actorTestManifest, combineActorManifest, verifyActorWorkers } from '../tools/truthsrc-actor-tests.mjs';
import { buildTasks, completeGeneratedTests, inspectGeneratedTests, parseArgs } from '../tools/verify-truthsrc-build.mjs';
import { canonicalJson, digest } from '../simulator/contract.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const actors = actorTestManifest();
const generated = { suites: [
  ['GeneratedActorStateSpec', 3], ['GeneratedDomainRoundtripSpec', 5], ['GeneratedFiniteHostSpec', 0],
  ['example.bankwealth.service.GeneratedServiceConfigurationSpec', 11], ['example.bankwealth.service.GeneratedUnitStorageSpec', 4],
].map(([name, count]) => ({ name, file: 'src/test/scala/' + name.split('.').at(-1) + '.scala', sha256: 'a'.repeat(64),
  tests: Array.from({ length: count }, (_, i) => 'generated ' + i) })), suiteCount: 5, testCount: 23, zeroTestSuites: ['GeneratedFiniteHostSpec'] };
const combined = combineActorManifest(generated, actors);
const args = ['--project-output', ROOT + '/target/new-candidate', '--archive', ROOT + '/dist/test.tar.gz', '--evidence', ROOT + '/target/new-evidence'];

test('eight frozen business suites provide 41 assertions and explicit four-flow ownership', () => {
  assert.equal(actors.suiteCount, 8); assert.equal(actors.testCount, 41);
  assert.deepEqual(Object.fromEntries(['payment', 'ta', 'refund', 'sip'].map(flow => [flow,
    actors.suites.filter(s => s.flow === flow).reduce((n, s) => n + s.tests.length, 0)])), { payment: 6, ta: 8, refund: 7, sip: 20 });
  assert.equal(combined.suiteCount, 13); assert.equal(combined.testCount, 64);
  assert.equal(combined.businessTests, 41); assert.equal(combined.generatedTests, 23);
  assert.deepEqual(combined.zeroTestSuites, ['GeneratedFiniteHostSpec']);
  const refunds = actors.suites.find(suite => suite.name === 'BankRefundApplicationSpec');
  assert.equal(refunds.tests.filter(name => name.startsWith('REFUND-automatic-recovery:')).length, 3);
  for (const suite of actors.suites) assert.equal(suite.sha256, createHash('sha256').update(readFileSync(suite.file)).digest('hex'));
});

test('business manifest rejects a removed test, renamed class and changed dynamic expansion', () => {
  for (const transform of [
    (file, text) => file.endsWith('/BankTaApplicationSpec.scala') ? text.replace('  test(', '  ignore(') : text,
    (file, text) => file.endsWith('/BankSipApplicationSpec.scala') ? text.replace('final class BankSipApplicationSpec extends', 'final class OtherSpec extends') : text,
    (file, text) => file.endsWith('/BankRefundApplicationSpec.scala') ? text.replace('Vector("prepare", "collection-commit", "investor-commit")', 'Vector("prepare")') : text,
  ]) assert.throws(() => actorTestManifest(file => transform(file, readFileSync(file, 'utf8'))));
});

test('actor execution requires an exclusive explicit flag and keeps generated-only defaults', () => {
  const options = parseArgs([...args, '--run-actor-tests']);
  assert.equal(options.runActors, true); assert.equal(options.runTests, true); assert.equal(options.compileTests, true);
  assert.equal(parseArgs(args).runActors, false);
  assert.equal(parseArgs([...args, '--run-generated-tests']).runActors, false);
  assert.throws(() => parseArgs([...args, '--run-actor-tests', '--run-generated-tests']), /choose one/);
  assert.throws(() => parseArgs([...args, '--run-actor-tests', '--run-actor-tests']), /Usage/);
  const actor = { node: '/owned/node', worker: ACTOR_WORKER, ownedRoot: actorOwnedRoot(ROOT + '/target/actor-test') };
  const testFiles = [...generated.suites.map(s => s.file), 'src/test/scala/UnitConfigurationCheck.scala'];
  const tasks = buildTasks(testFiles, options, combined, actor);
  assert.equal(tasks.at(-1), 'Test / test');
  for (const suite of actors.suites) assert.ok(tasks[1].includes('file(' + JSON.stringify(suite.file) + ')'));
  assert.ok(tasks.some(t => t.includes('-Dbank.mock-ta.node=/owned/node')));
  assert.ok(tasks.at(-2).includes('(Test / sources).value') && tasks.at(-2).includes('TRUTHSRC-ACTOR-SOURCES='));
  assert.ok(tasks.every(t => !/testOnly|runMain|Test \/ fork :=|UnitNoNetwork/.test(t)));
  const ordinary = buildTasks(testFiles, parseArgs([...args, '--run-generated-tests']), generated);
  assert.ok(ordinary.every(t => !t.includes(join(ROOT, 'test/scala')) && !t.includes('bank.mock-ta')));
});

test('actor round derives only from a direct new bank evidence name', () => {
  assert.equal(actorOwnedRoot(ROOT + '/target/actors-01'), ROOT + '/.local/mock-ta/truthsrc-actors-actors-01');
  for (const file of ['/elsewhere/evidence', ROOT + '/target/sub/nested', ROOT + '/target/bad name']) assert.throws(() => actorOwnedRoot(file));
});

function successfulOutput() {
  return ['TRUTHSRC-GENERATED-SUITES=' + combined.suites.map(s => s.name).sort().join(','),
    'UNIT-CONFIGURATION-OK journal=testkit snapshot=testkit network=denied', 'UNIT-JVM-PID=200',
    'Run starting. Expected test count is: 64',
    ...combined.suites.flatMap(s => [s.name.split('.').at(-1) + ':', ...s.tests.map(n => '- ' + n)]),
    'Total number of tests run: 64', 'Suites: completed 13, aborted 0',
    'Tests: succeeded 64, failed 0, canceled 0, ignored 0, pending 0', 'All tests passed.'].join('\n');
}
test('full actor test observation cannot pass without actor source, worker and boundary evidence', () => {
  const report = inspectGeneratedTests(successfulOutput(), combined, 100);
  assert.equal(report.passed, true); assert.equal(report.testsObserved, 64);
  const checks = Object.fromEntries(['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
    'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried', 'verifierUnchanged',
    'actualBuildSourcesVerified', 'actorInputsUnchanged', 'actorWorkersVerified', 'actorBoundaryEnforced', 'actualTestSourcesVerified'].map(n => [n, true]));
  const process = { code: 0, directChildReaped: true, terminationErrors: [] };
  assert.equal(completeGeneratedTests(report, process, checks).passed, true);
  for (const key of Object.keys(checks)) assert.equal(completeGeneratedTests(report, process, { ...checks, [key]: false }).passed, false);
  const missing = successfulOutput().replace('- ' + actors.suites[0].tests[0] + '\n', '');
  assert.equal(inspectGeneratedTests(missing, combined, 100).passed, false);
});

const write = (file, value) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
function lifecycleFixture() {
  const ownedRoot = mkdtempSync(join(realpathSync(tmpdir()), 'truthsrc-actor-lifecycle-'));
  const actor = { ownedRoot, configSha256: 'a'.repeat(64), fixtureSha256: 'b'.repeat(64), configurationDigest: 'c'.repeat(64) };
  for (const file of ['actor-owner.json', 'actor-ta.json']) write(join(ownedRoot, file), {});
  write(join(ownedRoot, 'sandbox-write-probe'), 'allowed\n');
  let pid = 50000;
  const transcriptFiles = [];
  for (let i = 0; i < 15; i++) {
    const owner = join(ownedRoot, 'owner-b-application-' + i); mkdirSync(owner);
    const body = { schemaVersion: 'bank-wealth.mock-ta-journal/v1', seq: 1, configDigest: actor.configurationDigest,
      previousHash: null, event: { kind: 'Initialized', tick: 0 } };
    write(join(owner, 'ta.jsonl'), canonicalJson({ ...body, recordHash: digest(canonicalJson(body)) }) + '\n');
    for (let round = 0; round < (i === 0 ? 2 : 1); round++) {
      pid++;
      const base = round === 0 ? 'worker' : 'worker-reopened-621d5b52-ef7d-49bc-a5c5-a59b7fbc22ce';
      const transcript = join(owner, base + '.jsonl');
      const rows = [{ kind: 'worker-started', pid }, { id: 0, op: 'close', input: null },
        { id: 0, ok: true, result: { closed: true } }, { kind: 'worker-exited', pid, waited: true, exitCode: 0 }];
      write(transcript, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
      write(join(owner, base + '.stderr.log'), '');
      write(join(owner, 'ta-worker-' + pid + '.json'), { schemaVersion: 'bank.truthsrc-actor-ta-worker/v1', pid,
        journalPath: join(owner, 'ta.jsonl'), ownedRoot: owner, roundRoot: ownedRoot, configSha256: actor.configSha256,
        fixtureSha256: actor.fixtureSha256, configurationDigest: actor.configurationDigest, closed: true });
      transcriptFiles.push(transcript);
    }
  }
  return { actor, transcriptFiles };
}

test('worker verifier requires 15 journals, 16 attested clean exits and matching configuration', () => {
  const { actor } = lifecycleFixture();
  const result = verifyActorWorkers(actor, () => false);
  assert.equal(result.passed, true); assert.equal(result.journalCount, 15); assert.equal(result.workerCount, 16);
  assert.throws(() => verifyActorWorkers(actor, () => true), /remains alive/);
  assert.throws(() => verifyActorWorkers({ ...actor, fixtureSha256: 'd'.repeat(64) }, () => false));
});

test('worker verifier refuses abnormal exits and unowned output', () => {
  const { actor, transcriptFiles } = lifecycleFixture();
  const file = transcriptFiles[0];
  writeFileSync(file, readFileSync(file, 'utf8').replace('"exitCode":0', '"exitCode":1'));
  assert.throws(() => verifyActorWorkers(actor, () => false));
  const other = lifecycleFixture(); write(join(other.actor.ownedRoot, 'unexpected'), 'foreign');
  assert.throws(() => verifyActorWorkers(other.actor, () => false));
});

test('worker closure names only explicit core, not the historical loader', () => {
  assert.ok(ACTOR_SUPPORT.some(file => file.endsWith('/mock-ta-core.mjs')));
  assert.ok(!ACTOR_SUPPORT.some(file => file.endsWith('/truth-source.mjs')));
  const source = readFileSync(ACTOR_WORKER, 'utf8');
  assert.ok(!source.includes('loadSnapshot('));
  assert.match(source, /BANK_ACTOR_TA_CONFIG_SHA256/);
});
