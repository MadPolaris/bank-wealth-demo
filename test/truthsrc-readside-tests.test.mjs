import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READSIDE_BASELINE_REVISION, READSIDE_DEPENDENCY, READSIDE_EXECUTION_CHECKS, READSIDE_MANIFEST_FILE,
  READSIDE_SCOPE, READSIDE_SOURCES_MARKER, combineReadsideManifest, inspectReadsideSources,
  readsideSourceFiles, readsideSuiteNames, readsideTestManifest,
} from '../tools/truthsrc-readside-tests.mjs';
import {
  actualBuildSourceRoot, buildTasks, completeGeneratedTests, generatedTestManifest, inspectGeneratedTests,
  parseArgs, snapshotFiles,
} from '../tools/verify-truthsrc-build.mjs';
import { actorTestManifest, combineActorManifest } from '../tools/truthsrc-actor-tests.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const flags = ['--project-output', '/owned/candidate', '--archive', '/owned/archive.tar.gz', '--evidence', '/owned/evidence'];
const fixed = [
  ['BankReadsideProjectionSpec', 6, 'fd14c0ac849da0355694615caa8ba3051048341031371a0b9a3b3347552d53cb'],
  ['BankReadsideShutdownSpec', 1, '6fd943df18bc856c220fbad264db4c9e43f6b1193e29ca575fcfe218c3eb4b6d'],
  ['BankQueryAuthorizationSpec', 7, '43fb1290ee585bc6338390b46fa562bad37e0abb69698a3519c0330d025b8f82'],
  ['BankRequestHttpSpec', 3, '4070e5f01b080345ea9f9ffbd4c17365c958246bafec8a52767d4885bef12a72'],
  ['BankPagesSpec', 7, 'd2c3cae683169c7b5785b74cc1341f6bb50f4e893d5afff6176fbc84821831a2'],
];
const generatedSuites = [
  ['GeneratedActorStateSpec', 3], ['GeneratedDomainRoundtripSpec', 5], ['GeneratedFiniteHostSpec', 0],
  ['example.bankwealth.service.GeneratedServiceConfigurationSpec', 11], ['example.bankwealth.service.GeneratedUnitStorageSpec', 4],
];
const entries = [{ path: 'src/test/scala/UnitConfigurationCheck.scala', content: 'fixture unit support\n' },
  ...generatedSuites.map(([name, count]) => ({ path: 'src/test/scala/' + name.split('.').at(-1) + '.scala',
    content: (name.includes('.') ? 'package example.bankwealth.service\n' : '') +
      'final class ' + name.split('.').at(-1) + ' extends AnyFunSuite {\n' +
      Array.from({ length: count }, (_, i) => '  test("generated check ' + i + '") {\n    assert(true)\n  }\n').join('') + '}\n',
  }))];
