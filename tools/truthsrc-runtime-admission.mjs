import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_JSON_BYTES, parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { BUILD_SUPPORT, admitCandidate, actualBuildSourceRoot, compareBuildSources, fileDigest, inventory, succeeded } from './verify-truthsrc-build.mjs';
import { captureRuntimeFile, safePath } from './truthsrc-evidence.mjs';
import { createEvidenceReferences } from '../../metarch-truthsrc/lib/verification/inventory.mjs';

export { captureRuntimeFile } from './truthsrc-evidence.mjs';
import { RUNTIME_MANIFEST_FILE, RUNTIME_MAINS, completeRuntimeCompilation, inspectRuntimeCompilation, runtimeBuildTasks, runtimeClasspathInventory, runtimeTestManifest } from './truthsrc-runtime-tests.mjs';
import { jarManifestProbeSource, validateJarReferences, assertJarReferencesUnchanged } from './truthsrc-runtime-jars.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), TOOL = resolve(ROOT, '../metarch-truthsrc');
const PROJECT = join(ROOT, 'truthsrc.project.json'), HAND = join(ROOT, 'handwritten/scala'), LOCAL = join(ROOT, '.local/truthsrc-runtime');
const VERIFIER = join(ROOT, 'tools/verify-truthsrc-build.mjs'), ARCHIVE_SHA = '95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade';
const CACHES = ['home', 'cache', 'ivy', 'coursier', 'boot', 'global', 'tmp'];
const CHECKS = ['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged', 'supplyUnchanged',
  'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried', 'verifierUnchanged',
  'actualBuildSourcesVerified', 'runtimeTestInputsUnchanged', 'actualRuntimeTestSourcesVerified', 'runtimeClasspathVerified', 'runtimeCompilationPassed'];
const GENERATED = ['GeneratedActorStateSpec', 'GeneratedDomainRoundtripSpec', 'GeneratedFiniteHostSpec',
  'GeneratedServiceConfigurationSpec', 'GeneratedUnitStorageSpec', 'UnitConfigurationCheck'].map(name => 'src/test/scala/' + name + '.scala').sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, file) => file.startsWith(root + '/');
const equal = (actual, expected, label) => assert.deepEqual(actual, expected, label);
const keys = (value, expected, label) => equal(Object.keys(value).sort(), [...expected].sort(), label);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const fingerprint = ({ bytes, sha256 }) => ({ bytes, sha256 });
const snapshot = files => Object.fromEntries(files.map(file => [file, fingerprint(captureRuntimeFile(file, { limit: 512 * 1024 * 1024 }))]));
const RUNTIME_SUPPORT = [RUNTIME_MANIFEST_FILE, join(ROOT, 'tools/truthsrc-runtime-jars.mjs')];
const SUPPORT = [fileURLToPath(import.meta.url), VERIFIER, ...RUNTIME_SUPPORT, join(ROOT, 'tools/truthsrc-actor-tests.mjs'),
  join(ROOT, 'tools/truthsrc-evidence.mjs'),
  ...['strict-json', 'immutable-data', 'verification/files', 'verification/inventory', 'verification/outcome', 'verification/worker-evidence', 'products/request']
    .map(name => join(TOOL, 'lib', name + '.mjs')), join(TOOL, 'bin/truthsrc.js'), join(TOOL, 'package.json')];
const loadedSupport = snapshot(SUPPORT);

function checkProcess(receipt) {
  succeeded(receipt);
  for (const key of ['signal', 'launchError', 'cancelled']) assert.equal(receipt[key], null, key);
  for (const key of ['timedOut', 'leftoverGroup', 'groupAliveAfter']) assert.equal(receipt[key], false, key);
  for (const key of ['directChildClosed', 'directChildReaped']) assert.equal(receipt[key], true, key);
  equal(receipt.terminationErrors, []);
  assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
  assert.ok(Number.isSafeInteger(receipt.elapsedMs) && receipt.elapsedMs >= 0);
  assert.equal(new Date(receipt.startedAt).toISOString(), receipt.startedAt);
  for (const key of ['stdoutSha256', 'stderrSha256', 'sandboxProfileSha256']) assert.match(receipt[key], /^[0-9a-f]{64}$/);
}
function javaOptions(e) {
  const properties = { 'user.home': join(e, 'home'), 'java.io.tmpdir': join(e, 'tmp'), 'sbt.boot.directory': join(e, 'boot'),
    'sbt.global.base': join(e, 'global'), 'sbt.ivy.home': join(e, 'ivy'), 'coursier.cache': join(e, 'coursier'),
    'sbt.repository.config': join(e, 'repositories'), 'sbt.boot.properties': join(e, 'sbt.boot.properties') };
  return ['-XX:-UsePerfData', '-XX:ErrorFile=' + join(e, 'tmp/hs_err_pid%p.log'),
    ...Object.entries(properties).map(([k, v]) => '-D' + k + '=' + v), '-Dsbt.override.build.repos=true',
    '-Djava.util.prefs.userRoot=' + join(e, 'home/.java/userPrefs'), '-Djava.util.prefs.systemRoot=' + join(e, 'home/.java/systemPrefs'),
    '-Dsbt.server.autostart=false', '-Dsbt.server.forcestart=true', '-Dsbt.supershell=false', '-Dsbt.log.noformat=true', '-Dsbt.ci=true'];
}

