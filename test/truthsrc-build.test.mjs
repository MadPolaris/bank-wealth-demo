import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { actualBuildSourceRoot, buildTasks, command, compareBuildSources, completeGeneratedTests, generatedTestManifest, inspectGeneratedTests, isMainModule, parseArgs, plannedAnchorLocations, sortedAnchorLocations } from '../tools/verify-truthsrc-build.mjs';

const cli = fileURLToPath(new URL('../tools/verify-truthsrc-build.mjs', import.meta.url));
const args = ['--project-output', '/unused/generated', '--archive', '/unused/clean.tar.gz', '--evidence', '/unused/evidence'];
const suites = [
  ['GeneratedActorStateSpec', 3],
  ['GeneratedDomainRoundtripSpec', 5],
  ['GeneratedFiniteHostSpec', 0],
  ['example.bankwealth.service.GeneratedServiceConfigurationSpec', 11],
  ['example.bankwealth.service.GeneratedUnitStorageSpec', 4],
];
const entries = [
  { path: 'src/test/scala/UnitConfigurationCheck.scala', content: 'fixture unit runner\n' },
  ...suites.map(([name, count]) => ({
    path: 'src/test/scala/' + name.split('.').at(-1) + '.scala',
    content: (name.includes('.') ? 'package ' + name.slice(0, name.lastIndexOf('.')) + '\n' : '') +
      'final class ' + name.split('.').at(-1) + ' extends AnyFunSuite {\n' +
      Array.from({ length: count }, (_, i) => '  test(' + JSON.stringify('check ' + i + ' with "quoted" value') + ') {\n    assert(true)\n  }\n').join('') + '}\n',
  })),
];
const manifest = generatedTestManifest(entries);
const configuration = 'UNIT-CONFIGURATION-OK journal=testkit snapshot=testkit network=denied';
function stdout({ prefix = '' } = {}) {
  return [
    'TRUTHSRC-GENERATED-SUITES=' + suites.map(([name]) => name).join(','),
    configuration, 'UNIT-JVM-PID=101', 'Run starting. Expected test count is: 23',
    ...manifest.suites.flatMap(suite => [suite.name.split('.').at(-1) + ':', ...suite.tests.map(name => '- ' + name)]),
    'Run completed in 3 seconds.', 'Total number of tests run: 23', 'Suites: completed 5, aborted 0',
    'Tests: succeeded 23, failed 0, canceled 0, ignored 0, pending 0', 'All tests passed.',
  ].map(line => prefix + line).join('\n') + '\n';
}

for (const [name, flags, compileTests, runTests] of [
  ['default compiles only main sources', [], false, false],
  ['compile flag never executes tests', ['--compile-generated-tests'], true, false],
  ['execution implies compilation', ['--run-generated-tests'], true, true],
  ['both explicit flags are order-independent', ['--run-generated-tests', '--compile-generated-tests'], true, true],
]) test(name, () => {
  const parsed = parseArgs([...args, ...flags]);
  assert.equal(parsed.compileTests, compileTests);
  assert.equal(parsed.runTests, runTests);
  const tasks = buildTasks(manifest.suites.map(s => s.file), parsed, runTests ? manifest : null);
  assert.equal(tasks.includes('Test / compile'), compileTests);
  assert.equal(tasks.includes('Test / test'), runTests);
  if (runTests) {
    assert.equal(tasks.at(-1), 'Test / test');
    assert.match(tasks.at(-2), /require\(suites == Seq/);
    assert.match(tasks.at(-2), /\(Test \/ definedTests\)\.value/);
    assert.ok(tasks.at(-2).includes('TRUTHSRC-GENERATED-SUITES='));
  }
  assert.ok(tasks.every(task => !/testOnly|runMain|Test \/ fork|UnitNoNetwork|v1\/test/.test(task)));
});

test('CLI rejects duplicate flags, arbitrary tasks, unknown switches and incomplete paths', () => {
  for (const extra of [
    ['--run-generated-tests', '--run-generated-tests'], ['--compile-generated-tests', '--compile-generated-tests'],
    ['--project-output', '/other'], ['--task', 'test'], ['--test'], ['--runMain', 'Example'], ['--java-home'], ['Test / test'],
  ]) assert.throws(() => parseArgs([...args, ...extra]), /Usage:/);
  assert.throws(() => parseArgs(['--run-generated-tests']), /Usage:/);
  assert.equal(parseArgs(['--help']), null);
});

test('CLI help and unknown task refusal do not enter admission or start JVMs', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0); assert.equal(help.stderr, '');
  assert.match(help.stdout, /--run-generated-tests/);
  const bad = spawnSync(process.execPath, [cli, ...args, '--task', 'test'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /Usage:/); assert.equal(bad.stdout, '');
});

