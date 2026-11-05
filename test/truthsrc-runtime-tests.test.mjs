import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RUNTIME_MAINS, RUNTIME_DEPENDENCIES, completeRuntimeCompilation, inspectRuntimeCompilation,
  runtimeBuildTasks, runtimeClasspathInventory, runtimeTestManifest,
} from '../tools/truthsrc-runtime-tests.mjs';
import { fileDigest, inventory, parseArgs, safePath } from '../tools/verify-truthsrc-build.mjs';

const flags = ['--project-output', '/owned/candidate', '--archive', '/owned/archive.tar.gz', '--evidence', '/owned/build'];
const generated = ['src/test/scala/UnitConfigurationCheck.scala'];
const manifest = runtimeTestManifest();

test('runtime compilation is explicit, compile-only and exclusive with execution modes', () => {
  assert.equal(parseArgs(flags).compileRuntimeTests, false);
  const options = parseArgs([...flags, '--compile-runtime-tests']);
  assert.equal(options.compileRuntimeTests, true);
  assert.equal(options.compileTests, true);
  assert.equal(options.runTests, false);
  assert.equal(options.runActors, false);
  assert.equal(parseArgs([...flags, '--compile-runtime-tests', '--compile-generated-tests']).compileTests, true);
  for (const mode of ['--run-generated-tests', '--run-actor-tests']) assert.throws(() => parseArgs([...flags, '--compile-runtime-tests', mode]), /choose one/);
  assert.throws(() => parseArgs([...flags, '--compile-runtime-tests', '--compile-runtime-tests']), /Usage/);
});

test('runtime main closure is fixed and preserves its explicit entrypoints', () => {
  assert.equal(manifest.sourceCount, 5);
  assert.deepEqual(manifest.sources.map(row => row.name), RUNTIME_MAINS);
  assert.ok(manifest.sources.every(row => row.file.endsWith(row.name.split('.').at(-1) + '.scala') && /^[0-9a-f]{64}$/.test(row.sha256)));
  for (const edit of [text => text.replace('package example.bankwealth.service', 'package foreign'), text => text.replace('object Bank', 'object Other'), text => text.replace('def main(', 'def notMain(')]) {
    assert.throws(() => runtimeTestManifest(file => edit(readFileSync(file, 'utf8'))));
  }
});

test('runtime sbt task sequence never dispatches a test or main and only adds pinned test dependencies', () => {
  const tasks = runtimeBuildTasks(generated, manifest);
  assert.ok(tasks.includes('compile') && tasks.includes('Test / compile'));
  assert.equal(tasks.at(-1), 'show Test / fullClasspath');
  assert.ok(tasks.every(task => !/runMain|testOnly|Test \/ test\b|Test \/ fork|javaOptions/.test(task)));
  for (const row of manifest.sources) assert.ok(tasks[1].includes(JSON.stringify(row.file)));
  for (const [, name, version] of RUNTIME_DEPENDENCIES) assert.ok(tasks[3].includes(JSON.stringify(name) + ' % ' + JSON.stringify(version) + ' % Test'));
  assert.ok(tasks.at(-2).includes('(Test / sources).value'));
  assert.ok(tasks.at(-2).includes('(Test / fullClasspath).value'));
});

function log(root, classpath) {
  return 'TRUTHSRC-RUNTIME-SOURCES=' + [...generated.map(file => join(root, file)), ...manifest.sources.map(row => row.file)].sort().join(':') + '\n' +
    'TRUTHSRC-RUNTIME-CLASSPATH=' + classpath.join(':') + '\n';
}

test('runtime markers bind actual staged Test source set and ordered classpath', () => {
  const root = '/owned/global/staging/a123/candidate', classpath = [root + '/target/scala-2.13/test-classes', root + '/target/scala-2.13/classes', '/owned/supply/maven/a.jar'];
  const stdout = log(root, classpath);
  assert.deepEqual(inspectRuntimeCompilation(stdout, root, generated, manifest).classpath, classpath);
  for (const changed of ['', stdout + stdout, stdout.replace('TRUTHSRC-RUNTIME-SOURCES=', 'MISSING='),
    stdout.replace(root + '/src/', '/foreign/src/'), stdout + 'UNIT-JVM-PID=123\n', log(root, [...classpath, classpath[0]])]) {
    assert.throws(() => inspectRuntimeCompilation(changed, root, generated, manifest));
  }
});

function closureFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'truthsrc-runtime-closure-'));
  const actualRoot = join(root, 'global/staging/a123/candidate');
  const classes = join(actualRoot, 'target/scala-2.13/classes'), tests = join(actualRoot, 'target/scala-2.13/test-classes');
  mkdirSync(join(tests, 'example/bankwealth/service'), { recursive: true });
  mkdirSync(classes, { recursive: true });
  writeFileSync(join(classes, 'Current.class'), 'bytecode');
  for (const name of RUNTIME_MAINS) writeFileSync(join(tests, name.replaceAll('.', '/') + '$.class'), name);
  const jar = join(root, 'supply/maven/dependency.jar');
  mkdirSync(join(root, 'supply/maven'), { recursive: true }); writeFileSync(jar, 'pinned fixture jar');
  return { root, actualRoot, classes, tests, jar, classpath: [tests, classes, jar], helpers: { safePath, inventory, fileDigest } };
}

test('classpath admits only actual build classes and owned supply jars, rejecting aliases and missing mains', () => {
  const f = closureFixture();
  const capture = paths => runtimeClasspathInventory(paths, f.actualRoot, f.root, f.helpers);
  const before = capture(f.classpath);
  assert.equal(before[f.tests].kind, 'directory'); assert.equal(before[f.jar].kind, 'file');
  const optional = join(f.actualRoot, 'target/web/classes/main');
  assert.deepEqual(capture([...f.classpath, optional])[optional], { kind: 'absent' });
  assert.throws(() => capture(f.classpath.slice(1)), /test directories/);
  const foreign = join(f.root, 'foreign.jar'); writeFileSync(foreign, 'foreign');
  assert.throws(() => capture([...f.classpath, foreign]), /not from this build supply/);
  const linked = join(f.root, 'supply/maven/link.jar'); symlinkSync(f.jar, linked);
  assert.throws(() => capture([...f.classpath, linked]), /symlink/);
  writeFileSync(join(f.classes, 'Current.class'), 'changed');
  assert.notDeepEqual(capture(f.classpath), before);
});

test('runtime compile receipt requires every final source/protection check and process success', () => {
  const keys = ['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
    'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried',
    'verifierUnchanged', 'actualBuildSourcesVerified', 'runtimeTestInputsUnchanged', 'actualRuntimeTestSourcesVerified', 'runtimeClasspathVerified'];
  const checks = Object.fromEntries(keys.map(key => [key, true]));
  const observation = { testsExecuted: false, servicesStarted: false };
  assert.equal(completeRuntimeCompilation(observation, checks, true).passed, true);
  for (const key of keys) assert.equal(completeRuntimeCompilation(observation, { ...checks, [key]: false }, true).passed, false);
  assert.equal(completeRuntimeCompilation(observation, checks, false).passed, false);
  assert.equal(completeRuntimeCompilation(undefined, checks, true).passed, false);
  assert.equal(completeRuntimeCompilation(observation, checks, true, ['cancelled']).passed, false);
});