// These are the project-plan envelope, not a fixed number of generated products.
const PROJECT_EVIDENCE = ['canonical', 'request', 'compiled', 'inputs'].map(name => '.truthsrc/' + name + '.json');
export function validateRuntimeSourceInventory(files, ledger, inputs) {
  assert.equal(ledger.generator, 'scala-cqrs-play-service');
  assert.ok(Array.isArray(ledger.entries) && Array.isArray(inputs.generatedFiles) && inputs.generatedFiles.length > 0);
  assert.ok(inputs.generatedFiles.every(file => !PROJECT_EVIDENCE.includes(file) && !['truthsrc.ledger.json', 'anchors.json'].includes(file)),
    'generated files cannot claim ledger/anchor/evidence envelopes');
  const planned = [...inputs.generatedFiles, ...PROJECT_EVIDENCE];
  for (const file of [...planned, ...ledger.entries.map(row => row.path)])
    assert.ok(typeof file === 'string' && /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) &&
      !file.split('/').some(part => ['.', '..'].includes(part)), 'plain relative inventory path required');
  assert.equal(new Set(planned.map(file => file.toLowerCase())).size, planned.length, 'duplicate generated/evidence paths');
  equal(ledger.entries.map(row => row.path).sort(), [...planned].sort(), 'retained/missing/foreign ledger entries forbidden');
  keys(files, [...planned, 'truthsrc.ledger.json', 'anchors.json'], 'missing or unplanned build input');
  for (const [file, stamp] of Object.entries(files)) {
    assert.ok(Number.isSafeInteger(stamp.bytes) && stamp.bytes >= 0, 'invalid inventory size: ' + file);
    assert.match(stamp.sha256, /^[0-9a-f]{64}$/);
  }
  for (const row of ledger.entries) {
    equal([row.ownership?.id, row.ownership?.generator], [PROJECT, ledger.generator], 'foreign ownership');
    assert.equal(row.ownership.fingerprint, 'sha256:' + files[row.path].sha256, 'stale ledger fingerprint');
    assert.equal(row.kind === 'project-evidence', PROJECT_EVIDENCE.includes(row.path), 'foreign project evidence');
  }
  return Object.keys(files).length;
}

// Bind the parsed inventory to the exact bytes sealed by the build, not a caller's
// self-consistent replacement ledger. admitCandidate additionally re-derives the
// current producer plan; these captured envelopes remain in assertUnchanged.
export function captureRuntimeSourceInventory(output, files, capture = captureRuntimeFile) {
  const read = name => {
    const captured = capture(join(output, name), { json: true });
    equal(fingerprint(captured), files[name], 'build inventory envelope changed: ' + name);
    return captured.value;
  };
  return validateRuntimeSourceInventory(files, read('truthsrc.ledger.json'), read('.truthsrc/inputs.json'));
}