test('generated manifest preserves five suites, literal names and the empty finite suite', () => {
  assert.equal(manifest.suiteCount, 5); assert.equal(manifest.testCount, 23);
  assert.deepEqual(manifest.zeroTestSuites, ['GeneratedFiniteHostSpec']);
  assert.equal(manifest.suites[0].tests[0], 'check 0 with "quoted" value');
  assert.ok(manifest.suites.every(suite => /^[0-9a-f]{64}$/.test(suite.sha256)));
  assert.deepEqual(generatedTestManifest([...entries].reverse()), manifest);
});

test('manifest refuses missing, extra, renamed, duplicate and changed test inputs', () => {
  const edits = [
    rows => rows.pop(),
    rows => rows.push({ path: 'src/test/scala/HistoricalSpec.scala', content: 'not admitted' }),
    rows => { rows[1].content = rows[1].content.replace('GeneratedActorStateSpec', 'ChangedSpec'); },
    rows => { rows[1].content = 'package unexpected\n' + rows[1].content; },
    rows => { rows[1].content = rows[1].content.replace('  test("check 2', '  ignore("check 2'); },
    rows => { rows[1].content = rows[1].content.replace('check 2 with', 'check 1 with'); },
    rows => rows.push({ ...rows[1] }),
  ];
  for (const edit of edits) {
    const rows = structuredClone(entries); edit(rows);
    assert.throws(() => generatedTestManifest(rows));
  }
  assert.throws(() => buildTasks([], { runTests: true }), /manifest required/);
  assert.throws(() => buildTasks([], { runTests: true }, { suites: [] }), /manifest required/);
});

test('successful report requires actual fork, all named tests and zero failures', () => {
  for (const output of [stdout(), stdout({ prefix: '[info] ' }), '\x1b[32m' + stdout().replaceAll('\n', '\x1b[0m\n\x1b[32m')]) {
    const report = inspectGeneratedTests(output, manifest, 100);
    assert.deepEqual(report.errors, []);
    assert.equal(report.passed, true); assert.equal(report.started, true); assert.equal(report.completed, true);
    assert.equal(report.unitJvmPid, 101); assert.equal(report.testsObserved, 23);
    assert.deepEqual(report.totals, { run: 23, suitesCompleted: 5, suitesAborted: 0, succeeded: 23, failed: 0, canceled: 0, ignored: 0, pending: 0 });
  }
});

for (const [name, mutate] of [
  ['compile-only output', () => '[success] Total time: 60 s\n'],
  ['missing suite discovery', s => s.replace(/^TRUTHSRC-GENERATED-SUITES=.*\n/, '')],
  ['unexpected discovered suite', s => s.replace('TRUTHSRC-GENERATED-SUITES=GeneratedActorStateSpec', 'TRUTHSRC-GENERATED-SUITES=ForeignSpec')],
  ['missing unit boundary', s => s.replace(configuration, '')],
  ['missing fork marker', s => s.replace('UNIT-JVM-PID=101', '')],
  ['same JVM as sbt', s => s.replace('UNIT-JVM-PID=101', 'UNIT-JVM-PID=100')],
  ['missing ScalaTest start', s => s.replace('Run starting. Expected test count is: 23', '')],
  ['wrong expected count', s => s.replace('Expected test count is: 23', 'Expected test count is: 22')],
  ['missing empty suite', s => s.replace('GeneratedFiniteHostSpec:\n', '')],
  ['different suite of same count', s => s.replace('GeneratedActorStateSpec:\n', 'UnrelatedSpec:\n')],
  ['missing named test', s => s.replace('- check 0 with "quoted" value\n', '')],
  ['duplicate named test', s => s.replace('- check 0 with "quoted" value\n', '- check 0 with "quoted" value\n- check 0 with "quoted" value\n')],
  ['failed named test', s => s.replace('- check 0 with "quoted" value', '- check 0 with "quoted" value *** FAILED ***')],
  ['missing completion', s => s.replace('All tests passed.', '')],
  ['suite abort', s => s.replace('completed 5, aborted 0', 'completed 4, aborted 1')],
  ['failed count', s => s.replace('succeeded 23, failed 0', 'succeeded 22, failed 1')],
  ['canceled count', s => s.replace('canceled 0', 'canceled 1')],
  ['ignored count', s => s.replace('ignored 0', 'ignored 1')],
  ['pending count', s => s.replace('pending 0', 'pending 1')],
  ['wrong executed count', s => s.replace('tests run: 23', 'tests run: 22')],
  ['second run', s => s + s],
]) test('report refuses ' + name, () => {
  const report = inspectGeneratedTests(mutate(stdout()), manifest, 100);
  assert.equal(report.passed, false); assert.ok(report.errors.length > 0);
});

