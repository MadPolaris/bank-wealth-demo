import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { admitRuntimeBuild, captureRuntimeFile, captureRuntimeSourceInventory, validateRuntimeReceipts, validateRuntimeSourceInventory } from '../tools/truthsrc-runtime-admission.mjs';
import { RUNTIME_MANIFEST_FILE, runtimeBuildTasks, runtimeTestManifest } from '../tools/truthsrc-runtime-tests.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = { bytes: 1, sha256: hash('x') };
const CHECKS = ['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged', 'supplyUnchanged',
  'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried', 'verifierUnchanged',
  'actualBuildSourcesVerified', 'runtimeTestInputsUnchanged', 'actualRuntimeTestSourcesVerified', 'runtimeClasspathVerified', 'runtimeCompilationPassed'];

function fixture({ staged = true, sourceCount = 235, ownedRoot = null } = {}) {
  const evidence = ownedRoot ? join(ownedRoot, 'build') : join(ROOT, 'target/mock-runtime-evidence');
  const output = ownedRoot ? join(ownedRoot, 'candidate') : join(ROOT, 'generated/mock-runtime-candidate');
  const actualRoot = staged ? join(evidence, 'global/staging/a123', basename(output)) : output;
  const javaHome = '/opt/fixture-jdk11', archive = join(ROOT, 'dist/fixture.tar.gz');
  const generated = ['GeneratedActorStateSpec', 'GeneratedDomainRoundtripSpec', 'GeneratedFiniteHostSpec', 'GeneratedServiceConfigurationSpec',
    'GeneratedUnitStorageSpec', 'UnitConfigurationCheck'].map(name => 'src/test/scala/' + name + '.scala').sort();
  const manifest = runtimeTestManifest();
  const sources = [...generated.map(file => join(actualRoot, file)), ...manifest.sources.map(row => row.file)].sort();
  const classpath = ['target/scala-2.13/test-classes', 'target/scala-2.13/classes'].map(file => join(actualRoot, file)).concat(join(evidence, 'supply/maven/dependency.jar'));
  const stdout = Buffer.from('[info] loading project definition from ' + actualRoot + '/project\nTRUTHSRC-RUNTIME-SOURCES=' + sources.join(':') + '\nTRUTHSRC-RUNTIME-CLASSPATH=' + classpath.join(':') + '\n');
  const stderr = Buffer.from('');
  const propertyPaths = [['user.home', 'home'], ['java.io.tmpdir', 'tmp'], ['sbt.boot.directory', 'boot'], ['sbt.global.base', 'global'],
    ['sbt.ivy.home', 'ivy'], ['coursier.cache', 'coursier'], ['sbt.repository.config', 'repositories'], ['sbt.boot.properties', 'sbt.boot.properties']];
  const javaOptions = ['-XX:-UsePerfData', '-XX:ErrorFile=' + join(evidence, 'tmp/hs_err_pid%p.log'),
    ...propertyPaths.map(([key, file]) => '-D' + key + '=' + join(evidence, file)), '-Dsbt.override.build.repos=true',
    '-Djava.util.prefs.userRoot=' + join(evidence, 'home/.java/userPrefs'), '-Djava.util.prefs.systemRoot=' + join(evidence, 'home/.java/systemPrefs'),
    '-Dsbt.server.autostart=false', '-Dsbt.server.forcestart=true', '-Dsbt.supershell=false', '-Dsbt.log.noformat=true', '-Dsbt.ci=true'];
  const tasks = runtimeBuildTasks(generated, manifest);
  const build = { command: ['/usr/bin/sandbox-exec', '-f', join(evidence, 'sandbox.sb'), join(javaHome, 'bin/java'), '-Xmx2G', '-XX:ActiveProcessorCount=2',
    ...javaOptions, '-cp', join(evidence, 'supply/launcher/sbt-launch.jar'), 'xsbt.boot.Boot', ...tasks], cwd: output,
    sandboxProfileSha256: hash('sandbox'), pid: 123, startedAt: '2026-11-05T00:00:00.000Z', elapsedMs: 100, timeoutMs: 480000, graceMs: 15000,
    code: 0, signal: null, launchError: null, timedOut: false, cancelled: null, terminationErrors: [], directChildClosed: true,
    directChildReaped: true, leftoverGroup: false, groupAliveAfter: false, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  const runtime = { schemaVersion: 'bank.truthsrc-runtime-build/v1', output, buildEvidence: evidence, actualRoot, sources, manifest, classpath,
    classpathInventory: Object.fromEntries(classpath.map(file => [file, { ...stamp }])), buildStdoutSha256: hash(stdout),
    jarReferences: { schemaVersion: 'bank.truthsrc-runtime-jars/v1', jars: classpath.filter(file => file.endsWith('.jar')).map(file => ({ file, sha256: stamp.sha256, classPath: [] })), references: [] },
    testsExecuted: false, servicesStarted: false, passed: true, sourceBound: true, processPassed: true, errors: [] };
  const before = { output: Object.fromEntries(Array.from({ length: sourceCount }, (_, i) => ['source-' + i, { ...stamp }])), handwritten: { 'Original.scala': stamp }, localRuntime: { 'Frozen.jar': stamp } };
  const after = { ...structuredClone(before), supply: Object.fromEntries(Array.from({ length: 1065 }, (_, i) => ['supply-' + i, { ...stamp }])) };
  const actual = { passed: true, files: sourceCount, root: actualRoot, staged, admittedOutput: output, stdoutSha256: hash(stdout), sources: structuredClone(before.output) };
  const archiveSha256 = '95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade';
  const input = { output, evidence, archive, javaHome, project: join(ROOT, 'truthsrc.project.json'), handwrittenRoot: join(ROOT, 'v1/handwritten/scala'),
    toolRoot: fileURLToPath(new URL('../../metarch-truthsrc', import.meta.url)), generator: { id: 'scala-cqrs-play-service', version: '1' },
    compileRuntimeTests: true, compileTests: true, runTests: false, runActors: false, compilerBridgePrefill: false, inheritedEnvironment: false,
    actor: null, testManifest: null, testFiles: generated, runtimeManifest: manifest, archiveSha256,
    initiallyEmpty: Object.fromEntries(['home', 'cache', 'ivy', 'coursier', 'boot', 'global', 'tmp'].map(name => [name, true])),
    env: { HOME: join(evidence, 'home'), USERPROFILE: join(evidence, 'home'), JAVA_HOME: javaHome,
      PATH: join(javaHome, 'bin') + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: join(evidence, 'tmp'),
      XDG_CACHE_HOME: join(evidence, 'cache'), XDG_CONFIG_HOME: join(evidence, 'home/.config'), XDG_DATA_HOME: join(evidence, 'home/.local/share'),
      COURSIER_CACHE: join(evidence, 'coursier'), COURSIER_JVM_CACHE: join(evidence, 'cache/jvm'), COURSIER_ARCHIVE_CACHE: join(evidence, 'cache/archives'),
      COURSIER_REPOSITORIES: pathToFileURL(join(evidence, 'supply/maven')).href + '/|ivy:' + pathToFileURL(join(evidence, 'supply/ivy')).href +
        '/[organization]/[module]/(scala_[scalaVersion]/)(sbt_[sbtVersion]/)[revision]/[type]s/[artifact](-[classifier]).[ext]' } };
  // The fixture is in-memory receipt data, not a generated or physically admitted candidate.
  const result = { schemaVersion: 'bank.truthsrc-build/v1', status: 'passed', output, evidence, javaHome,
    archive: { file: archive, expectedSha256: archiveSha256, sha256: archiveSha256 },
    compileRuntimeTests: true, compileGeneratedTests: true, runGeneratedTests: false, runActorTests: false, testsExecuted: false, servicesStarted: false,
    runtimeRebuilt: false, runtimePublished: false, release1134Resigned: false, runtimeRetryBackoffDeadline: 'OPEN', cancelled: null, errors: [],
    actorTests: { requested: false, passed: false }, generatedTests: { requested: false, evidenceState: 'not-dispatched', jvmStarted: false, started: false, completed: false, passed: false },
    runtimeCompilation: structuredClone(runtime), phases: { build: structuredClone(build) }, checks: Object.fromEntries(CHECKS.map(key => [key, true])) };
  const runtimeBefore = Object.fromEntries(manifest.sources.map(row => [row.file, { bytes: 1, sha256: row.sha256 }]).concat([[RUNTIME_MANIFEST_FILE, stamp], [join(ROOT, 'tools/truthsrc-runtime-jars.mjs'), stamp]]));
  const plan = { tasks, javaOptions, allowedAppArtifactDirectories: ['target', 'project/target', 'project/project/target'],
    explicitFrozenRuntimeSources: manifest.sources, explicitFrozenActorSources: [], historicalTestSourcesAppended: true,
    testExecutionRequested: false, testExecutionSupported: true, testManifest: null, env: { ...input.env, JAVA_TOOL_OPTIONS: javaOptions.join(' ') },
    sandbox: { profile: join(evidence, 'sandbox.sb'), sha256: build.sandboxProfileSha256 } };
  return { evidence, input, result, runtime, build, actual, before, after, runtimeBefore, runtimeAfter: structuredClone(runtimeBefore), plan, stdout, stderr };
}
const syncBuild = f => { f.result.phases.build = structuredClone(f.build); };
const syncRuntime = f => { f.result.runtimeCompilation = structuredClone(f.runtime); };
const relog = (f, text) => {
  f.stdout = Buffer.from(text); f.build.stdoutSha256 = f.runtime.buildStdoutSha256 = f.actual.stdoutSha256 = hash(f.stdout);
  syncBuild(f); syncRuntime(f);
};

test('pure v1 receipt gate accepts only fixed compile closure, including actual staging', () => {
  for (const staged of [true, false]) {
    const f = fixture({ staged }), admitted = validateRuntimeReceipts(f);
    assert.equal(admitted.output, f.input.output); assert.equal(admitted.actualRoot, f.actual.root);
    assert.equal(admitted.java, join(f.input.javaHome, 'bin/java')); assert.deepEqual(admitted.classpath, f.runtime.classpath);
  }
});

test('all fourteen final checks must be present and exactly true, not empty or truthy', () => {
  for (const key of CHECKS) for (const value of [false, undefined, 1, 'true', null]) {
    const f = fixture(); f.result.checks[key] = value; assert.throws(() => validateRuntimeReceipts(f), undefined, key);
  }
  const f = fixture(); f.result.checks = {}; assert.throws(() => validateRuntimeReceipts(f));
});

test('compile-only modes, no-service promises and current schemas are mandatory', () => {
  for (const [section, fields] of [['result', ['runGeneratedTests', 'runActorTests', 'testsExecuted', 'servicesStarted']],
    ['input', ['runTests', 'runActors']], ['runtime', ['testsExecuted', 'servicesStarted']]]) {
    for (const key of fields) for (const value of [true, undefined]) {
      const f = fixture(); f[section][key] = value; if (section === 'runtime') syncRuntime(f);
      assert.throws(() => validateRuntimeReceipts(f), undefined, section + '.' + key);
    }
  }
  for (const section of ['result', 'runtime']) for (const version of [undefined, 'bank.truthsrc-build/v0']) {
    const f = fixture(); f[section].schemaVersion = version; syncRuntime(f); assert.throws(() => validateRuntimeReceipts(f));
  }
  for (const [section, key] of [['input', 'compileRuntimeTests'], ['result', 'compileRuntimeTests'], ['result', 'compileGeneratedTests'],
    ['runtime', 'sourceBound'], ['runtime', 'processPassed'], ['runtime', 'passed']]) {
    const f = fixture(); delete f[section][key]; syncRuntime(f); assert.throws(() => validateRuntimeReceipts(f));
  }
});

test('nonzero, unclosed, timed out, signalled, cancelled or incompletely reaped build is rejected', () => {
  for (const patch of [{ code: 1 }, { signal: 'SIGTERM' }, { launchError: 'EIO' }, { timedOut: true }, { cancelled: 'SIGINT' },
    { directChildClosed: false }, { directChildReaped: false }, { leftoverGroup: true }, { groupAliveAfter: true },
    { terminationErrors: [{ error: 'EPERM' }] }, { signal: undefined }, { terminationErrors: undefined }]) {
    const f = fixture(); Object.assign(f.build, patch); syncBuild(f); assert.throws(() => validateRuntimeReceipts(f));
  }
});

for (const [name, mutate] of [
  ['detached result/runtime receipt', f => { f.result.runtimeCompilation.actualRoot = f.input.output; }],
  ['detached result/build receipt', f => { f.result.phases.build.pid++; }],
  ['changed stdout', f => { f.stdout = Buffer.concat([f.stdout, Buffer.from('changed')]); }],
  ['changed stderr', f => { f.stderr = Buffer.from('changed'); }],
  ['wrong source-log hash', f => { f.actual.stdoutSha256 = hash('other'); }],
  ['wrong source count', f => { f.actual.files = 198; }],
  ['actual input differs', f => { f.actual.sources['source-0'] = { bytes: 9, sha256: hash('different') }; }],
  ['original input differs', f => { delete f.before.output['source-0']; }],
  ['empty handwritten inputs', f => { f.before.handwritten = {}; f.after.handwritten = {}; }],
  ['source before/after drift', f => { f.after.localRuntime = {}; }],
  ['helper digest drift', f => { f.runtimeAfter[RUNTIME_MANIFEST_FILE].sha256 = hash('changed'); }],
  ['missing helper', f => { delete f.runtimeBefore[RUNTIME_MANIFEST_FILE]; delete f.runtimeAfter[RUNTIME_MANIFEST_FILE]; }],
  ['generated manifest drift', f => { f.input.testFiles.pop(); }],
  ['missing classpath inventory', f => { f.runtime.classpathInventory = {}; syncRuntime(f); }],
  ['missing JAR references', f => { delete f.runtime.jarReferences; syncRuntime(f); }],
  ['wrong JAR manifest schema', f => { f.runtime.jarReferences.schemaVersion = 'old'; syncRuntime(f); }],
  ['unlisted JAR probe', f => { f.runtime.jarReferences.jars = []; syncRuntime(f); }],
  ['injected environment', f => { f.input.env.JAVA_TOOL_OPTIONS = '-javaagent:/foreign.jar'; f.plan.env.JAVA_TOOL_OPTIONS = f.input.env.JAVA_TOOL_OPTIONS; }],
  ['extra sbt execution', f => { f.build.command.push('Test / test'); syncBuild(f); }],
  ['extra Java agent', f => { f.plan.javaOptions.push('-javaagent:/foreign.jar'); }],
  ['execution requested', f => { f.plan.testExecutionRequested = true; }],
  ['missing compile source marker', f => relog(f, f.stdout.toString().replace('TRUTHSRC-RUNTIME-SOURCES=', 'OTHER='))],
  ['duplicate source marker', f => relog(f, f.stdout.toString() + f.stdout.toString().split('\n')[1] + '\n')],
  ['source-log root mismatch', f => relog(f, f.stdout.toString().replace('/src/test/', '/foreign/test/'))],
  ['foreign actual project root', f => relog(f, f.stdout.toString().replace(f.actual.root + '/project', '/foreign/project'))],
  ['unit runner in compile log', f => relog(f, f.stdout.toString() + 'UNIT-JVM-PID=999\n')],
  ['actor runner in compile log', f => relog(f, f.stdout.toString() + '[info] TRUTHSRC-ACTOR-SOURCES=/foreign.scala\n')],
  ['generated runner in compile log', f => relog(f, f.stdout.toString() + '[info] TRUTHSRC-GENERATED-SUITES=ForeignSpec\n')],
  ['classpath log mismatch', f => relog(f, f.stdout.toString().replace('/dependency.jar', '/foreign.jar'))],
  ['noncanonical evidence', f => { f.evidence += '/..'; }],
]) test('receipt gate rejects ' + name, () => { const f = fixture(); mutate(f); assert.throws(() => validateRuntimeReceipts(f)); });

test('receipt gate uses complete source inventory size, not a historical product count', () => {
  for (const sourceCount of [7, 199, 235, 301]) {
    const f = fixture({ sourceCount });
    assert.doesNotThrow(() => validateRuntimeReceipts(f));
    f.actual.files--;
    assert.throws(() => validateRuntimeReceipts(f), /actual source count/);
  }
});

function sourceInventory(generatedCount = 229) {
  const inputs = { generatedFiles: Array.from({ length: generatedCount }, (_, i) => 'app/Source-' + i + '.scala') };
  const envelopes = ['canonical', 'request', 'compiled', 'inputs'].map(name => '.truthsrc/' + name + '.json');
  const files = Object.fromEntries([...inputs.generatedFiles, ...envelopes, 'anchors.json'].map(file => [file, { ...stamp }]));
  const text = JSON.stringify(inputs) + '\n';
  files['.truthsrc/inputs.json'] = { bytes: Buffer.byteLength(text), sha256: hash(text) };
  const ledger = { generator: 'scala-cqrs-play-service', entries: [...inputs.generatedFiles, ...envelopes].map(path => ({ path,
    kind: envelopes.includes(path) ? 'project-evidence' : 'generated-source',
    ownership: { id: join(ROOT, 'truthsrc.project.json'), generator: 'scala-cqrs-play-service', fingerprint: 'sha256:' + files[path].sha256 } })) };
  const ledgerText = JSON.stringify(ledger) + '\n';
  files['truthsrc.ledger.json'] = { bytes: Buffer.byteLength(ledgerText), sha256: hash(ledgerText) };
  return { files, ledger, inputs, text, ledgerText };
}

test('inventory is exactly generatedFiles plus four evidence envelopes, ledger and anchors', () => {
  for (const generatedCount of [1, 193, 229, 295]) {
    const f = sourceInventory(generatedCount);
    assert.equal(validateRuntimeSourceInventory(f.files, f.ledger, f.inputs), generatedCount + 6);
  }
});

for (const [name, mutate] of [
  ['missing product', f => { delete f.files['app/Source-0.scala']; }],
  ['extra unplanned script', f => { f.files['project/evil.sbt'] = stamp; }],
  ['missing anchor envelope', f => { delete f.files['anchors.json']; }],
  ['missing ledger row', f => { f.ledger.entries.pop(); }],
  ['duplicate ledger row', f => { f.ledger.entries.push(f.ledger.entries[0]); }],
  ['retained file and ledger row', f => { f.files['retained.scala'] = stamp; f.ledger.entries.push({ ...f.ledger.entries[0], path: 'retained.scala' }); }],
  ['duplicate generated path', f => { f.inputs.generatedFiles.push(f.inputs.generatedFiles[0]); }],
  ['case-folded alias', f => { f.inputs.generatedFiles.push('app/source-0.scala'); }],
  ['traversal', f => { f.inputs.generatedFiles[0] = '../foreign'; }],
  ['absolute path', f => { f.inputs.generatedFiles[0] = '/foreign'; }],
  ['generated file claiming envelope', f => { f.inputs.generatedFiles.push('anchors.json'); }],
  ['foreign owner', f => { f.ledger.entries[0].ownership.id = '/other/project.json'; }],
  ['foreign generator', f => { f.ledger.entries[0].ownership.generator = 'foreign'; }],
  ['stale ledger digest', f => { f.ledger.entries[0].ownership.fingerprint = 'sha256:' + hash('stale'); }],
  ['invalid SHA', f => { f.files['anchors.json'].sha256 = 'x'; }],
  ['invalid byte count', f => { f.files['anchors.json'].bytes = -1; }],
  ['foreign evidence kind', f => { f.ledger.entries[0].kind = 'project-evidence'; }],
  ['missing generatedFiles', f => { delete f.inputs.generatedFiles; }],
  ['empty producer plan', f => { f.inputs.generatedFiles = []; }],
]) test('source-bound inventory rejects ' + name, () => {
  const f = sourceInventory(); mutate(f);
  assert.throws(() => validateRuntimeSourceInventory(f.files, f.ledger, f.inputs));
});

test('real source-envelope capture binds ledger/generatedFiles to sealed build bytes', t => {
  const root = temporary(t), f = sourceInventory(); mkdirSync(join(root, '.truthsrc'));
  writeFileSync(join(root, 'truthsrc.ledger.json'), f.ledgerText);
  writeFileSync(join(root, '.truthsrc/inputs.json'), f.text);
  assert.equal(captureRuntimeSourceInventory(root, f.files), 235);
  // The count and all remaining stamps still agree: deletion must not pass.
  const fewer = structuredClone(f.files); delete fewer['app/Source-0.scala'];
  assert.throws(() => captureRuntimeSourceInventory(root, fewer), /missing or unplanned/);
  const more = { ...f.files, 'project/evil.sbt': stamp };
  assert.throws(() => captureRuntimeSourceInventory(root, more), /missing or unplanned/);
  // A self-consistent forged manifest is still not the build's captured manifest.
  f.inputs.generatedFiles.shift(); f.ledger.entries.shift();
  writeFileSync(join(root, '.truthsrc/inputs.json'), JSON.stringify(f.inputs));
  writeFileSync(join(root, 'truthsrc.ledger.json'), JSON.stringify(f.ledger));
  assert.throws(() => captureRuntimeSourceInventory(root, fewer), /envelope changed/);
  writeFileSync(join(root, 'truthsrc.ledger.json'), f.ledgerText);
  assert.throws(() => captureRuntimeSourceInventory(root, f.files), /inputs.json/);
});

// Exercise the real exported admission entry, not only the standalone helper.
// Coherently editing all receipt counts/snapshots must still fail against the
// captured envelopes, BEFORE any JDK/runtime-supply admission is attempted.
for (const mode of ['fewer', 'more', 'retained', 'stale-envelope']) test('real admission rejects coordinated ' + mode + ' inventory without a JVM', async t => {
  assert.equal(realpathSync(join(ROOT, 'target')), join(ROOT, 'target'));
  const ownedRoot = mkdtempSync(join(ROOT, 'target/runtime-admission-test-'));
  t.after(() => rmSync(ownedRoot, { recursive: true, force: true }));
  const f = fixture({ ownedRoot }), inventory = sourceInventory();
  mkdirSync(f.evidence); mkdirSync(join(f.input.output, '.truthsrc'), { recursive: true });
  if (mode === 'fewer') delete inventory.files['app/Source-0.scala'];
  if (mode === 'more' || mode === 'retained') inventory.files['retained.scala'] = { ...stamp };
  if (mode === 'retained') {
    inventory.ledger.entries.push({ ...inventory.ledger.entries[0], path: 'retained.scala' });
    inventory.ledgerText = JSON.stringify(inventory.ledger) + '\n';
    inventory.files['truthsrc.ledger.json'] = { bytes: Buffer.byteLength(inventory.ledgerText), sha256: hash(inventory.ledgerText) };
  }
  f.before.output = inventory.files; f.after.output = structuredClone(inventory.files);
  f.actual.sources = structuredClone(inventory.files); f.actual.files = Object.keys(inventory.files).length;
  assert.doesNotThrow(() => validateRuntimeReceipts(f)); // Counts and before/after equality alone are insufficient.
  const names = { input: 'input', result: 'result', runtime: 'runtime-build', build: 'build', actual: 'actual-build-sources',
    before: 'sources-before', after: 'sources-after', runtimeBefore: 'runtime-inputs-before', runtimeAfter: 'runtime-inputs-after', plan: 'build-plan' };
  for (const [key, name] of Object.entries(names)) writeFileSync(join(f.evidence, name + '.json'), JSON.stringify(f[key]));
  writeFileSync(join(f.evidence, 'build.stdout.log'), f.stdout); writeFileSync(join(f.evidence, 'build.stderr.log'), f.stderr);
  writeFileSync(join(f.input.output, 'truthsrc.ledger.json'), mode === 'stale-envelope' ? inventory.ledgerText + '\n' : inventory.ledgerText);
  writeFileSync(join(f.input.output, '.truthsrc/inputs.json'), inventory.text);
  await assert.rejects(admitRuntimeBuild(f.evidence), mode === 'retained' ? /retained\/missing\/foreign ledger/ :
    mode === 'stale-envelope' ? /envelope changed/ : /missing or unplanned build input/);
});

function temporary(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'runtime-admission-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
test('capture parses and hashes identical bounded bytes with strict duplicate/UTF8/number rejection', t => {
  const root = temporary(t), file = join(root, 'receipt.json'), text = '{"checks":{"passed":true}}\n';
  writeFileSync(file, text);
  assert.deepEqual(captureRuntimeFile(file, { json: true }), { value: { checks: { passed: true } }, bytes: Buffer.byteLength(text), sha256: hash(text) });
  for (const invalid of ['{"a":true,"a":false}', '{"a":1.5}', Buffer.from([0xff]), '{"a":true} trailing']) {
    writeFileSync(file, invalid); assert.throws(() => captureRuntimeFile(file, { json: true }));
  }
  writeFileSync(file, text); assert.throws(() => captureRuntimeFile(file, { json: true, limit: 2 }), /bounded regular/);
});
test('capture refuses symlink, hardlink, directory and lexical alias receipts', t => {
  const root = temporary(t), file = join(root, 'receipt.json'); writeFileSync(file, '{}');
  const symbolic = join(root, 'symbolic.json'); symlinkSync(file, symbolic);
  assert.throws(() => captureRuntimeFile(symbolic, { json: true }), /symlink/);
  const hard = join(root, 'hard.json'); linkSync(file, hard);
  assert.throws(() => captureRuntimeFile(hard, { json: true }), /non-hardlinked/);
  assert.throws(() => captureRuntimeFile(root, { json: true }), /unexpected path type/);
  mkdirSync(join(root, 'sub')); assert.throws(() => captureRuntimeFile(root + '/sub/../receipt.json', { json: true }), /canonical/);
});