// Pure receipt gate, separately testable without generating/admitting an application or launching a JVM.
export function validateRuntimeReceipts({ evidence, input, result, runtime, build, actual, before, after, runtimeBefore, runtimeAfter, plan, stdout, stderr }) {
  assert.equal(result.schemaVersion, 'bank.truthsrc-build/v1'); assert.equal(runtime.schemaVersion, 'bank.truthsrc-runtime-build/v1');
  assert.equal(result.status, 'passed'); equal(result.errors, []); assert.equal(result.cancelled, null);
  for (const key of ['compileRuntimeTests', 'compileGeneratedTests']) assert.equal(result[key], true, key);
  for (const key of ['runGeneratedTests', 'runActorTests', 'testsExecuted', 'servicesStarted', 'runtimeRebuilt', 'runtimePublished', 'release1134Resigned']) assert.equal(result[key], false, key);
  assert.equal(result.runtimeRetryBackoffDeadline, 'OPEN');
  equal(result.actorTests, { requested: false, passed: false });
  equal(result.generatedTests, { requested: false, evidenceState: 'not-dispatched', jvmStarted: false, started: false, completed: false, passed: false });
  for (const key of ['compileRuntimeTests', 'compileTests']) assert.equal(input[key], true, key);
  for (const key of ['runTests', 'runActors', 'compilerBridgePrefill', 'inheritedEnvironment']) assert.equal(input[key], false, key);
  assert.equal(input.actor, null); assert.equal(input.testManifest, null);
  const { output, javaHome } = input, java = join(javaHome, 'bin/java'), digest = hash(stdout);
  for (const file of [evidence, output, javaHome, input.archive, actual.root])
    assert.ok(typeof file === 'string' && resolve(file) === file && /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) && !file.split('/').includes('.scratch'), 'canonical receipt path required');
  assert.ok(within(join(ROOT, 'target'), evidence) && [join(ROOT, 'target'), join(ROOT, 'generated')].some(root => within(root, output)));
  for (const [a, b] of [[output, evidence], [input.archive, evidence], [output, input.archive]]) assert.ok(a !== b && !within(a, b) && !within(b, a), 'overlapping inputs/evidence');
  equal([input.evidence, result.evidence, runtime.buildEvidence], [evidence, evidence, evidence]);
  equal([result.output, runtime.output, actual.admittedOutput], [output, output, output]); assert.equal(result.javaHome, javaHome);
  equal([input.project, input.handwrittenRoot, input.toolRoot], [PROJECT, HAND, TOOL]);
  equal(input.generator, { id: 'scala-cqrs-play-service', version: '1' });
  equal(result.archive, { file: input.archive, expectedSha256: ARCHIVE_SHA, sha256: ARCHIVE_SHA }); assert.equal(input.archiveSha256, ARCHIVE_SHA);
  keys(input.initiallyEmpty, CACHES); assert.ok(Object.values(input.initiallyEmpty).every(value => value === true));
  keys(result.checks, CHECKS); for (const key of CHECKS) assert.equal(result.checks[key], true, key);
  for (const key of ['passed', 'sourceBound', 'processPassed']) assert.equal(runtime[key], true, key);
  for (const key of ['testsExecuted', 'servicesStarted']) assert.equal(runtime[key], false, key);
  equal(runtime.errors, []); equal(result.runtimeCompilation, runtime);
  equal(completeRuntimeCompilation(runtime, result.checks, true, result.errors), runtime);
  checkProcess(build); equal(result.phases.build, build); assert.equal(build.cwd, output);
  assert.equal(build.timeoutMs, 480_000); assert.equal(build.graceMs, 15_000);
  equal([build.stdoutSha256, runtime.buildStdoutSha256, actual.stdoutSha256], [digest, digest, digest]); assert.equal(build.stderrSha256, hash(stderr));
  equal(input.testFiles, GENERATED); assert.equal(input.runtimeManifest.sourceCount, 5);
  assert.equal(input.runtimeManifest.schemaVersion, 'bank.truthsrc-runtime-tests/v1');
  equal(input.runtimeManifest.sources.map(row => row.name), RUNTIME_MAINS); equal(runtime.manifest, input.runtimeManifest);
  equal(plan.tasks, runtimeBuildTasks(GENERATED, runtime.manifest)); equal(plan.javaOptions, javaOptions(evidence));
  equal(build.command, ['/usr/bin/sandbox-exec', '-f', join(evidence, 'sandbox.sb'), java, '-Xmx2G', '-XX:ActiveProcessorCount=2',
    ...plan.javaOptions, '-cp', join(evidence, 'supply/launcher/sbt-launch.jar'), 'xsbt.boot.Boot', ...plan.tasks]);
  equal(plan.allowedAppArtifactDirectories, ['target', 'project/target', 'project/project/target']);
  equal(plan.explicitFrozenRuntimeSources, runtime.manifest.sources); equal(plan.explicitFrozenActorSources, []);
  assert.equal(plan.historicalTestSourcesAppended, true); assert.equal(plan.testExecutionRequested, false); assert.equal(plan.testExecutionSupported, true); assert.equal(plan.testManifest, null);
  const env = { HOME: join(evidence, 'home'), USERPROFILE: join(evidence, 'home'), JAVA_HOME: javaHome,
    PATH: join(javaHome, 'bin') + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: join(evidence, 'tmp'),
    XDG_CACHE_HOME: join(evidence, 'cache'), XDG_CONFIG_HOME: join(evidence, 'home/.config'), XDG_DATA_HOME: join(evidence, 'home/.local/share'),
    COURSIER_CACHE: join(evidence, 'coursier'), COURSIER_JVM_CACHE: join(evidence, 'cache/jvm'), COURSIER_ARCHIVE_CACHE: join(evidence, 'cache/archives'),
    COURSIER_REPOSITORIES: pathToFileURL(join(evidence, 'supply/maven')).href + '/|ivy:' + pathToFileURL(join(evidence, 'supply/ivy')).href +
      '/[organization]/[module]/(scala_[scalaVersion]/)(sbt_[sbtVersion]/)[revision]/[type]s/[artifact](-[classifier]).[ext]' };
  equal(input.env, env); equal(plan.env, { ...env, JAVA_TOOL_OPTIONS: plan.javaOptions.join(' ') });
  equal([plan.sandbox.profile, plan.sandbox.sha256], [join(evidence, 'sandbox.sb'), build.sandboxProfileSha256]);
  const actualRoot = actualBuildSourceRoot(stdout.toString('utf8'), output, evidence);
  equal([runtime.actualRoot, actual.root], [actualRoot, actualRoot]); assert.equal(actual.staged, actualRoot !== output);
  assert.equal(actual.passed, true);
  const sourceFiles = compareBuildSources(before.output, actual.sources).files;
  assert.equal(actual.files, sourceFiles, 'actual source count differs from complete build inventory');
  keys(before, ['output', 'handwritten', 'localRuntime']); keys(after, [...Object.keys(before), 'supply']);
  for (const key of Object.keys(before)) { assert.ok(Object.keys(before[key]).length > 0, 'empty source inventory'); equal(after[key], before[key]); }
  assert.equal(Object.keys(after.supply).length, 1065);
  equal(runtimeAfter, runtimeBefore); keys(runtimeBefore, [...runtime.manifest.sources.map(row => row.file), ...RUNTIME_SUPPORT]);
  for (const row of runtime.manifest.sources) assert.equal(runtimeBefore[row.file].sha256, row.sha256);
  assert.ok(!/(?:TRUTHSRC-(?:ACTOR-SOURCES|GENERATED-SUITES)=|UNIT-JVM-PID=|Run starting\. Expected test count)/.test(stdout.toString('utf8')), 'execution marker in compile-only log');
  const closure = inspectRuntimeCompilation(stdout.toString('utf8'), actualRoot, GENERATED, runtime.manifest);
  assert.equal(closure.sources.length, 11); equal(runtime.sources, closure.sources); equal(runtime.classpath, closure.classpath);
  keys(runtime.classpathInventory, closure.classpath); assert.equal(runtime.jarReferences.schemaVersion, 'bank.truthsrc-runtime-jars/v1');
  equal(runtime.jarReferences.jars.map(row => row.file), closure.classpath.filter(file => file.endsWith('.jar'))); assert.ok(Array.isArray(runtime.jarReferences.references));
  return { output, actualRoot, classpath: closure.classpath, javaHome, java };
}