test('aborted run records started separately from completed and passed', () => {
  const text = stdout().split('Total number of tests run:')[0];
  const report = inspectGeneratedTests(text, manifest, 100);
  assert.equal(report.started, true); assert.equal(report.completed, false); assert.equal(report.passed, false);
});

test('compile-only modes do not impose the pinned execution manifest', () => {
  const changed = entries.map(entry => ({ ...entry, content: entry.content.replace('  test(', '  changedTest(') }));
  assert.equal(generatedTestManifest(changed, { runTests: false }), null);
  assert.equal(generatedTestManifest([], { runTests: false }), null);
  assert.throws(() => generatedTestManifest(changed, { runTests: true }));
});

test('CLI invoked through a symlink still handles help and rejects arbitrary tasks', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'truthsrc-verifier-cli-'));
  const link = join(root, 'verify.mjs'); symlinkSync(cli, link);
  assert.equal(isMainModule(link, pathToFileURL(cli).href), true);
  assert.equal(isMainModule(undefined, pathToFileURL(cli).href), false);
  assert.equal(isMainModule(fileURLToPath(import.meta.url), pathToFileURL(cli).href), false);
  const help = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0); assert.match(help.stdout, /Usage:/);
  const bad = spawnSync(process.execPath, [link, ...args, '--task', 'test'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /Usage:/);
});

const checks = Object.fromEntries(['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
  'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried', 'verifierUnchanged',
  'actualBuildSourcesVerified'].map(name => [name, true]));
const goodReceipt = { pid: 100, code: 0, signal: null, launchError: null, timedOut: false, cancelled: null,
  directChildClosed: true, directChildReaped: true, leftoverGroup: false, groupAliveAfter: false };