const generatedFiles = entries.map(row => row.path).sort();
const generated = generatedTestManifest(entries), frozen = readsideTestManifest();
const manifest = combineReadsideManifest(generated, frozen);
const options = parseArgs([...flags, '--run-readside-tests']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('readside execution is explicit, implies compile and is exclusive with every other execution/runtime mode', () => {
  assert.equal(parseArgs(flags).runReadside, false);
  assert.equal(options.runReadside, true);
  assert.equal(options.runTests, true);
  assert.equal(options.compileTests, true);
  assert.equal(options.runActors, false);
  assert.equal(options.compileRuntimeTests, false);
  for (const extra of ['--run-generated-tests', '--run-actor-tests', '--compile-runtime-tests']) {
    for (const pair of [['--run-readside-tests', extra], [extra, '--run-readside-tests']])
      assert.throws(() => parseArgs([...flags, ...pair]), /choose one/);
  }
  for (const pair of [['--compile-generated-tests', '--run-readside-tests'], ['--run-readside-tests', '--compile-generated-tests']])
    assert.deepEqual(parseArgs([...flags, ...pair]), options);
  assert.throws(() => parseArgs([...flags, '--run-readside-tests', '--run-readside-tests']), /Usage/);
  for (const extra of [['--readside-source', '/other.scala'], ['--task', 'testOnly'], ['--run-readside-tests=all']])
    assert.throws(() => parseArgs([...flags, ...extra]), /Usage/);
});

test('frozen manifests pin exact original files, SHA, packages, suite classes and all 24 literal names', () => {
  assert.equal(READSIDE_BASELINE_REVISION, '21dc6c6');
  assert.equal(frozen.baselineRevision, READSIDE_BASELINE_REVISION);
  assert.equal(frozen.suiteCount, 5);
  assert.equal(frozen.testCount, 24);
  assert.deepEqual(frozen.zeroTestSuites, []);
  assert.deepEqual(readsideSuiteNames(), fixed.map(([name]) => 'example.bankwealth.service.' + name).sort());
  const reads = [];
  assert.deepEqual(readsideTestManifest(file => { reads.push(file); return readFileSync(file, 'utf8'); }), frozen);
  assert.deepEqual(reads, fixed.map(([name]) => join(ROOT, 'test/scala', name + '.scala')));
  for (const [i, suite] of frozen.suites.entries()) {
    const [name, count, sha256] = fixed[i];
    const text = readFileSync(suite.file, 'utf8');
    assert.equal(suite.sha256, sha256);
    assert.equal(hash(readFileSync(suite.file)), sha256);
    assert.equal(suite.name, 'example.bankwealth.service.' + name);
    assert.equal(suite.sourceKind, 'frozen-readside-test');
    assert.deepEqual([...text.matchAll(/^package (.+)$/gm)].map(row => row[1]), ['example.bankwealth.service']);
    assert.deepEqual([...text.matchAll(/^final class (\w+) extends AnyFunSuite \{/gm)].map(row => row[1]), [name]);
    assert.equal(suite.tests.length, count);
    assert.equal(new Set(suite.tests).size, count);
    assert.deepEqual([...text.matchAll(/^  test\(("(?:[^"\\\r\n]|\\.)*")\) \{/gm)].map(row => JSON.parse(row[1])), suite.tests);
  }
});

test('even nonsemantic source edits or unchanged count/name substitutions fail pinned admission', () => {
  for (const suite of frozen.suites) {
    for (const change of [text => text + '\n', text => text.replace('package example.bankwealth.service', 'package foreign'),
      text => text.replace('final class Bank', 'final class Foreign'), text => text.replace('  test("', '  ignore("'),
      text => text.replace(suite.tests[0], 'a different test with the same count')]) {
      assert.throws(() => readsideTestManifest(file => {
        const text = readFileSync(file, 'utf8'); return file === suite.file ? change(text) : text;
      }), /frozen readside test bytes changed/);
    }
  }
});

test('inspected fixture closure is embedded H2/testkit and direct requests, without extra support or server/worker launch', () => {
  const texts = frozen.suites.map(suite => readFileSync(suite.file, 'utf8'));
  assert.equal(texts.filter(text => /object BankOwnerATestSupport \{/.test(text)).length, 1);
  assert.match(texts[0], /h2\.setURL\("jdbc:h2:mem:/);
  assert.match(texts[0], /DB_CLOSE_ON_EXIT=FALSE/);
  assert.match(texts[0], /akka\.actor\.provider = local/);
  assert.match(texts[0], /finally kit\.shutdownTestKit\(\)/);
  assert.match(texts[0], /statement\.execute\("SHUTDOWN"\)/);
  for (const text of texts) assert.doesNotMatch(text,
    /BankOwnerB|BankBrowserHttpFixture|BankPageRouterSpec|ProcessBuilder|Runtime\.getRuntime|new ServerSocket|\.bind\(|\.start\(|\.listen\(|jdbc:h2:(?:tcp|file)|jdbc:mysql|org\.h2\.tools\.Server/);
  assert.equal(READSIDE_MANIFEST_FILE, join(ROOT, 'tools/truthsrc-readside-tests.mjs'));
  const inputs = snapshotFiles([...frozen.suites.map(s => s.file), READSIDE_MANIFEST_FILE]);
  assert.equal(Object.keys(inputs).length, 6);
  assert.equal(inputs[READSIDE_MANIFEST_FILE].sha256, hash(readFileSync(READSIDE_MANIFEST_FILE)));
});

test('combined manifest retains six generated files, five generated suites/23 tests and adds only 24 frozen tests', () => {
  assert.equal(generatedFiles.length, 6);
  assert.equal(manifest.suiteCount, 10);
  assert.equal(manifest.testCount, 47);
  assert.equal(manifest.businessTests, 24);
  assert.equal(manifest.readsideTests, 24);
  assert.equal(manifest.generatedTests, 23);
  assert.deepEqual(manifest.zeroTestSuites, ['GeneratedFiniteHostSpec']);
  assert.deepEqual(manifest.suites.slice(0, 5), generated.suites.map(s => ({ ...s, sourceKind: 'current-generated-test' })));
  assert.deepEqual(manifest.suites.slice(5), frozen.suites);
  assert.deepEqual(readsideSourceFiles(manifest, generatedFiles), frozen.suites.map(s => s.file).sort());
  assert.match(READSIDE_SCOPE, /embedded in-memory H2 JDBC/);
  assert.match(READSIDE_SCOPE, /not real MySQL, HTTP server\/body-parser\/browser, TA workers, cross-JVM recovery or 1134 acceptance/);
});

test('combination rejects partial, extra, actor, renamed or rehashed frozen manifests and changed generated counts', () => {
  for (const mutate of [m => m.suites.pop(), m => m.suites.push(m.suites[0]), m => { m.testCount--; },
    m => { m.suites[0].sha256 = '0'.repeat(64); }, m => { m.suites[0].tests[0] = 'renamed'; },
    m => { m.suites[0].file = '/foreign/' + m.suites[0].file.split('/').at(-1); }]) {
    const changed = structuredClone(frozen); mutate(changed);
    assert.throws(() => combineReadsideManifest(generated, changed));
  }
  assert.throws(() => combineReadsideManifest(generated, actorTestManifest()));
  for (const patch of [{ testCount: 22 }, { suiteCount: 4 }, { zeroTestSuites: [] }])
    assert.throws(() => combineReadsideManifest({ ...generated, ...patch }, frozen));
});

test('readside tasks use fixed Test/test, pre-fork source/suite assertions and only explicit Test-scoped H2', () => {
  const tasks = buildTasks(generatedFiles, options, manifest);
  assert.equal(tasks.at(-1), 'Test / test');
  assert.equal(tasks.filter(task => task === 'Test / compile').length, 1);
  assert.deepEqual(READSIDE_DEPENDENCY, ['com.h2database', 'h2', '2.2.224']);
  assert.deepEqual(tasks.filter(task => task.includes('libraryDependencies')),
    ['set libraryDependencies += "com.h2database" % "h2" % "2.2.224" % Test']);
  assert.match(tasks.at(-2), /\(Test \/ definedTests\)\.value/);
  assert.match(tasks.at(-2), /require\(suites == Seq/);
  assert.match(tasks.at(-2), /\(Test \/ sources\)\.value\.map\(_\.getCanonicalPath\)\.sorted/);
  assert.match(tasks.at(-2), /require\(sourcePaths == Seq/);
  assert.ok(tasks.at(-2).includes(READSIDE_SOURCES_MARKER));
  assert.ok(tasks.at(-2).includes('TRUTHSRC-GENERATED-SUITES='));
  const appended = [...tasks[1].matchAll(/file\(("[^"]+")\)/g)].map(row => JSON.parse(row[1]));
  assert.deepEqual(appended, frozen.suites.map(s => s.file).sort());
  assert.equal(appended.length, 5);
  for (const suite of manifest.suites) assert.ok(tasks.at(-2).includes(JSON.stringify(suite.name)));
  for (const task of tasks) assert.doesNotMatch(task,
    /testOnly|runMain|Test \/ fork|Test \/ test :=|UnitNoNetwork|setSecurityManager|bank\.mock-ta|leveldb|\.mjs|\.py|network|javaOptions :=/);
});

test('task helper rejects basename substitutions, aliases, directories, sidecars and any source closure expansion', () => {
  for (const file of ['/foreign/BankReadsideProjectionSpec.scala', join(ROOT, 'test/scala'),
    join(ROOT, 'tools/truthsrc-actor-ta-worker.mjs'), ROOT + '/test/scala/./BankReadsideProjectionSpec.scala']) {
    const changed = structuredClone(manifest); changed.suites[5].file = file;
    assert.throws(() => buildTasks(generatedFiles, options, changed), /exact pinned readside source list/);
  }
  for (const mutate of [m => m.suites.pop(), m => m.suites.push(m.suites[5]), m => { m.suites[5].sha256 = '0'.repeat(64); },
    m => { m.suites[5].tests.pop(); }, m => { m.suites[5].sourceKind = 'frozen-business-test'; },
    m => { m.readsideTests = 14; }, m => { m.baselineRevision = 'other'; }, m => { m.suites[5].name = 'ForeignSpec'; }]) {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => buildTasks(generatedFiles, options, changed));
  }
  for (const files of [generatedFiles.slice(1), [...generatedFiles, generatedFiles[0]],
    [...generatedFiles, 'src/test/scala/Extra.scala'], ['src/test/scala'], [...generatedFiles, 'tools/sidecar.mjs']])
    assert.throws(() => buildTasks(files, options, manifest), /exact six generated/);
  assert.throws(() => buildTasks(generatedFiles, { ...options, runActors: true }, manifest), /choose one/);
  assert.throws(() => buildTasks(generatedFiles, { ...options, runTests: false }, manifest), /readside execution/);
  assert.throws(() => buildTasks(generatedFiles, options, manifest, { worker: '/worker' }), /without actor configuration/);
  assert.throws(() => buildTasks(generatedFiles, options, generated));
});

test('existing generated and actor modes retain counts, dependencies and their independent source-bound checks', () => {
  const actorManifest = combineActorManifest(generated, actorTestManifest());
  assert.equal(actorManifest.testCount, 64);
  assert.equal(actorManifest.businessTests, 41);
  assert.equal(actorManifest.suiteCount, 13);
  const actor = { node: '/owned/node', worker: '/owned/worker', ownedRoot: '/owned/journals' };
  for (const extra of [[], ['--compile-generated-tests'], ['--run-generated-tests'], ['--run-actor-tests']]) {
    const parsed = parseArgs([...flags, ...extra]);
    const tasks = buildTasks(generatedFiles, parsed, parsed.runActors ? actorManifest : generated, parsed.runActors ? actor : null);
    assert.equal(parsed.runReadside, false);
    assert.ok(!tasks.some(task => task.includes('libraryDependencies') || task.includes(READSIDE_SOURCES_MARKER)));
    assert.equal(tasks.at(-1) === 'Test / test', parsed.runTests);
    assert.equal(tasks.some(task => task.includes('TRUTHSRC-ACTOR-SOURCES=')), parsed.runActors);
  }
  const observation = inspectGeneratedTests(log(actorManifest), actorManifest, 100);
  const report = completeGeneratedTests(observation, receipt, checks);
  assert.equal(report.passed, false);
  assert.match(report.errors.join('\n'), /actorInputsUnchanged.*actorWorkersVerified.*actorBoundaryEnforced/);
});

const output = '/owned/target/candidate', evidence = '/owned/target/evidence';
const staged = evidence + '/global/staging/a123/candidate';
function closureLog(root, sources = [...generatedFiles.map(file => join(root, file)), ...frozen.suites.map(s => s.file)].sort()) {
  return '[info] loading project definition from ' + root + '/project\n' + READSIDE_SOURCES_MARKER + sources.join(',') + '\n';
}

test('actual Test marker binds generated staging paths and original frozen files, not their staged copies', () => {
  for (const root of [output, staged]) {
    const stdout = closureLog(root);
    assert.equal(actualBuildSourceRoot(stdout, output, evidence), root);
    const report = inspectReadsideSources(stdout, root, generatedFiles, manifest);
    assert.equal(report.sources.length, 11);
    assert.deepEqual(report.generatedSources, generatedFiles.map(file => join(root, file)).sort());
    assert.deepEqual(report.frozenSources, frozen.suites.map(s => s.file).sort());
    assert.deepEqual(inspectReadsideSources(stdout.replace(READSIDE_SOURCES_MARKER, '[info] ' + READSIDE_SOURCES_MARKER).replaceAll('\n', '\r\n'),
      root, generatedFiles, manifest), report);
  }
  const stdout = closureLog(staged), first = frozen.suites[0].file;
  for (const text of ['', stdout + stdout, stdout.replace(READSIDE_SOURCES_MARKER, 'MISSING='),
    stdout.replace(staged + '/src/', output + '/src/'), stdout.replace(first, staged + '/test/scala/BankReadsideProjectionSpec.scala'),
    stdout.replace(first, first + ',' + first), stdout.replace(first, join(ROOT, 'test/scala')),
    stdout.replace(first + ',', ''), stdout.replace(READSIDE_SOURCES_MARKER, READSIDE_SOURCES_MARKER + '/owned/sidecar.mjs,')])
    assert.throws(() => inspectReadsideSources(text, staged, generatedFiles, manifest));
});

function log(m = manifest) {
  return ['TRUTHSRC-GENERATED-SUITES=' + m.suites.map(s => s.name).sort().join(','),
    'UNIT-CONFIGURATION-OK journal=testkit snapshot=testkit network=denied', 'UNIT-JVM-PID=101',
    'Run starting. Expected test count is: ' + m.testCount,
    ...m.suites.flatMap(s => [s.name.split('.').at(-1) + ':', ...s.tests.map(name => '- ' + name)]),
    'Total number of tests run: ' + m.testCount, 'Suites: completed ' + m.suiteCount + ', aborted 0',
    'Tests: succeeded ' + m.testCount + ', failed 0, canceled 0, ignored 0, pending 0', 'All tests passed.'].join('\n') + '\n';
}
const receipt = { code: 0, signal: null, launchError: null, timedOut: false, cancelled: null,
  directChildReaped: true, leftoverGroup: false, groupAliveAfter: false, terminationErrors: [] };
const checks = Object.fromEntries(['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
  'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried',
  'verifierUnchanged', 'actualBuildSourcesVerified', ...READSIDE_EXECUTION_CHECKS].map(key => [key, true]));

test('shared output inspector and completion seal exactly 47 tests/10 suites without actor worker checks', () => {
  const observation = inspectGeneratedTests(log(), manifest, 100);
  assert.equal(observation.passed, true);
  assert.equal(observation.testsObserved, 47);
  assert.equal(observation.totals.suitesCompleted, 10);
  const completed = completeGeneratedTests(observation, receipt, checks);
  assert.equal(completed.outputPassed, true);
  assert.equal(completed.processPassed, true);
  assert.equal(completed.sourceBound, true);
  assert.equal(completed.passed, true);
  assert.deepEqual(completed.errors, []);
  for (const key of Object.keys(checks)) for (const value of [false, undefined]) {
    const report = completeGeneratedTests(observation, receipt, { ...checks, [key]: value });
    assert.equal(report.sourceBound, false, key);
    assert.equal(report.passed, false, key);
    assert.equal(report.outputPassed, true);
  }
  for (const patch of [{ code: 1 }, { timedOut: true }, { signal: 'SIGTERM' }, { launchError: 'EIO' }, { cancelled: 'SIGINT' },
    { directChildReaped: false }, { leftoverGroup: true }, { groupAliveAfter: true }, { terminationErrors: ['EPERM'] }])
    assert.equal(completeGeneratedTests(observation, { ...receipt, ...patch }, checks).passed, false);
  for (const signal of ['SIGINT', 'SIGTERM']) assert.equal(completeGeneratedTests(observation, receipt, checks, signal).passed, false);
  assert.equal(completeGeneratedTests(observation, receipt, checks, null, ['readside receipt write failed']).passed, false);
  assert.equal(completeGeneratedTests(observation, undefined, checks).passed, false);
});

test('shared inspector refuses missing frozen names, counts, zero-test suite, fork, boundary or completion', () => {
  for (const change of [text => text.replace('- ' + frozen.suites[0].tests[0] + '\n', ''),
    text => text.replace(frozen.suites[0].tests[0], 'different test'), text => text.replace('Expected test count is: 47', 'Expected test count is: 23'),
    text => text.replace('GeneratedFiniteHostSpec:\n', ''), text => text.replace('UNIT-JVM-PID=101', 'UNIT-JVM-PID=100'),
    text => text.replace('network=denied', 'network=allowed'), text => text.replace('completed 10, aborted 0', 'completed 9, aborted 1'),
    text => text.replace('succeeded 47, failed 0', 'succeeded 46, failed 1'), text => text.replace('All tests passed.', ''), text => text + text]) {
    const observation = inspectGeneratedTests(change(log()), manifest, 100);
    assert.equal(observation.passed, false);
    assert.equal(completeGeneratedTests(observation, receipt, checks).passed, false);
  }
  const unknown = completeGeneratedTests({ expected: manifest, requested: true, evidenceState: 'unavailable',
    jvmStarted: null, started: null, completed: null, passed: false, errors: ['unreadable log'] }, receipt, checks);
  assert.equal(unknown.started, null);
  assert.equal(unknown.completed, null);
  assert.equal(unknown.passed, false);
});

test('verifier wiring captures helper/source inputs before launch and finally, seals a separate receipt, and keeps confinement', () => {
  const source = readFileSync(join(ROOT, 'tools/verify-truthsrc-build.mjs'), 'utf8');
  assert.match(source, /readsideBefore = snapshotFiles\(\[\.\.\.readsideManifest\.suites\.map\(suite => suite\.file\), READSIDE_MANIFEST_FILE\]\)/);
  assert.match(source, /readsideBefore\[READSIDE_MANIFEST_FILE\]\.sha256, READSIDE_HELPER_SHA256/);
  assert.match(source, /readsideManifest, readsideInputs: readsideBefore/);
  assert.match(source, /runReadside \? \[READSIDE_MANIFEST_FILE\] : \[\]/);
  assert.match(source, /readside-sources-before\.json/);
  assert.match(source, /readside-sources-after\.json/);
  const prebuild = source.indexOf('readside tests/helper changed before build');
  assert.ok(prebuild > 0 && prebuild < source.indexOf('phases.build = await command'));
  assert.match(source, /assert\.deepEqual\(readsideTestManifest\(\), readsideManifest, 'readside source pins changed before build'\)/);
  assert.match(source.slice(source.indexOf('finally {\n    // Reconcile')), /snapshotFiles\(Object\.keys\(readsideBefore\)\)/);
  assert.match(source.slice(source.indexOf('finally {\n    // Reconcile')), /frozen readside source pins changed before sealing/);
  assert.match(source, /testObservation\.sourceClosure = inspectReadsideSources/);
  assert.match(source, /compareBuildSources\(admitted\.before, actualSources\)/);
  assert.match(source, /runActors \? 'actorTests' : runReadside \? 'readsideTests' : 'generatedTests'/);
  assert.match(source, /runActors \? 'actor-tests\.json' : runReadside \? 'readside-tests\.json' : 'generated-tests\.json'/);
  assert.match(source, /const executionPassed = runReadside \? result\.readsideTests\.passed/);
  assert.match(source, /result\[key\] = completeGeneratedTests\(/);
  assert.match(source, /runGeneratedTests: runTests && !runActors && !runReadside/);
  assert.ok(source.includes('(deny network*)\\n(deny file-write*)'));
  assert.match(source, /if \(runActors\) actor = await prepareActors\(/);
  const preparation = source.slice(source.indexOf('if (runReadside) {\n      readsideManifest'), source.indexOf('testObservation.expected = executionManifest'));
  assert.doesNotMatch(preparation, /mkdir|ownedRoot|worker|prepareActors/);
  assert.ok(source.includes('480_000, sandbox)'));
  assert.doesNotMatch(source, /rmSync\(|execSync\(/);
  assert.doesNotMatch(readFileSync(READSIDE_MANIFEST_FILE, 'utf8'), /child_process|spawn\(|execFile|writeFile|mkdir|createServer/);
});