export async function admitRuntimeBuild(buildEvidence) {
  safePath(buildEvidence); assert.equal(realpathSync(buildEvidence), buildEvidence);
  assert.ok(within(join(ROOT, 'target'), buildEvidence), 'build evidence must be under bank target/');
  equal(snapshot(SUPPORT), loadedSupport, 'loaded admission/verifier/helper changed');
  const receipts = {}, references = createEvidenceReferences();
  const capture = (file, { json = true } = {}) => {
    const limit = json ? MAX_JSON_BYTES : 32 * 1024 * 1024, captured = captureRuntimeFile(file, { json, limit });
    assert.ok(!Object.hasOwn(receipts, file), 'duplicate capture'); receipts[file] = fingerprint(captured);
    references.retain({ file, ...fingerprint(captured) }, { limit });
    return captured;
  };
  const read = (file, json = true) => capture(file, { json }).value;
  const names = { input: 'input', result: 'result', runtime: 'runtime-build', build: 'build', actual: 'actual-build-sources',
    before: 'sources-before', after: 'sources-after', runtimeBefore: 'runtime-inputs-before', runtimeAfter: 'runtime-inputs-after', plan: 'build-plan' };
  const records = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, read(join(buildEvidence, name + '.json'))]));
  const stdout = read(join(buildEvidence, 'build.stdout.log'), false), stderr = read(join(buildEvidence, 'build.stderr.log'), false);
  const descriptor = validateRuntimeReceipts({ ...records, evidence: buildEvidence, stdout, stderr });
  const { output, actualRoot, classpath, javaHome, java } = descriptor, { input, runtime, before, after, result, plan } = records;
  const sourceCount = captureRuntimeSourceInventory(output, before.output, capture);
  assert.equal(sourceCount, records.actual.files, 'actual sources differ from source-bound plan');
  for (const root of [output, actualRoot, javaHome, TOOL, HAND, LOCAL]) { safePath(root); assert.equal(realpathSync(root), root); }
  const toolchain = [java, join(javaHome, 'bin/javac'), join(javaHome, 'release'), '/usr/bin/python3', '/usr/bin/sandbox-exec'];
  keys(input.toolchain, toolchain); equal(input.verifier, { file: VERIFIER, sha256: loadedSupport[VERIFIER].sha256 });
  equal(input.verifierSupport, snapshot(BUILD_SUPPORT), 'build file-evidence helpers changed');
  const node = safePath(realpathSync(process.execPath), 'file'), tools = snapshot([...toolchain, node]);
  for (const file of toolchain) assert.equal(tools[file].sha256, input.toolchain[file], 'build toolchain changed: ' + file);
  const release = read(join(javaHome, 'release'), false).toString('utf8');
  assert.match(release, /^JAVA_VERSION="11(?:\.|\")/m); assert.match(release, /^OS_ARCH="(?:x86_64|amd64)"/m);
  const manifest = runtimeTestManifest(file => read(file, false).toString('utf8'));
  equal(manifest, runtime.manifest, 'current runtime manifest differs');
  const runtimeInputs = snapshot([...manifest.sources.map(row => row.file), ...RUNTIME_SUPPORT]);
  equal(runtimeInputs, records.runtimeBefore, 'runtime inputs/helper changed since compile');
  for (const row of manifest.sources) assert.equal(receipts[row.file].sha256, runtimeInputs[row.file].sha256);
  const admitted = await admitCandidate(output, { runTests: false }, { afterBuild: true });
  equal(input.sources, admitted.captured.sources, 'current project/tool sources differ'); equal(input.generator, admitted.generator);
  equal(admitted.testFiles, GENERATED); equal({ output: admitted.before, handwritten: admitted.handwritten, localRuntime: admitted.runtime }, before);
  const sourceFiles = snapshot(admitted.captured.sources.filter(row => row.file).map(row => row.file));
  for (const row of admitted.captured.sources.filter(row => row.file)) equal(sourceFiles[row.file], { bytes: row.bytes, sha256: row.sha256 });
  const toolDirectories = ['lib', 'src', 'generators', 'schema', 'scaffold'];
  const toolTree = () => Object.fromEntries(toolDirectories.map(dir => [dir, inventory(join(TOOL, dir))]));
  const toolBefore = toolTree(), helpers = { safePath, inventory, fileDigest };
  equal(runtimeClasspathInventory(classpath, actualRoot, buildEvidence, helpers), runtime.classpathInventory, 'compiled classpath changed');
  const supply = read(join(buildEvidence, 'supply-before.json'));
  equal(supply.counts, { maven: 1048, ivy: 16, launcher: 1 }); assert.equal(supply.archiveSha256, ARCHIVE_SHA); equal(supply.files, after.supply);
  const cacheBefore = read(join(buildEvidence, 'cache-before.json')), cacheAfter = read(join(buildEvidence, 'cache-after.json'));
  keys(cacheBefore, CACHES); keys(cacheAfter, CACHES); for (const name of CACHES) equal(cacheBefore[name], {});
  const sandbox = read(join(buildEvidence, 'sandbox-before.json')), sandboxAfter = read(join(buildEvidence, 'sandbox-after.json'));
  equal(sandbox.subpaths, [buildEvidence, ...['target', 'project/target', 'project/project/target'].map(dir => join(output, dir))]);
  equal(sandbox.literals, [join(output, 'project/project'), '/dev/null']); assert.equal(sandbox.executable, '/usr/bin/sandbox-exec');
  assert.equal(sandbox.network, 'deny network* (unconditional)'); assert.equal(sandbox.defaultFileWrites, 'deny file-write*'); equal(sandbox.deviceWriteExceptions, ['/dev/null']);
  keys(sandbox.controlsBefore, ['sandbox.sb', 'boundary/probe.py', 'boundary/TruthsrcSandboxProbe.java'].map(file => join(buildEvidence, file)));
  safePath(sandbox.canaries); assert.equal(dirname(sandbox.canaries), dirname(buildEvidence)); assert.ok(basename(sandbox.canaries).startsWith('truthsrc-build-canaries-'));
  keys(sandbox.canariesBefore, ['write-canary', 'delete-canary']); equal(sandboxAfter.canaries, sandbox.canariesBefore);
  assert.equal(sandbox.escape, join(buildEvidence, 'boundary/escape'));
  const checkCanaries = () => {
    equal(inventory(sandbox.canaries), sandbox.canariesBefore);
    assert.ok(lstatSync(sandbox.escape).isSymbolicLink()); assert.equal(readlinkSync(sandbox.escape), sandbox.canaries); assert.equal(realpathSync(sandbox.escape), sandbox.canaries);
  };
  equal(plan.sandbox, { profile: sandbox.profile, sha256: sandbox.profileSha256, subpaths: sandbox.subpaths, literals: sandbox.literals });
  assert.equal(sandboxAfter.canariesUnchanged, true); assert.equal(sandboxAfter.controlsUnchanged, true);
  equal(sandbox.historicalReadDenials, []);
  const policy = '(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write*\n' + sandbox.subpaths.map(path => '  (subpath ' + JSON.stringify(path) + ')').join('\n') + '\n' + sandbox.literals.map(path => '  (literal ' + JSON.stringify(path) + ')').join('\n') + ')\n';
  assert.equal(read(join(buildEvidence, 'sandbox.sb'), false).toString('utf8'), policy); assert.equal(hash(policy), sandbox.profileSha256);
  const controls = snapshot(Object.keys(sandbox.controlsBefore));
  for (const [file, digest] of Object.entries(sandbox.controlsBefore)) assert.equal(controls[file].sha256, digest);
  const boundary = join(buildEvidence, 'boundary'), py = '/usr/bin/python3', e = buildEvidence, phaseLogs = {};
  const phases = [
    ['javac', 'javac', e, 45000, join(javaHome, 'bin/javac'), ['-J-XX:-UsePerfData', '-J-Duser.home=' + input.env.HOME, '-J-Djava.io.tmpdir=' + input.env.TMPDIR, '-proc:none', '-classpath', boundary, '-d', boundary, join(boundary, 'TruthsrcSandboxProbe.java')]],
    ['sandboxProbe', 'sandbox-check', output, 30000, java, ['-XX:-UsePerfData', '-Duser.home=' + input.env.HOME, '-Djava.io.tmpdir=' + input.env.TMPDIR, '-cp', boundary, 'TruthsrcSandboxProbe', e, sandbox.canaries, sandbox.escape, py, join(boundary, 'probe.py')]],
    ['extract', 'extract', e, 480000, py, ['-I', '-S', join(e, 'extract-supply.py'), input.archive, join(e, 'supply'), ARCHIVE_SHA]],
    ['runtimeJars', 'runtime-jars-probe', e, 30000, py, ['-I', '-S', join(e, 'runtime-jars.py'), join(e, 'runtime-jars-input.json')]],
  ];
  keys(result.phases, ['build', ...phases.map(row => row[0])]);
  for (const [phase, name, cwd, timeout, executable, args] of phases) {
    const receipt = read(join(e, name + '.json')); equal(receipt, result.phases[phase]); checkProcess(receipt);
    equal(receipt.command, ['/usr/bin/sandbox-exec', '-f', sandbox.profile, executable, ...args]); assert.equal(receipt.cwd, cwd); assert.equal(receipt.timeoutMs, timeout); assert.equal(receipt.graceMs, 15000); assert.equal(receipt.sandboxProfileSha256, sandbox.profileSha256);
    for (const stream of ['stdout', 'stderr']) { const bytes = read(join(e, name + '.' + stream + '.log'), false); assert.equal(hash(bytes), receipt[stream + 'Sha256']); if (stream === 'stdout') phaseLogs[phase] = bytes; }
  }
  equal(parseStrictJson(phaseLogs.extract), supply, 'extraction output differs from admitted supply');
  equal(read(join(e, 'sandbox-probe.json')), { status: 'passed', canariesUnchanged: true, controlsUnchanged: true, canaries: sandbox.canariesBefore, actualSyscalls: true, successfulConnections: 0, successfulListenerBinds: 0, javaManagerRemoved: true, nativeChildInherited: true, nativeGrandchildInherited: true });
  for (const marker of ['SECURITY-MANAGER installed-permissive-then-null', ...['java-null-manager', 'native-child', 'native-grandchild'].map(role => 'TRUTHSRC-OS-SANDBOX-PROBE-OK role=' + role)]) assert.ok(phaseLogs.sandboxProbe.toString('utf8').includes(marker));
  assert.equal(read(join(e, 'runtime-jars.py'), false).toString('utf8'), jarManifestProbeSource); equal(read(join(e, 'runtime-jars-input.json')), classpath.filter(file => file.endsWith('.jar')));
  const jarReferences = validateJarReferences(classpath, parseStrictJson(phaseLogs.runtimeJars), helpers);
  equal(read(join(e, 'runtime-jars.json')), jarReferences); equal(runtime.jarReferences, jarReferences);
  const verifierText = read(VERIFIER, false).toString('utf8');
  for (const [name, file] of [['extractSource', 'extract-supply.py'], ['sandboxPythonSource', 'boundary/probe.py'], ['sandboxJavaSource', 'boundary/TruthsrcSandboxProbe.java']]) {
    const match = verifierText.match(new RegExp('const ' + name + ' = String\\.raw`([\\s\\S]*?)`;')); assert.ok(match, 'verifier control source unavailable'); assert.equal(read(join(e, file), false).toString('utf8'), match[1]);
  }
  for (const file of ['repositories', 'sbt.boot.properties']) read(join(e, file), false);
  const owner = read(join(output, 'target/truthsrc-build-owner.json')); keys(owner, ['evidence', 'pid', 'project']); equal([owner.evidence, owner.project], [e, PROJECT]); assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  const artifactsBefore = inventory(output);
  // No mutable build-cache exemption; runtime journals belong to the controller's NEW round, not here.
  const assertUnchanged = async () => {
    for (const file of Object.keys(receipts)) safePath(file, 'file');
    references.assertUnchanged();
    equal(snapshot(SUPPORT), loadedSupport); equal(snapshot(Object.keys(tools)), tools); equal(snapshot(Object.keys(controls)), controls);
    checkCanaries(); equal(inventory(output), artifactsBefore, 'build artifacts changed'); assertJarReferencesUnchanged(jarReferences, helpers);
    admitted.assertUnchanged(admitted.captured); equal(snapshot(Object.keys(sourceFiles)), sourceFiles); equal(toolTree(), toolBefore);
    for (const [key, root, opts] of [['output', output, { afterBuild: true }], ['handwritten', HAND, {}], ['localRuntime', LOCAL, {}], ['supply', join(buildEvidence, 'supply'), {}]]) equal(inventory(root, opts), after[key], key + ' changed');
    assert.equal(compareBuildSources(before.output, inventory(actualRoot, { afterBuild: true })).files, sourceCount);
    equal(snapshot(Object.keys(runtimeInputs)), runtimeInputs); equal(runtimeTestManifest(file => captureRuntimeFile(file).value.toString('utf8')), manifest);
    equal(runtimeClasspathInventory(classpath, actualRoot, buildEvidence, helpers), runtime.classpathInventory, 'runtime classpath changed');
    for (const name of CACHES) equal(inventory(join(buildEvidence, name)), cacheAfter[name], 'build cache changed: ' + name);
  };
  await assertUnchanged();
  return freeze({ ...descriptor, node, buildEvidence, manifest, mains: [...RUNTIME_MAINS], jarReferences,
    before: { sourceFiles: sourceCount, runtimeSources: 5, generatedTestSources: 6, checks: CHECKS.length, receipts: structuredClone(receipts),
      classpathInventory: structuredClone(runtime.classpathInventory), toolchain: structuredClone(tools), runtimeInputs: structuredClone(runtimeInputs) }, assertUnchanged });
}