test('source-bound completion requires both successful process and every final protection check', () => {
  const observation = inspectGeneratedTests(stdout(), manifest, 100);
  assert.equal(completeGeneratedTests(observation, goodReceipt, checks).passed, true);
  for (const patch of [{ code: 1 }, { signal: 'SIGTERM' }, { launchError: 'EIO' }, { timedOut: true }, { cancelled: 'SIGINT' },
    { directChildReaped: false }, { leftoverGroup: true }, { groupAliveAfter: true }, { terminationErrors: [{ error: 'EPERM' }] }]) {
    const report = completeGeneratedTests(observation, { ...goodReceipt, ...patch }, checks);
    assert.equal(report.outputPassed, true); assert.equal(report.processPassed, false); assert.equal(report.passed, false);
  }
  for (const key of Object.keys(checks)) {
    for (const value of [false, undefined]) {
      const report = completeGeneratedTests(observation, goodReceipt, { ...checks, [key]: value });
      assert.equal(report.outputPassed, true); assert.equal(report.sourceBound, false); assert.equal(report.passed, false);
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) assert.equal(completeGeneratedTests(observation, goodReceipt, checks, signal).passed, false);
  assert.equal(completeGeneratedTests(observation, goodReceipt, checks, null, ['evidence write failed']).passed, false);
  assert.equal(completeGeneratedTests(observation, undefined, checks).passed, false);
});

test('unavailable execution evidence remains unknown rather than falsely not executed', () => {
  const report = completeGeneratedTests({ requested: true, evidenceState: 'unavailable', jvmStarted: null, started: null,
    completed: null, passed: false, errors: ['EIO reading test log'] }, goodReceipt, checks);
  assert.equal(report.passed, false); assert.equal(report.started, null); assert.equal(report.completed, null);
  assert.equal(report.evidenceState, 'unavailable');
});

for (const signal of ['SIGINT', 'SIGTERM']) test('pending ' + signal + ' during synchronous final work is observed before sealing', () => {
  const source = `import { drainPendingSignals } from ${JSON.stringify(pathToFileURL(cli).href)};
let cancellation = null;
const handler = () => { cancellation = ${JSON.stringify(signal)}; };
process.on(${JSON.stringify(signal)}, handler);
process.kill(process.pid, ${JSON.stringify(signal)});
const until = Date.now() + 80;
while (Date.now() < until) {}
await drainPendingSignals();
if (cancellation !== ${JSON.stringify(signal)}) throw new Error('pending cancellation lost');
process.off(${JSON.stringify(signal)}, handler);
console.log('CANCELLED-BEFORE-RECEIPT');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /CANCELLED-BEFORE-RECEIPT/);
});

test('sandboxed command supervisor rejects success output followed by timeout or a leftover process group', {
  skip: process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'),
}, async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'truthsrc-verifier-supervision-'));
  const profile = join(root, 'sandbox.sb');
  const text = '(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write* (subpath ' + JSON.stringify(root) + ') (literal "/dev/null"))\n';
  writeFileSync(profile, text, { flag: 'wx', mode: 0o600 });
  const sandbox = { executable: '/usr/bin/sandbox-exec', profile, profileSha256: createHash('sha256').update(text).digest('hex') };
  const env = { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' };
  for (const kind of ['timeout', 'leftover']) {
    const source = `import { spawn } from 'node:child_process';
process.stdout.write(${JSON.stringify(stdout())});
` + (kind === 'timeout' ? 'setInterval(() => {}, 1000);' :
      `spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 500)'], { detached: false, stdio: 'ignore', env: process.env });
process.exit(0);`);
    const base = join(root, kind);
    const receipt = await command(process.execPath, ['--input-type=module', '-e', source], root, env, base, 1500, sandbox);
    assert.equal(receipt.directChildReaped, true); assert.equal(receipt.groupAliveAfter, false);
    assert.equal(kind === 'timeout' ? receipt.timedOut : receipt.leftoverGroup, true);
    const observation = inspectGeneratedTests(readFileSync(base + '.stdout.log', 'utf8'), manifest, receipt.pid);
    assert.equal(observation.passed, true);
    const report = completeGeneratedTests(observation, receipt, checks);
    assert.equal(report.outputPassed, true); assert.equal(report.passed, false); assert.equal(report.processPassed, false);
  }
  t.diagnostic('Owned supervisor receipts retained at ' + root);
});

test('anchor admission preserves multiple exact spans for one knowledge key in one file', () => {
  const first = { start: 0, end: 3, text: 'one' }, second = { start: 4, end: 7, text: 'two' };
  const entry = { path: 'Domain.scala', knowledgeIds: ['knowledge:a', 'knowledge:b'], codeMappings: [
    { knowledgeKey: 'knowledge:a', span: first }, { knowledgeKey: 'knowledge:a', span: second }
  ] };
  const planned = plannedAnchorLocations([entry]);
  assert.deepEqual(planned.get('knowledge:a'), [{ file: entry.path, span: first }, { file: entry.path, span: second }]);
  assert.deepEqual(planned.get('knowledge:b'), [{ file: entry.path, span: null }]);
  assert.deepEqual(sortedAnchorLocations([...planned.get('knowledge:a')].reverse()), planned.get('knowledge:a'));
  assert.notDeepEqual(sortedAnchorLocations([{ file: entry.path, span: first }]), planned.get('knowledge:a'));
  assert.notDeepEqual(sortedAnchorLocations([{ file: entry.path, span: null }]), planned.get('knowledge:a'));
});

test('actual sbt source must be the candidate or its fresh owned staging copy', () => {
  const out = '/owned/target/candidate', evidence = '/owned/target/evidence';
  const line = root => '[info] loading project definition from ' + root + '/project\n';
  assert.equal(actualBuildSourceRoot(line(out), out, evidence), out);
  const staged = evidence + '/global/staging/a10b/candidate';
  assert.equal(actualBuildSourceRoot(line(staged), out, evidence), staged);
  for (const root of ['/elsewhere/candidate', evidence + '/global/staging/a10b/other', evidence + '/global/stagingx/a10b/candidate',
    evidence + '/global/staging/not-a-hash/candidate', evidence + '/global/staging/a10b/extra/candidate'])
    assert.throws(() => actualBuildSourceRoot(line(root), out, evidence));
  assert.throws(() => actualBuildSourceRoot('', out, evidence));
  assert.throws(() => actualBuildSourceRoot(line(out) + line(staged), out, evidence));
});

test('actual loaded source reconciliation rejects changed, missing or extra source files', () => {
  const before = { 'build.sbt': { bytes: 3, sha256: 'aaa' }, 'src/test/scala/Test.scala': { bytes: 5, sha256: 'bbb' } };
  assert.deepEqual(compareBuildSources(before, structuredClone(before)), { passed: true, files: 2 });
  assert.throws(() => compareBuildSources(before, { 'build.sbt': before['build.sbt'] }));
  assert.throws(() => compareBuildSources(before, { ...before, 'extra.sbt': { bytes: 0, sha256: 'ccc' } }));
  assert.throws(() => compareBuildSources(before, { ...before, 'build.sbt': { bytes: 3, sha256: 'changed' } }));
});

test('executor retains OS confinement, fixed task admission and cleanup-free lifecycle', () => {
  const source = readFileSync(cli, 'utf8');
  assert.ok(source.includes('(deny network*)\\n(deny file-write*)'));
  assert.match(source, /assertFreshOutput\(output\)/);
  assert.match(source, /await probeSandbox\(/);
  assert.match(source, /succeeded\(phases\.build\)/);
  assert.match(source, /result\.checks\[check\] = result\[key\]\.passed/);
  assert.ok(source.includes("!runTests || result[runActors ? 'actorTests' : 'generatedTests'].passed"));
  assert.match(source, /verifier changed during execution/);
  assert.ok(!source.includes('v1-release-cold.mjs') && !source.includes('rmSync(') && !source.includes('execSync('));
});
