import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { safePath } from './truthsrc-evidence.mjs';
import { fingerprintEvidenceFile } from '../../metarch-truthsrc/lib/verification/files.mjs';
import { compareEvidenceInventories, inventoryEvidence, snapshotEvidenceFiles } from '../../metarch-truthsrc/lib/verification/inventory.mjs';
import { verificationOutcome } from '../../metarch-truthsrc/lib/verification/outcome.mjs';
import { SUPPLY_SUPPORT, LEGACY_ENGINE_FILES, capturePreparedRuntime, validateComposedSupply,
  engineClasspathTasks, inspectEngineClasspath } from './truthsrc-acceptance-supply.mjs';

export { safePath } from './truthsrc-evidence.mjs';
import {
  ACTOR_FIXTURE, ACTOR_READ_DENIALS, ACTOR_SUPPORT, ACTOR_WORKER, actorOwnedRoot, actorReadProbeSource,
  actorSuiteNames, actorTestManifest, combineActorManifest, verifyActorWorkers,
} from './truthsrc-actor-tests.mjs';
import {
  RUNTIME_MANIFEST_FILE, completeRuntimeCompilation, inspectRuntimeCompilation,
  runtimeBuildTasks, runtimeClasspathInventory, runtimeTestManifest,
} from './truthsrc-runtime-tests.mjs';
import { jarManifestProbeSource, validateJarReferences, assertJarReferencesUnchanged } from './truthsrc-runtime-jars.mjs';
import {
  READSIDE_DEPENDENCY, READSIDE_EXECUTION_CHECKS, READSIDE_MANIFEST_FILE, READSIDE_SCOPE, READSIDE_SOURCES_MARKER,
  combineReadsideManifest, inspectReadsideSources, readsideSourceFiles, readsideSuiteNames, readsideTestManifest,
} from './truthsrc-readside-tests.mjs';

// Deliberately independent of the historical release/cold-build drivers.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = resolve(ROOT, '../metarch-truthsrc');
const PROJECT = join(ROOT, 'truthsrc.project.json');
const HANDWRITTEN = join(ROOT, 'handwritten/scala');
const RUNTIME = join(ROOT, '.local/truthsrc-runtime');
const DEFAULT_JAVA_HOME = '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home';
const PYTHON = '/usr/bin/python3';
const SANDBOX = '/usr/bin/sandbox-exec';
const ARCHIVE_SHA = '95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade';
const GENERATOR = 'scala-cqrs-play-service';
const ARTIFACT_DIRS = ['target', 'project/target', 'project/project/target'];
const CACHE_DIRS = ['home', 'cache', 'ivy', 'coursier', 'boot', 'global', 'tmp'];
const GRACE_MS = 15_000;
const REAP_POLL_MS = 5_000;
const GENERATED_SUITES = [
  ['GeneratedActorStateSpec', 3],
  ['GeneratedDomainRoundtripSpec', 5],
  ['GeneratedFiniteHostSpec', 0],
  ['example.bankwealth.service.GeneratedServiceConfigurationSpec', 11],
  ['example.bankwealth.service.GeneratedUnitStorageSpec', 4],
];
const UNIT_CONFIGURATION = 'UNIT-CONFIGURATION-OK journal=testkit snapshot=testkit network=denied';
const SUITES_MARKER = 'TRUTHSRC-GENERATED-SUITES=';
const usage = `Usage: node tools/verify-truthsrc-build.mjs \\
  --project-output <absolute-fresh-generated-root> \\
  --archive <absolute-clean-1134.tar.gz> --runtime-supply <absolute-prepared-0.3.0-root> \\
  --evidence <absolute-new-evidence-root> \\
  [--java-home <absolute-JDK11-home>] [--compile-generated-tests]
  [--run-generated-tests | --run-actor-tests | --run-readside-tests | --compile-runtime-tests]

Output must be under this bank's generated/ or target/; evidence under target/.
Parents must exist. No symlinks, path aliases, spaces, or .scratch paths.
Default: compile the service and original handwritten Scala. --compile-generated-tests
only compiles generated test sources. --run-generated-tests compiles and executes ONLY
the admitted generated unit suites. --run-actor-tests additionally runs eight fixed
business actor suites with testkit and a new, explicitly configured local TA journal.
--run-readside-tests instead adds five SHA-pinned frozen readside suites (24 tests)
to the six generated source files (23 tests), with embedded in-memory H2 2.2.224 only.
No TA workers/journals, HTTP server, real MySQL, cross-JVM or 1134 acceptance is implied.
All execution modes use the generated Test / test and forked unit JVM with OS network denial.
--compile-runtime-tests only compiles five fixed integration mains alongside generated
tests and seals their classpath; it does not execute them. No HTTP, database services,
arbitrary sbt tasks, or whole-directory historical tests are accepted.
Each attempt needs a fresh candidate and a new evidence directory. No cleanup,
network resolution, runtime rebuild/publish, or historical acceptance runner.`;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const READSIDE_HELPER_SHA256 = fileDigest(READSIDE_MANIFEST_FILE);
export const BUILD_SUPPORT = Object.freeze([join(ROOT, 'tools/truthsrc-evidence.mjs'),
  ...['verification/files', 'verification/inventory', 'verification/outcome', 'immutable-data', 'strict-json'].map(name => join(TOOL, 'lib', name + '.mjs')), ...SUPPLY_SUPPORT]);
const loadedBuildSupport = snapshotFiles(BUILD_SUPPORT);
const json = value => JSON.stringify(value, null, 2) + '\n';
const save = (file, value) => writeFileSync(file, json(value), { flag: 'wx', mode: 0o600 });
const write = (file, text) => writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
const fold = name => name.normalize('NFC').toLowerCase();
const within = (root, file) => file === root || file.startsWith(root + '/');
const overlap = (a, b) => within(a, b) || within(b, a);
let cancelled = null;
let stopChild = null;
const cancel = signal => { cancelled ??= signal; stopChild?.(signal); };
const onInt = () => cancel('SIGINT');
const onTerm = () => cancel('SIGTERM');
const notCancelled = () => assert.ok(!cancelled, 'verification cancelled: ' + cancelled);

export function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    assert.ok(!flags.has(flag), usage);
    if (['--compile-generated-tests', '--run-generated-tests', '--run-actor-tests', '--run-readside-tests', '--compile-runtime-tests'].includes(flag)) { flags.set(flag, true); continue; }
    assert.ok(['--project-output', '--archive', '--runtime-supply', '--evidence', '--java-home'].includes(flag) &&
      args[i + 1] && !args[i + 1].startsWith('--'), usage);
    flags.set(flag, args[++i]);
  }
  for (const flag of ['--project-output', '--archive', '--runtime-supply', '--evidence']) assert.ok(flags.has(flag), usage);
  const runActors = flags.has('--run-actor-tests'), runReadside = flags.has('--run-readside-tests');
  const compileRuntimeTests = flags.has('--compile-runtime-tests');
  assert.ok([runActors, runReadside, flags.has('--run-generated-tests'), compileRuntimeTests].filter(Boolean).length <= 1, 'choose one explicit execution mode');
  const runTests = runActors || runReadside || flags.has('--run-generated-tests');
  return { output: flags.get('--project-output'), archive: flags.get('--archive'), runtimeSupply: flags.get('--runtime-supply'),
    evidence: flags.get('--evidence'), javaHome: flags.get('--java-home') ?? DEFAULT_JAVA_HOME,
    compileTests: runTests || compileRuntimeTests || flags.has('--compile-generated-tests'), runTests, runActors, runReadside, compileRuntimeTests };
}

export function generatedTestManifest(entries, { runTests = true } = {}) {
  if (!runTests) return null;
  const files = entries.filter(e => e.path.startsWith('src/test/scala/') && e.path.endsWith('.scala'));
  const expectedFiles = ['src/test/scala/UnitConfigurationCheck.scala', ...GENERATED_SUITES.map(([name]) =>
    'src/test/scala/' + name.split('.').at(-1) + '.scala')];
  assert.deepEqual(files.map(e => e.path).sort(), expectedFiles.sort(), 'unexpected generated unit source set');
  const suites = GENERATED_SUITES.map(([name, count]) => {
    const shortName = name.split('.').at(-1), file = 'src/test/scala/' + shortName + '.scala';
    const content = files.find(e => e.path === file).content;
    const declaration = [...content.matchAll(/^final class ([A-Za-z][A-Za-z0-9]*) extends AnyFunSuite \{/gm)];
    assert.deepEqual(declaration.map(m => m[1]), [shortName], 'unexpected generated suite class: ' + file);
    const packages = [...content.matchAll(/^package ([A-Za-z][A-Za-z0-9.]*)$/gm)].map(m => m[1]);
    assert.deepEqual(packages, name.includes('.') ? [name.slice(0, name.lastIndexOf('.'))] : [], 'unexpected suite package: ' + file);
    // This is the admitted generator's literal test declaration, not a Scala parser.
    const tests = [...content.matchAll(/^  test\(("(?:[^"\\\r\n]|\\.)*")\) \{/gm)].map(m => JSON.parse(m[1]));
    assert.equal(tests.length, count, 'generated unit test count changed: ' + name);
    assert.equal(new Set(tests).size, count, 'duplicate generated test name: ' + name);
    return { name, file, sha256: hash(content), tests };
  });
  return { suites, suiteCount: suites.length, testCount: suites.reduce((sum, suite) => sum + suite.tests.length, 0),
    zeroTestSuites: suites.filter(suite => suite.tests.length === 0).map(suite => suite.name) };
}

export function buildTasks(testFiles, { compileTests = false, runTests = false, runActors = false, runReadside = false } = {}, manifest = null, actor = null) {
  assert.ok(!(runActors && runReadside), 'choose one explicit execution mode');
  const actorFiles = runActors ? manifest.suites.filter(suite => suite.sourceKind === 'frozen-business-test').map(suite => suite.file).sort() : [];
  if (runActors) {
    assert.ok(runTests && actor, 'actor execution requires explicit manifest and configuration');
    assert.deepEqual(actorFiles.map(file => basename(file)).sort(), actorSuiteNames().map(name => name.split('.').at(-1) + '.scala').sort());
  }
  if (runReadside) assert.ok(runTests && !actor, 'readside execution requires its own manifest, without actor configuration');
  const readsideFiles = runReadside ? readsideSourceFiles(manifest, testFiles) : [];
  const sources = [...testFiles.map(file => 'baseDirectory.value / ' + JSON.stringify(file)),
    ...[...actorFiles, ...readsideFiles].map(file => 'file(' + JSON.stringify(file) + ')')];
  const tasks = [
    'set Test / unmanagedSourceDirectories := Seq(baseDirectory.value / "src" / "test" / "scala")',
    'set Test / unmanagedSources := Seq(' + sources.join(', ') + ')',
    'set Test / unmanagedResourceDirectories := Seq(baseDirectory.value / "src" / "test" / "resources")',
    ...(runReadside ? ['set libraryDependencies += ' + READSIDE_DEPENDENCY.map(value => JSON.stringify(value)).join(' % ') + ' % Test'] : []),
    ...(runActors ? ['set Test / javaOptions ++= Seq(' + [
      '-Dbank.mock-ta.node=' + actor.node, '-Dbank.mock-ta.worker=' + actor.worker, '-Dbank.mock-ta.owned-root=' + actor.ownedRoot,
    ].map(value => JSON.stringify(value)).join(', ') + ')'] : []),
    'show externalResolvers', 'show csrCacheDirectory', 'compile', 'show Compile / fullClasspath',
    ...(compileTests || runTests ? ['Test / compile'] : []),
  ];
  if (runTests) {
    assert.ok(manifest?.suites?.length, 'admitted generated test manifest required');
    const names = manifest.suites.map(suite => suite.name).sort();
    assert.deepEqual(names, [...GENERATED_SUITES.map(([name]) => name), ...(runActors ? actorSuiteNames() : runReadside ? readsideSuiteNames() : [])].sort(), 'unexpected test suites');
    // Add pre-fork assertions; do not replace the generated task or its manager.
    const actualSources = runActors || runReadside ? ' val sourcePaths = (Test / sources).value.map(_.getCanonicalPath).sorted; ' +
      'require(sourcePaths == Seq(' + sources.map(source => '(' + source + ').getCanonicalPath').join(', ') + ').sorted, "unexpected test source closure"); ' +
      'println(' + JSON.stringify(runReadside ? READSIDE_SOURCES_MARKER : 'TRUTHSRC-ACTOR-SOURCES=') + ' + sourcePaths.mkString(",")); ' : ' ';
    tasks.push('set Test / javaOptions += { val suites = (Test / definedTests).value.map(_.name).sorted; ' +
      'require(suites == Seq(' + names.map(name => JSON.stringify(name)).join(', ') + '), "unexpected test suites"); ' +
      'println(' + JSON.stringify(SUITES_MARKER) + ' + suites.mkString(","));' + actualSources + '"-Dtruthsrc.unit-admitted=true" }',
    'Test / test');
  }
  return tasks;
}

export function inspectGeneratedTests(stdout, manifest, sbtPid) {
  const lines = stdout.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.replace(/^\[info\] ?/, ''));
  const errors = [], require = (ok, message) => { if (!ok) errors.push(message); };
  const matches = pattern => lines.map(line => line.match(pattern)).filter(Boolean);
  const one = (pattern, label) => {
    const found = matches(pattern);
    require(found.length === 1, 'expected exactly one ' + label);
    return found.length === 1 ? found[0] : null;
  };
  const marker = one(/^TRUTHSRC-GENERATED-SUITES=(.*)$/, 'admitted suite marker');
  const names = marker ? marker[1].split(',') : [];
  require(isDeepStrictEqual(names, manifest.suites.map(suite => suite.name).sort()), 'discovered suites differ from admitted manifest');
  require(lines.includes(UNIT_CONFIGURATION), 'unit configuration/no-network validation missing');
  const pid = one(/^UNIT-JVM-PID=([1-9][0-9]*)$/, 'forked unit JVM marker');
  const unitJvmPid = pid ? Number(pid[1]) : null;
  require(Number.isSafeInteger(unitJvmPid) && unitJvmPid !== sbtPid, 'unit runner did not identify a distinct forked JVM');
  const starting = one(/^Run starting\. Expected test count is: ([0-9]+)$/, 'ScalaTest run start');
  require(Number(starting?.[1]) === manifest.testCount, 'expected test count differs');
  const observed = [];
  let active = null;
  for (const line of lines) {
    const heading = line.match(/^([A-Za-z][A-Za-z0-9_.]*):$/);
    if (heading) { active = { name: heading[1], tests: [] }; observed.push(active); }
    else if (line.startsWith('- ') && active) active.tests.push(line.slice(2));
  }
  const expected = manifest.suites.map(suite => ({ name: suite.name.split('.').at(-1), tests: [...suite.tests].sort() }));
  const byName = (a, b) => a.name.localeCompare(b.name);
  require(isDeepStrictEqual(observed.map(suite => ({ ...suite, tests: [...suite.tests].sort() })).sort(byName), expected.sort(byName)),
    'reported suite/test names differ or include failed, skipped, duplicate or unexpected tests');
  const total = one(/^Total number of tests run: ([0-9]+)$/, 'executed test total');
  const suites = one(/^Suites: completed ([0-9]+), aborted ([0-9]+)$/, 'suite completion summary');
  const tests = one(/^Tests: succeeded ([0-9]+), failed ([0-9]+), canceled ([0-9]+), ignored ([0-9]+), pending ([0-9]+)$/, 'test result summary');
  require(Number(total?.[1]) === manifest.testCount, 'executed test count differs');
  require(Number(suites?.[1]) === manifest.suiteCount && Number(suites?.[2]) === 0, 'suite completion/abort counts differ');
  require(Number(tests?.[1]) === manifest.testCount && tests?.slice(2).every(n => n === '0'), 'nonpassing or missing tests');
  require(matches(/^All tests passed\.$/).length === 1, 'successful ScalaTest completion missing or repeated');
  return { requested: true, evidenceState: 'observed', jvmStarted: pid !== null, started: starting !== null, completed: !!(total && suites && tests),
    passed: errors.length === 0, unitJvmPid, sbtPid, discoveredSuites: names,
    testsObserved: observed.reduce((sum, suite) => sum + suite.tests.length, 0),
    totals: total && suites && tests ? { run: Number(total[1]), suitesCompleted: Number(suites[1]), suitesAborted: Number(suites[2]),
      succeeded: Number(tests[1]), failed: Number(tests[2]), canceled: Number(tests[3]), ignored: Number(tests[4]), pending: Number(tests[5]) } : null,
    expected: manifest, observed, errors };
}

export function actualBuildSourceRoot(stdout, output, evidence) {
  const roots = [...stdout.matchAll(/^\[info\] loading project definition from (.+)\/project\r?$/gm)].map(match => match[1]);
  assert.equal(roots.length, 1, 'one actual sbt project definition required');
  const root = roots[0];
  if (root === output) return root;
  const staged = relative(join(evidence, 'global/staging'), root).split('/');
  assert.ok(within(join(evidence, 'global/staging'), root) && staged.length === 2 &&
    /^[0-9a-f]+$/.test(staged[0]) && staged[1] === basename(output), 'sbt loaded an unexpected source root');
  return root;
}

export function compareBuildSources(before, after) {
  try { return compareEvidenceInventories(before, after); }
  catch { throw new Error('actual sbt-loaded input bytes/file set differ from admitted candidate'); }
}

const EXECUTION_CHECKS = ['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
  'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried', 'verifierUnchanged',
  'actualBuildSourcesVerified'];

export function completeGeneratedTests(observation, receipt, checks, cancellation = null, verificationErrors = []) {
  const errors = [...(observation.errors ?? [])];
  let processPassed = false;
  try { succeeded(receipt); processPassed = true; }
  catch (error) { errors.push(error.message); }
  const requiredChecks = [...EXECUTION_CHECKS, ...(observation.expected?.readsideTests ? READSIDE_EXECUTION_CHECKS :
    observation.expected?.businessTests ? ['actorInputsUnchanged', 'actorWorkersVerified', 'actorBoundaryEnforced', 'actualTestSourcesVerified'] : [])];
  const outcome = verificationOutcome({ observationPassed: observation.passed === true, processPassed,
    requiredChecks, checks: Object.fromEntries(requiredChecks.map(name => [name, Object.hasOwn(checks, name) && checks[name] === true])),
    cancelled: !!cancellation, errors: [...errors, ...verificationErrors] });
  const { unverified } = outcome;
  if (unverified.length) errors.push('unverified source/boundary checks: ' + unverified.join(', '));
  if (cancellation) errors.push('cancelled: ' + cancellation);
  errors.push(...verificationErrors);
  return { ...observation, outputPassed: outcome.outputPassed, processPassed, sourceBound: outcome.sourceBound,
    passed: outcome.passed, errors: [...new Set(errors)] };
}

// A macrotask turn is required after synchronous hashing; Promise.resolve alone
// can leave pending SIGINT/SIGTERM callbacks behind the final receipt.
export async function drainPendingSignals() {
  await new Promise(done => setImmediate(done));
  await delay(0);
}

export function isMainModule(argv, moduleUrl) {
  if (!argv) return false;
  try { return pathToFileURL(realpathSync(argv)).href === pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href; }
  catch { return pathToFileURL(resolve(argv)).href === moduleUrl; }
}

export function fileDigest(file) {
  return fingerprintEvidenceFile(file, { allowHardlinks: stat => file === PYTHON && stat.uid === 0 && (stat.mode & 0o022) === 0 }).sha256;
}

async function archiveDigest(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) { notCancelled(); digest.update(bytes); }
  return digest.digest('hex');
}

export function inventory(root, { afterBuild = false } = {}) {
  safePath(root);
  return inventoryEvidence(root, { excludeDirectories: root !== HANDWRITTEN && afterBuild ? ARTIFACT_DIRS : [] });
}

export function snapshotFiles(files) {
  for (const file of files) safePath(file, 'file');
  return snapshotEvidenceFiles(files);
}

async function prepareActors(evidence, generatedManifest) {
  const { parseStrictJson } = await import(pathToFileURL(join(TOOL, 'lib/strict-json.mjs')));
  const { canonicalJson, validateMockConfiguration } = await import('./../simulator/contract.mjs');
  const manifest = actorTestManifest();
  const before = snapshotFiles([...manifest.suites.map(suite => suite.file), ...ACTOR_SUPPORT]);
  for (const suite of manifest.suites) assert.equal(suite.sha256, before[suite.file].sha256, 'actor source changed while capturing manifest');
  const fixtureBytes = readFileSync(ACTOR_FIXTURE), fixture = parseStrictJson(fixtureBytes);
  assert.equal(hash(fixtureBytes), before[ACTOR_FIXTURE].sha256);
  assert.equal(fixture.interpretation, 'historical-frozen-test-fixture');
  validateMockConfiguration(fixture.configuration);
  const node = safePath(realpathSync(process.execPath), 'file');
  before[node] = snapshotFiles([node])[node];
  const ownedRoot = actorOwnedRoot(evidence), parent = dirname(ownedRoot);
  safePath(dirname(parent));
  try { safePath(parent); }
  catch (error) {
    if (readdirSync(dirname(parent)).some(name => fold(name) === fold(basename(parent)))) throw error;
    mkdirSync(parent, { mode: 0o700 });
    safePath(parent);
  }
  safePath(ownedRoot, 'new');
  mkdirSync(ownedRoot, { mode: 0o700 });
  save(join(ownedRoot, 'actor-owner.json'), { evidence, pid: process.pid, source: PROJECT });
  const config = join(ownedRoot, 'actor-ta.json');
  save(config, { schemaVersion: 'bank.truthsrc-actor-ta/v1', ownedRoot,
    fixture: { file: ACTOR_FIXTURE, sha256: hash(fixtureBytes) } });
  before[config] = snapshotFiles([config])[config];
  const actor = { node, worker: ACTOR_WORKER, ownedRoot, config, configSha256: before[config].sha256,
    fixture: ACTOR_FIXTURE, fixtureSha256: hash(fixtureBytes),
    configurationDigest: hash(canonicalJson(fixture.configuration)), before,
    manifest: combineActorManifest(generatedManifest, manifest) };
  save(join(evidence, 'actor-inputs-before.json'), actor);
  return actor;
}

function assertFreshOutput(output) {
  for (const directory of ARTIFACT_DIRS) {
    try { lstatSync(join(output, directory)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('fresh output required; preexisting build artifacts: ' + directory);
  }
}

export function plannedAnchorLocations(entries) {
  const result = new Map();
  for (const entry of entries) {
    const keys = new Set([...(entry.knowledgeIds ?? []), ...(entry.noteIds ?? [])]);
    for (const key of keys) {
      const spans = (entry.codeMappings ?? []).filter(m => m.knowledgeKey === key).map(m => m.span);
      const locations = (spans.length ? spans : [null]).map(span => ({ file: entry.path, span }));
      if (!result.has(key)) result.set(key, []);
      const existing = result.get(key);
      for (const location of locations) if (!existing.some(row => isDeepStrictEqual(row, location))) existing.push(location);
    }
  }
  return result;
}
export const sortedAnchorLocations = locations => locations.map(row => ({ file: row.file, span: row.span ?? null }))
  .sort((a, b) => a.file.localeCompare(b.file) || (a.span?.start ?? -1) - (b.span?.start ?? -1) || (a.span?.end ?? -1) - (b.span?.end ?? -1));

// Only this fixed, local JS implementation is loaded. Never import from the
// candidate, its ledger, an archive member, or a caller-selected generator.
export async function admitCandidate(output, options, { afterBuild = false } = {}) {
  safePath(output);
  assert.ok([join(ROOT, 'generated'), join(ROOT, 'target')].some(root => within(root, output) && output !== root),
    'candidate must be a child of bank generated/ or target/');
  safePath(TOOL);
  safePath(PROJECT, 'file');
  safePath(HANDWRITTEN);
  const preparedRuntime = options.runtimeSupply ? capturePreparedRuntime(options.runtimeSupply) : null;
  const runtimeRoot = preparedRuntime?.root ?? RUNTIME;
  safePath(runtimeRoot);
  const { captureProject, projectPlan, assertUnchanged } = await import(pathToFileURL(join(TOOL, 'lib/project/cli.mjs')));
  const { parseStrictJson } = await import(pathToFileURL(join(TOOL, 'lib/strict-json.mjs')));
  const { readAnchorsIndex } = await import(pathToFileURL(join(TOOL, 'src/core/anchors.mjs')));
  const { generatedFingerprint } = await import(pathToFileURL(join(TOOL, 'src/core/apply-preflight.mjs')));
  const captured = captureProject(PROJECT, { roundtripCheck: false }); // No temp-tree writes or regeneration.
  assert.equal(captured.config.generator, GENERATOR);
  assert.equal(captured.config.tree, 'truth/bank-wealth');
  assert.equal(captured.config.context, 'bankwealth');
  assert.equal(captured.config.canonicalId, 'bank-v1');
  assert.equal(captured.config.options.service.artifact, 'bank-service');
  assert.deepEqual(captured.config.options.service.externalSourceRoots, [HANDWRITTEN]);
  assert.equal(captured.config.options.runtimeArtifact.repository, pathToFileURL(join(runtimeRoot, 'maven')).href + '/');
  assert.ok(!overlap(output, HANDWRITTEN) && !overlap(output, TOOL) && !overlap(output, runtimeRoot));
  const inputs = parseStrictJson(readFileSync(join(output, '.truthsrc/inputs.json')));
  let graphAst;
  if (inputs.graph) {
    const { SqliteKnowledgeGraphStore } = await import(pathToFileURL(join(TOOL, 'lib/knowledge-sqlite.mjs')));
    const { exportKnowledgeAst } = await import(pathToFileURL(join(TOOL, 'lib/knowledge-graph.mjs')));
    const { projectGraphFile } = await import(pathToFileURL(join(TOOL, 'lib/project/graph.mjs')));
    const store = new SqliteKnowledgeGraphStore(projectGraphFile(PROJECT), { readonly: true });
    try { graphAst = exportKnowledgeAst(store, { project: PROJECT, snapshot: inputs.graph.snapshot, expectedSources: captured.sources }); }
    finally { store.close(); }
  }
  const plan = projectPlan(captured, output, graphAst); // Read-only graph export; no application writes.
  assert.equal(plan.generator.id, GENERATOR);
  assert.equal(plan.generator.version, '1');
  const before = inventory(output, { afterBuild });
  const ledger = parseStrictJson(readFileSync(join(output, 'truthsrc.ledger.json')));
  const anchors = readAnchorsIndex(parseStrictJson(readFileSync(join(output, 'anchors.json'))));
  assert.equal(ledger.generator, GENERATOR);
  assert.ok(Array.isArray(ledger.entries));
  const rows = new Map(ledger.entries.map(row => [row.path, row]));
  assert.equal(rows.size, ledger.entries.length, 'duplicate ownership ledger paths');
  assert.equal(rows.size, plan.entries.length, 'retained/missing/foreign ledger entries forbidden');
  assert.deepEqual(Object.keys(before).sort(), [...plan.entries.map(entry => entry.path), 'truthsrc.ledger.json', 'anchors.json'].sort(),
    'candidate contains missing or unplanned files (including build scripts and old tests)');
  const plannedInputs = JSON.parse(plan.entries.find(entry => entry.path === '.truthsrc/inputs.json').content);
  for (const key of ['sources', 'sourceIndex', 'generatedFiles', 'canonicalId', ...(inputs.graph ? ['graph'] : [])])
    assert.deepEqual(inputs[key], plannedInputs[key], 'current generation input differs: ' + key);
  assert.equal(inputs.validation?.hard?.length, 0, 'generation validation evidence required');
  assert.equal(inputs.validation?.roundtrip?.ok, true, 'successful generation roundtrip evidence required');
  const associations = entry => [...new Set([...(entry.knowledgeIds ?? []), ...(entry.noteIds ?? [])])].sort();
  const expectedAnchors = plannedAnchorLocations(plan.entries);
  for (const entry of plan.entries) {
    assert.ok(!entry.noLedger && !entry.merge, 'unsupported shared/merged generation entry');
    const row = rows.get(entry.path), bytes = readFileSync(join(output, entry.path));
    assert.equal(row?.ownership?.id, PROJECT, 'not owned by current bank project: ' + entry.path);
    assert.equal(row.ownership.generator, GENERATOR);
    assert.equal(row.kind, entry.kind);
    assert.equal(row.ownership.fingerprint, 'sha256:' + hash(bytes), 'stale source fingerprint: ' + entry.path);
    assert.equal(row.ownership.generatedFingerprint, generatedFingerprint(bytes, entry.path));
    // inputs.validation contains the original roundtrip result, which this
    // read-only build admission deliberately does not rerun. Everything else
    // (including MANUAL bodies) must equal today's registered producer output.
    if (entry.path !== '.truthsrc/inputs.json')
      assert.ok(bytes.equals(Buffer.from(entry.content)), 'not current JS generated bytes: ' + entry.path);
    assert.deepEqual(associations(row), associations(entry));
  }
  assert.deepEqual(Object.keys(anchors.anchors).sort(), [...expectedAnchors.keys()].sort(), 'anchor membership differs');
  for (const [key, expectedLocations] of expectedAnchors) {
    const locations = anchors.anchors[key];
    assert.deepEqual(sortedAnchorLocations(locations), sortedAnchorLocations(expectedLocations), 'anchor file/span associations differ');
    for (const loc of locations) {
      assert.equal(loc.repo, output, 'copied/foreign anchor repository');
      assert.equal(loc.generator, GENERATOR);
      assert.equal(loc.generatorVersion, plan.generator.version);
      assert.equal(loc.status, 'source-verified');
      assert.equal(loc.verification.fileVerified, true);
      assert.equal(loc.fingerprint, rows.get(loc.file).ownership.fingerprint);
      assert.equal(loc.symbol, null, 'symbol parser evidence is not part of this generated profile');
      if (loc.span) {
        assert.equal(loc.verification.spanVerified, true);
        const bytes = readFileSync(join(output, loc.file));
        assert.ok(bytes.subarray(loc.span.start, loc.span.end).equals(Buffer.from(loc.span.text)), 'anchor span does not match final source bytes');
      }
    }
  }
  const build = readFileSync(join(output, 'build.sbt'), 'utf8');
  assert.ok(build.includes('scalaVersion := "2.13.14"'));
  assert.equal(readFileSync(join(output, 'project/build.properties'), 'utf8'), 'sbt.version=1.4.9\n');
  assert.ok(build.includes('Compile / unmanagedSourceDirectories := Seq(baseDirectory.value / "app") ++ Seq(file(' + JSON.stringify(HANDWRITTEN) + '))'),
    'generated build must already mount app plus original handwritten tree');
  const testFiles = plan.entries.filter(e => e.path.startsWith('src/test/scala/') && e.path.endsWith('.scala')).map(e => e.path).sort();
  for (const file of ['src/test/scala/UnitConfigurationCheck.scala', 'src/test/scala/GeneratedUnitStorageSpec.scala'])
    assert.ok(testFiles.includes(file), 'current service unit support missing');
  assert.ok(build.includes('.service.UnitTestMain'), 'unexpected generated test runner');
  const testManifest = generatedTestManifest(plan.entries, options);
  const handwritten = inventory(HANDWRITTEN), runtime = inventory(runtimeRoot);
  assert.ok(Object.keys(handwritten).some(file => file.endsWith('.scala')), 'empty handwritten Scala tree');
  assertUnchanged(captured);
  return { before, handwritten, runtime, runtimeRoot, preparedRuntime, captured, assertUnchanged, testFiles, testManifest, generator: plan.generator };
}

// tarfile is used ONLY as a reader, never extract()/extractall(). Validate the
// entire archive namespace before writing any of the three selected supplies.
const extractSource = String.raw`import hashlib, json, os, pathlib, stat, sys, tarfile, unicodedata
archive, destination, expected = sys.argv[1:]
def require(ok, message):
    if not ok: raise ValueError(message)
def digest(stream):
    stream.seek(0)
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    stream.seek(0)
    return h.hexdigest()
def identity(s): return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
require(not os.path.lexists(destination), 'supply destination must be new')
with open(archive, 'rb') as raw:
    original = os.fstat(raw.fileno())
    require(stat.S_ISREG(original.st_mode), 'regular archive required')
    require(digest(raw) == expected, 'archive SHA256 differs before extraction')
    with tarfile.open(fileobj=raw, mode='r:gz') as tar:
        members = tar.getmembers()
        require(len(members) <= 100000, 'too many archive members')
        seen, aliases, kinds, selected = set(), {}, {}, []
        counts = {'maven': 0, 'ivy': 0, 'launcher': 0}
        for member in members:
            require(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE), 'unsupported archive member type')
            require(not member.linkname and not member.sparse, 'archive links/sparse members forbidden')
            require(set(member.pax_headers).issubset({'path', 'size', 'mtime', 'atime', 'ctime'}), 'unknown pax metadata')
            require(member.pax_headers.get('path', member.name) == member.name, 'pax path differs')
            name = member.name
            if member.isdir() and name.endswith('/'): name = name[:-1]
            require(name and not name.startswith('/') and chr(92) not in name and ':' not in name, 'unsafe archive name')
            require(all(ord(c) >= 32 and ord(c) != 127 for c in name), 'control character in archive name')
            parts = name.split('/')
            require(parts[0] == 'bank-wealth-v1' and all(p not in ('', '.', '..') for p in parts), 'archive namespace escape')
            require(name not in seen, 'duplicate archive member')
            seen.add(name)
            for i in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:i])
                alias = unicodedata.normalize('NFC', prefix).casefold()
                require(alias not in aliases or aliases[alias] == prefix, 'archive case/unicode alias')
                aliases[alias] = prefix
                kind = 'directory' if i < len(parts) or member.isdir() else 'file'
                require(prefix not in kinds or kinds[prefix] == kind, 'archive file/directory collision')
                kinds[prefix] = kind
            require(member.size >= 0, 'negative member size')
            if len(parts) >= 4 and parts[1] == 'supply' and parts[2] in counts and member.isfile():
                require(member.size <= 256 * 1024 * 1024, 'oversized supply member')
                selected.append((member, '/'.join(parts[2:])))
                counts[parts[2]] += 1
        require(counts == {'maven': 1048, 'ivy': 16, 'launcher': 1}, 'pinned supply counts differ')
        require(sum(m.size for m, _ in selected) <= 1024 * 1024 * 1024, 'oversized supply')
        require([p for _, p in selected if p.startswith('launcher/')] == ['launcher/sbt-launch.jar'], 'unexpected launcher')
        os.mkdir(destination, 0o700)
        files = {}
        for member, name in selected:
            target = pathlib.Path(destination).joinpath(*name.split('/'))
            target.parent.mkdir(parents=True, exist_ok=True)
            h, size = hashlib.sha256(), 0
            with tar.extractfile(member) as source, open(target, 'xb') as out:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    out.write(chunk); h.update(chunk); size += len(chunk)
            require(size == member.size, 'short supply member')
            # Normalize modes, never restore uid/gid, timestamps or archive flags.
            os.chmod(target, 0o755 if name.endswith('.exe') else 0o644)
            files[name] = {'bytes': size, 'sha256': h.hexdigest()}
    require(identity(os.fstat(raw.fileno())) == identity(original), 'archive changed during extraction')
    require(digest(raw) == expected, 'archive SHA256 changed after extraction')
    require(identity(os.stat(archive, follow_symlinks=False)) == identity(original), 'archive path replaced')
print(json.dumps({'archiveSha256': expected, 'membersValidated': len(members), 'counts': counts, 'files': files}, sort_keys=True))
`;

// Current acceptance composes a fresh repository; the original archive is never changed.
const extractCurrentSource = String.raw`import hashlib, json, os, pathlib, stat, sys, tarfile, unicodedata
archive, destination, expected, selection_file, selection_sha = sys.argv[1:]
def require(ok, message):
    if not ok: raise ValueError(message)
def identity(s): return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
def digest(stream):
    stream.seek(0)
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    stream.seek(0)
    return h.hexdigest()
def plain_file(path):
    require(os.path.realpath(path) == path, 'input alias or symlink')
    s = os.stat(path, follow_symlinks=False)
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'single-linked regular input required')
    return s
selection_stat = plain_file(selection_file)
with open(selection_file, 'rb') as stream: selection_bytes = stream.read()
require(hashlib.sha256(selection_bytes).hexdigest() == selection_sha, 'selection digest differs')
selection = json.loads(selection_bytes)
require(set(selection) == {'schemaVersion', 'preparedRuntime', 'excludedPaths'}, 'unknown selection field')
require(selection['schemaVersion'] == 'bank.supply-selection/v1', 'unknown selection')
prepared = selection['preparedRuntime']
require(prepared['schemaVersion'] == 'bank.prepared-runtime/v3' and prepared['version'] == '0.3.0', 'current runtime required')
excluded = set(selection['excludedPaths'])
require(len(excluded) == len(selection['excludedPaths']) == 36, 'exact engine exclusion set required')
require(not os.path.lexists(destination), 'supply destination must be new')
archive_files, excluded_files, files, overlays = {}, {}, {}, {}
with open(archive, 'rb') as raw:
    original = os.fstat(raw.fileno())
    require(stat.S_ISREG(original.st_mode), 'regular archive required')
    require(digest(raw) == expected, 'archive digest differs before extraction')
    with tarfile.open(fileobj=raw, mode='r:gz') as tar:
        members = tar.getmembers()
        require(len(members) <= 100000, 'too many archive members')
        seen, aliases, kinds, selected = set(), {}, {}, []
        counts = {'maven': 0, 'ivy': 0, 'launcher': 0}
        for member in members:
            require(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE), 'unsupported member type')
            require(not member.linkname and not member.sparse, 'archive links/sparse members forbidden')
            require(set(member.pax_headers).issubset({'path', 'size', 'mtime', 'atime', 'ctime'}), 'unknown pax metadata')
            require(member.pax_headers.get('path', member.name) == member.name, 'pax path differs')
            name = member.name[:-1] if member.isdir() and member.name.endswith('/') else member.name
            require(name and not name.startswith('/') and chr(92) not in name and ':' not in name, 'unsafe archive name')
            require(all(ord(c) >= 32 and ord(c) != 127 for c in name), 'control character in archive name')
            parts = name.split('/')
            require(parts[0] == 'bank-wealth-v1' and all(p not in ('', '.', '..') for p in parts), 'archive namespace escape')
            require(name not in seen, 'duplicate archive member')
            seen.add(name)
            for i in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:i]); alias = unicodedata.normalize('NFC', prefix).casefold()
                require(alias not in aliases or aliases[alias] == prefix, 'archive case/unicode alias')
                aliases[alias] = prefix
                kind = 'directory' if i < len(parts) or member.isdir() else 'file'
                require(prefix not in kinds or kinds[prefix] == kind, 'archive file/directory collision')
                kinds[prefix] = kind
            require(member.size >= 0, 'negative member size')
            if len(parts) >= 4 and parts[1] == 'supply' and parts[2] in counts and member.isfile():
                require(member.size <= 256 * 1024 * 1024, 'oversized supply member')
                selected.append((member, '/'.join(parts[2:]))); counts[parts[2]] += 1
        require(counts == {'maven': 1048, 'ivy': 16, 'launcher': 1}, 'pinned archive inventory differs')
        require(sum(m.size for m, _ in selected) <= 1024 * 1024 * 1024, 'oversized supply')
        require([p for _, p in selected if p.startswith('launcher/')] == ['launcher/sbt-launch.jar'], 'unexpected launcher')
        require(excluded.issubset({name for _, name in selected}), 'missing archived engine member')
        os.mkdir(destination, 0o700)
        for member, name in selected:
            h, size = hashlib.sha256(), 0
            target = pathlib.Path(destination).joinpath(*name.split('/'))
            out = None
            try:
                if name not in excluded:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    out = open(target, 'xb')
                with tar.extractfile(member) as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        if out is not None: out.write(chunk)
                        h.update(chunk); size += len(chunk)
            finally:
                if out is not None: out.close()
            require(size == member.size, 'short archive supply member')
            stamp = {'bytes': size, 'sha256': h.hexdigest()}; archive_files[name] = stamp
            if name in excluded: excluded_files[name] = stamp
            else:
                os.chmod(target, 0o755 if name.endswith('.exe') else 0o644)
                files[name] = stamp
    require(identity(os.fstat(raw.fileno())) == identity(original), 'archive identity changed')
    require(digest(raw) == expected, 'archive digest changed after extraction')
    require(identity(os.stat(archive, follow_symlinks=False)) == identity(original), 'archive path replaced')
require(len(prepared['files']) == 6, 'six released members required')
for row in prepared['files']:
    name = row['path']; parts = name.split('/')
    require(parts[0] == 'maven' and all(p not in ('', '.', '..') for p in parts) and chr(92) not in name, 'invalid runtime path')
    require(name not in files and name not in overlays and name not in archive_files, 'runtime supply collision')
    source_path = str(pathlib.Path(prepared['root']).joinpath(*parts))
    before = plain_file(source_path)
    target = pathlib.Path(destination).joinpath(*parts); target.parent.mkdir(parents=True, exist_ok=True)
    h, size = hashlib.sha256(), 0
    with open(source_path, 'rb') as source, open(target, 'xb') as out:
        require(identity(os.fstat(source.fileno())) == identity(before), 'runtime file replaced before read')
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            out.write(chunk); h.update(chunk); size += len(chunk)
        require(identity(os.fstat(source.fileno())) == identity(before), 'runtime file changed during read')
    require(identity(plain_file(source_path)) == identity(before), 'runtime path changed')
    require(size == row['bytes'] and h.hexdigest() == row['sha256'], 'runtime bytes differ from independent pin')
    os.chmod(target, 0o644)
    overlays[name] = files[name] = {'bytes': size, 'sha256': h.hexdigest()}
require(identity(plain_file(selection_file)) == identity(selection_stat), 'selection changed')
with open(selection_file, 'rb') as stream: require(hashlib.sha256(stream.read()).hexdigest() == selection_sha, 'selection bytes changed')
effective_counts = {key: sum(name.startswith(key + '/') for name in files) for key in counts}
require(effective_counts == {'maven': 1018, 'ivy': 16, 'launcher': 1}, 'composed inventory differs')
print(json.dumps({'schemaVersion': 'bank.composed-supply/v3', 'archiveSha256': expected, 'membersValidated': len(members), 'archiveCounts': counts, 'counts': effective_counts, 'archiveFiles': archive_files, 'excludedFiles': excluded_files, 'overlays': overlays, 'preparedRuntime': prepared, 'files': files}, sort_keys=True))
`;

// These probes make real syscalls, never permission-method-only assertions.
// A refusal/timeout/unsupported address is NOT proof: require EPERM/EACCES.
// All destructive targets are newly created verifier-owned canaries, NOT inputs.
const sandboxPythonSource = String.raw`import errno, os, pathlib, socket, subprocess, sys
role, evidence, canaries, escape = sys.argv[1:]
assert role in ('native-child', 'native-grandchild')
def denied(label, action):
    try: action()
    except OSError as error:
        if error.errno not in (errno.EPERM, errno.EACCES): raise
        print('DENIED ' + role + ' ' + label + ' errno=' + str(error.errno), flush=True)
        return
    raise RuntimeError('UNSAFE sandbox allowed ' + role + ' ' + label)
def network(family, address, operation):
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        if operation == 'connect': sock.connect((address, 1))
        else:
            # Stop immediately if bind succeeds: never start an actual listener.
            sock.bind((address, 0))
def append(file):
    with open(file, 'ab', buffering=0) as stream: stream.write(b'UNSAFE-WRITE')
for family, address, name in ((socket.AF_INET, '127.0.0.1', 'ipv4'), (socket.AF_INET6, '::1', 'ipv6')):
    for operation in ('connect', 'listen-bind'):
        denied(name + '-' + operation, lambda: network(family, address, operation))
denied('outside-write', lambda: append(os.path.join(canaries, 'write-canary')))
denied('outside-delete', lambda: os.unlink(os.path.join(canaries, 'delete-canary')))
denied('outside-create', lambda: pathlib.Path(canaries, 'must-not-exist').touch(exist_ok=False))
denied('symlink-write-escape', lambda: append(os.path.join(escape, 'write-canary')))
denied('symlink-delete-escape', lambda: os.unlink(os.path.join(escape, 'delete-canary')))
with open(os.path.join(evidence, 'boundary', role + '-allowed'), 'xb') as stream:
    stream.write(b'evidence-write-allowed\n')
print('ALLOWED ' + role + ' evidence-write', flush=True)
if role == 'native-child':
    # No sandbox wrapper here: this exec must inherit the parent's kernel policy.
    subprocess.run([sys.executable, '-I', '-S', __file__, 'native-grandchild', evidence, canaries, escape],
                   check=True, timeout=10, stdin=subprocess.DEVNULL, close_fds=True)
print('TRUTHSRC-OS-SANDBOX-PROBE-OK role=' + role, flush=True)
`;

const sandboxJavaSource = String.raw`import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.file.Files;
import java.nio.file.FileSystemException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.security.Permission;
import java.util.Locale;

public final class TruthsrcSandboxProbe {
  interface Action { void run() throws Exception; }
  private static void denied(String label, Action action) throws Exception {
    try { action.run(); }
    catch (SocketException | FileSystemException error) {
      String reason = error instanceof FileSystemException ? ((FileSystemException) error).getReason() : error.getMessage();
      String message = reason == null ? "" : reason.toLowerCase(Locale.ROOT);
      if (!message.contains("operation not permitted") && !message.contains("permission denied")) throw error;
      System.out.println("DENIED java-null-manager " + label + " " + reason);
      return;
    }
    throw new IllegalStateException("UNSAFE sandbox allowed java-null-manager " + label);
  }
  public static void main(String[] args) throws Exception {
    if (!"11".equals(System.getProperty("java.specification.version"))) throw new IllegalStateException("JDK11 required");
    // Deliberately permit every Java permission, then remove the manager entirely.
    // sbt's TrapExit (including its no-op checkWrite/checkDelete) cannot remove Seatbelt.
    System.setSecurityManager(new SecurityManager() {
      public void checkPermission(Permission permission) {}
      public void checkPermission(Permission permission, Object context) {}
    });
    System.setSecurityManager(null);
    if (System.getSecurityManager() != null) throw new IllegalStateException("manager removal failed");
    System.out.println("SECURITY-MANAGER installed-permissive-then-null");
    Path evidence = Paths.get(args[0]), canaries = Paths.get(args[1]), escape = Paths.get(args[2]);
    InetAddress loopback = InetAddress.getByAddress(new byte[] {127, 0, 0, 1});
    denied("ipv4-connect", () -> {
      try (Socket socket = new Socket()) { socket.connect(new InetSocketAddress(loopback, 1), 500); }
    });
    denied("ipv4-listen-bind", () -> {
      try (ServerSocket socket = new ServerSocket()) { socket.bind(new InetSocketAddress(loopback, 0)); }
    });
    byte[] unsafe = new byte[] {1};
    denied("outside-write", () -> Files.write(canaries.resolve("write-canary"), unsafe, StandardOpenOption.APPEND));
    denied("outside-delete", () -> Files.delete(canaries.resolve("delete-canary")));
    denied("symlink-write-escape", () -> Files.write(escape.resolve("write-canary"), unsafe, StandardOpenOption.APPEND));
    Files.write(evidence.resolve("boundary/java-allowed"), new byte[] {1}, StandardOpenOption.CREATE_NEW);
    System.out.println("ALLOWED java-null-manager evidence-write");
    Process child = new ProcessBuilder(args[3], "-I", "-S", args[4], "native-child", args[0], args[1], args[2]).inheritIO().start();
    if (child.waitFor() != 0) throw new IllegalStateException("inherited native sandbox probe failed");
    System.out.println("TRUTHSRC-OS-SANDBOX-PROBE-OK role=java-null-manager");
  }
}
`;

function prepareSandbox(evidence, output, actor = null, runReadside = false) {
  // Existing ancestors are checked for symlinks/aliases by safePath; subpaths use
  // canonical kernel paths, never a lexical allowlist in a replaceable JVM guard.
  for (const root of [evidence, output]) assert.equal(realpathSync(safePath(root)), root);
  safePath(SANDBOX, 'file');
  const subpaths = [evidence, ...ARTIFACT_DIRS.map(dir => join(output, dir)), ...(actor ? [actor.ownedRoot] : [])];
  assert.equal(realpathSync('/dev/null'), '/dev/null');
  assert.ok(lstatSync('/dev/null').isCharacterDevice(), 'expected /dev/null device');
  // Python subprocess DEVNULL opens O_RDWR (observed EPERM without this literal).
  // Never allow /dev as a subtree, nor any other external filesystem location.
  const literals = [join(output, 'project/project'), '/dev/null'];
  const profile = join(evidence, 'sandbox.sb');
  const text = '(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write*\n' +
    subpaths.map(path => '  (subpath ' + JSON.stringify(path) + ')').join('\n') + '\n' +
    literals.map(path => '  (literal ' + JSON.stringify(path) + ')').join('\n') + ')\n' +
    (actor ? '(deny file-read*\n' + ACTOR_READ_DENIALS.map(path => '  (subpath ' + JSON.stringify(path) + ')').join('\n') + ')\n' +
      '(deny file-write* (literal ' + JSON.stringify(actor.config) + '))\n' : '');
  write(profile, text);
  const boundary = join(evidence, 'boundary');
  mkdirSync(boundary, { mode: 0o700 });
  const canaries = mkdtempSync(join(dirname(evidence), 'truthsrc-build-canaries-'));
  safePath(canaries);
  assert.ok(!subpaths.some(path => overlap(path, canaries)) && !overlap(output, canaries), 'canaries must be outside sandbox write roots');
  for (const name of ['write-canary', 'delete-canary']) write(join(canaries, name), 'immutable owned boundary canary: ' + name + '\n');
  const canariesBefore = inventory(canaries);
  const escape = join(boundary, 'escape');
  symlinkSync(canaries, escape); // only this recorded diagnostic link; no input links admitted
  write(join(boundary, 'probe.py'), sandboxPythonSource);
  write(join(boundary, 'TruthsrcSandboxProbe.java'), sandboxJavaSource);
  const controlFiles = [profile, join(boundary, 'probe.py'), join(boundary, 'TruthsrcSandboxProbe.java'),
    ...(actor ? [actor.config] : []), ...(runReadside ? [READSIDE_MANIFEST_FILE] : [])];
  const controlsBefore = Object.fromEntries(controlFiles.map(file => [file, fileDigest(file)]));
  const sandbox = { executable: SANDBOX, profile, profileSha256: hash(text), subpaths, literals,
    network: 'deny network* (unconditional)', defaultFileWrites: 'deny file-write*', deviceWriteExceptions: ['/dev/null'],
    canaries, canariesBefore, escape, controlsBefore, historicalReadDenials: actor ? ACTOR_READ_DENIALS : [] };
  save(join(evidence, 'sandbox-before.json'), sandbox);
  return sandbox;
}

function checkSandbox(sandbox) {
  const after = inventory(sandbox.canaries);
  assert.deepEqual(after, sandbox.canariesBefore, 'owned outside canaries changed');
  assert.ok(lstatSync(sandbox.escape).isSymbolicLink());
  assert.equal(readlinkSync(sandbox.escape), sandbox.canaries, 'diagnostic escape link changed');
  assert.equal(realpathSync(sandbox.escape), sandbox.canaries);
  for (const [file, digest] of Object.entries(sandbox.controlsBefore)) {
    safePath(file, 'file');
    assert.equal(fileDigest(file), digest, 'sandbox control file changed: ' + file);
  }
  return { canariesUnchanged: true, controlsUnchanged: true, canaries: after };
}

async function probeSandbox(sandbox, java, javac, output, evidence, env, phases) {
  const boundary = join(evidence, 'boundary');
  phases.javac = await command(javac, ['-J-XX:-UsePerfData', '-J-Duser.home=' + env.HOME, '-J-Djava.io.tmpdir=' + env.TMPDIR,
    '-proc:none', '-classpath', boundary, '-d', boundary, join(boundary, 'TruthsrcSandboxProbe.java')],
    evidence, env, join(evidence, 'javac'), 45_000, sandbox);
  succeeded(phases.javac);
  phases.sandboxProbe = await command(java, ['-XX:-UsePerfData', '-Duser.home=' + env.HOME, '-Djava.io.tmpdir=' + env.TMPDIR,
    '-cp', boundary, 'TruthsrcSandboxProbe', evidence, sandbox.canaries, sandbox.escape, PYTHON, join(boundary, 'probe.py')],
    output, env, join(evidence, 'sandbox-check'), 30_000, sandbox);
  succeeded(phases.sandboxProbe);
  const stdout = readFileSync(join(evidence, 'sandbox-check.stdout.log'), 'utf8');
  assert.ok(stdout.includes('SECURITY-MANAGER installed-permissive-then-null'));
  for (const role of ['java-null-manager', 'native-child', 'native-grandchild'])
    assert.ok(stdout.includes('TRUTHSRC-OS-SANDBOX-PROBE-OK role=' + role), 'missing inherited sandbox proof: ' + role);
  save(join(evidence, 'sandbox-probe.json'), { status: 'passed', ...checkSandbox(sandbox),
    actualSyscalls: true, successfulConnections: 0, successfulListenerBinds: 0,
    javaManagerRemoved: true, nativeChildInherited: true, nativeGrandchildInherited: true });
}

function repositoryText(supply) {
  const maven = pathToFileURL(join(supply, 'maven')).href + '/';
  const ivy = pathToFileURL(join(supply, 'ivy')).href + '/';
  const pattern = '[organization]/[module]/(scala_[scalaVersion]/)(sbt_[sbtVersion]/)[revision]/[type]s/[artifact](-[classifier]).[ext]';
  return { maven, ivy, pattern, text: '[repositories]\nowned-maven: ' + maven + '\nowned-ivy: ' + ivy + ', ' + pattern + '\n' };
}
function bootText(repositories) {
  return '[scala]\n  version: 2.12.12\n\n[app]\n  org: org.scala-sbt\n  name: sbt\n  version: 1.4.9\n  class: sbt.xMain\n  components: xsbti,extra\n  cross-versioned: false\n\n' + repositories +
    '\n[boot]\n  directory: ${sbt.boot.directory}\n  lock: true\n\n[ivy]\n  ivy-home: ${sbt.ivy.home}\n  checksums: sha1,md5\n  override-build-repos: true\n  repository-config: ${sbt.repository.config}\n';
}

const delay = ms => new Promise(done => setTimeout(done, ms));
function groupAlive(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true; // A denied probe is not proof that the group has exited.
    throw error;
  }
}
function signalGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function command(executable, args, cwd, env, base, timeoutMs, sandbox) {
  notCancelled();
  // Mandatory wrapper: extraction, javac, probes, sbt and every exec descendant
  // have the same OS boundary. No unsandboxed or Java-only fallback exists.
  assert.equal(sandbox?.executable, SANDBOX, 'OS sandbox required');
  safePath(sandbox.profile, 'file');
  assert.equal(fileDigest(sandbox.profile), sandbox.profileSha256, 'sandbox profile changed before launch');
  const invocation = [SANDBOX, '-f', sandbox.profile, executable, ...args];
  const descriptors = [], terminationErrors = [];
  const terminate = (pid, signal) => {
    try { signalGroup(pid, signal); }
    catch (error) { terminationErrors.push({ pid, signal, error: error.code ?? error.message }); }
  };
  let timer, killer, child, launchError = null, timedOut = false, termAt = null;
  const started = Date.now();
  try {
    for (const suffix of ['.stdout.log', '.stderr.log', '.json']) descriptors.push(openSync(base + suffix, 'wx', 0o600));
    const stop = () => {
      if (termAt !== null) return;
      termAt = Date.now();
      terminate(child?.pid, 'SIGTERM');
      killer = setTimeout(() => terminate(child?.pid, 'SIGKILL'), GRACE_MS);
    };
    stopChild = stop;
    let code = null, signal = null, closed = false;
    try {
      child = spawn(invocation[0], invocation.slice(1), { cwd, env, detached: true, stdio: ['ignore', descriptors[0], descriptors[1]] });
      const end = new Promise(done => {
        child.once('error', error => { launchError = error.code ?? error.message; });
        child.once('close', (c, s) => { code = c; signal = s; closed = true; done(); });
      });
      timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
      if (cancelled) stop();
      // Do not race a timeout promise against the child and return it alive.
      await end;
    } catch (error) { launchError = error.code ?? error.message; }
    clearTimeout(timer);
    const leftoverGroup = groupAlive(child?.pid);
    if (leftoverGroup) {
      stop();
      while (groupAlive(child.pid) && Date.now() < termAt + GRACE_MS) await delay(100);
      terminate(child.pid, 'SIGKILL');
      const until = Date.now() + REAP_POLL_MS;
      while (groupAlive(child.pid) && Date.now() < until) await delay(100);
    }
    clearTimeout(killer);
    const receipt = { command: invocation, sandboxProfileSha256: sandbox.profileSha256, cwd, pid: child?.pid ?? null,
      startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, timeoutMs, graceMs: GRACE_MS,
      code, signal, launchError, timedOut, cancelled, terminationErrors, directChildClosed: closed,
      directChildReaped: closed && !launchError, leftoverGroup, groupAliveAfter: groupAlive(child?.pid),
      stdoutSha256: fileDigest(base + '.stdout.log'), stderrSha256: fileDigest(base + '.stderr.log') };
    writeFileSync(descriptors[2], json(receipt));
    return receipt;
  } finally {
    stopChild = null;
    clearTimeout(timer); clearTimeout(killer);
    for (const fd of descriptors) closeSync(fd);
  }
}
export function succeeded(receipt) {
  assert.ok(receipt.code === 0 && !receipt.signal && !receipt.launchError && !receipt.timedOut && !receipt.cancelled &&
    receipt.directChildReaped && !receipt.leftoverGroup && !receipt.groupAliveAfter && !receipt.terminationErrors?.length,
    'command failed; inspect its exclusive receipt and logs');
}

async function verify(options) {
  const { output, archive, runtimeSupply, evidence, javaHome, compileTests, runTests, runActors, runReadside, compileRuntimeTests } = options;
  assert.ok(runtimeSupply, 'explicit --runtime-supply is required for current 0.3.0 acceptance');
  const preparedRuntime = capturePreparedRuntime(runtimeSupply);
  assert.equal(process.platform, 'darwin', 'this captured toolchain is for Darwin, not a portable supply');
  safePath(output); safePath(archive, 'file'); safePath(evidence, 'new'); safePath(javaHome);
  assert.ok([join(ROOT, 'generated'), join(ROOT, 'target')].some(root => within(root, output) && output !== join(ROOT, 'target')),
    'generated output must be inside this bank generated/ or target/');
  assert.ok(within(join(ROOT, 'target'), evidence) && evidence !== join(ROOT, 'target'), 'new evidence must be under bank target/');
  assert.ok(!overlap(output, evidence) && !overlap(archive, evidence) && !overlap(output, archive) &&
    !overlap(runtimeSupply, evidence) && !overlap(runtimeSupply, output) && !overlap(runtimeSupply, archive), 'input/evidence paths overlap');
  assertFreshOutput(output);
  const java = safePath(join(javaHome, 'bin/java'), 'file'), javac = safePath(join(javaHome, 'bin/javac'), 'file');
  safePath(PYTHON, 'file'); safePath(SANDBOX, 'file'); safePath(join(javaHome, 'release'), 'file');
  const release = readFileSync(join(javaHome, 'release'), 'utf8');
  assert.match(release, /^JAVA_VERSION="11(?:\.|\")/m, 'explicit JDK11 required');
  assert.match(release, /^OS_ARCH="(?:x86_64|amd64)"/m, 'clean archive contains Darwin x86_64 protoc; x64 JDK/Rosetta required');
  mkdirSync(evidence, { mode: 0o700 }); // exclusive: no recursive parent creation or reuse
  const result = { schemaVersion: 'bank.truthsrc-build/v2', status: 'blocked', output, evidence, preparedRuntime,
    archive: { file: archive, expectedSha256: ARCHIVE_SHA }, javaHome, compileGeneratedTests: compileTests,
    runGeneratedTests: runTests && !runActors && !runReadside, runActorTests: runActors, runReadsideTests: runReadside, compileRuntimeTests, testsExecuted: false,
    runtimeCompilation: { requested: !!compileRuntimeTests, passed: false },
    actorTests: { requested: runActors, passed: false },
    readsideTests: { requested: runReadside, evidenceState: 'not-dispatched', jvmStarted: false, started: false, completed: false, passed: false },
    generatedTests: { requested: runTests && !runActors && !runReadside, evidenceState: 'not-dispatched', jvmStarted: false, started: false, completed: false, passed: false },
    servicesStarted: false, runtimeRebuilt: false, runtimePublished: false,
    release1134Resigned: false, runtimeRetryBackoffDeadline: 'OPEN', phases: {}, checks: {}, errors: [],
    scope: compileRuntimeTests ? 'current JS bank service with five fixed runtime mains compiled; source-bound classpath only, no service/test execution' :
      runActors ? 'current JS bank service: fixed four-flow actor regression plus generated units; testkit and explicitly frozen TA fixture only; not HTTP, databases, multi-JVM recovery or 1134 acceptance' :
      runReadside ? 'current JS bank service: ' + READSIDE_SCOPE :
      'current JS-generated bank service plus original handwritten Scala; optional generated-only unit compilation/execution; not four-flow, HTTP, database, multi-JVM recovery or 1134 acceptance' };
  let admitted, supplyBefore, sandbox, cachesBefore, verifierBefore, actor, executionManifest, runtimeManifest, runtimeBefore, runtimeObservation;
  let readsideManifest, readsideBefore;
  let testObservation = { requested: runTests, evidenceState: 'not-dispatched', jvmStarted: false, started: false, completed: false, passed: false, errors: [] };
  const phases = result.phases;
  try {
    verifierBefore = { file: fileURLToPath(import.meta.url), sha256: fileDigest(fileURLToPath(import.meta.url)) };
    assert.deepEqual(snapshotFiles(BUILD_SUPPORT), loadedBuildSupport, 'loaded file-evidence helpers changed');
    for (const name of CACHE_DIRS) mkdirSync(join(evidence, name), { mode: 0o700 });
    cachesBefore = Object.fromEntries(CACHE_DIRS.map(name => [name, inventory(join(evidence, name))]));
    const initiallyEmpty = Object.fromEntries(CACHE_DIRS.map(name => [name, Object.keys(cachesBefore[name]).length === 0]));
    save(join(evidence, 'cache-before.json'), cachesBefore);
    admitted = await admitCandidate(output, options);
    assert.deepEqual(admitted.preparedRuntime, preparedRuntime, 'prepared runtime changed during admission');
    result.checks.runtimeSupplyVerified = true;
    if (compileRuntimeTests) {
      runtimeManifest = runtimeTestManifest();
      runtimeBefore = snapshotFiles([...runtimeManifest.sources.map(row => row.file), RUNTIME_MANIFEST_FILE, join(ROOT, 'tools/truthsrc-runtime-jars.mjs')]);
      for (const row of runtimeManifest.sources) assert.equal(row.sha256, runtimeBefore[row.file].sha256, 'runtime source changed during capture');
      save(join(evidence, 'runtime-inputs-before.json'), runtimeBefore);
    }
    if (runActors) actor = await prepareActors(evidence, admitted.testManifest);
    if (runReadside) {
      readsideManifest = readsideTestManifest();
      readsideBefore = snapshotFiles([...readsideManifest.suites.map(suite => suite.file), READSIDE_MANIFEST_FILE]);
      assert.equal(readsideBefore[READSIDE_MANIFEST_FILE].sha256, READSIDE_HELPER_SHA256, 'readside helper changed since loading');
      for (const suite of readsideManifest.suites) assert.equal(suite.sha256, readsideBefore[suite.file].sha256, 'readside source changed during capture');
      save(join(evidence, 'readside-sources-before.json'), readsideBefore);
    }
    executionManifest = runReadside ? combineReadsideManifest(admitted.testManifest, readsideManifest) : actor?.manifest ?? admitted.testManifest;
    testObservation.expected = executionManifest;
    notCancelled();
    save(join(evidence, 'sources-before.json'), { output: admitted.before, handwritten: admitted.handwritten, localRuntime: admitted.runtime });
    result.archive.sha256 = await archiveDigest(archive);
    assert.equal(result.archive.sha256, ARCHIVE_SHA, 'clean 1134 archive SHA differs; no extraction');
    const env = { HOME: join(evidence, 'home'), USERPROFILE: join(evidence, 'home'), JAVA_HOME: javaHome,
      PATH: join(javaHome, 'bin') + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: join(evidence, 'tmp'),
      XDG_CACHE_HOME: join(evidence, 'cache'), XDG_CONFIG_HOME: join(evidence, 'home/.config'), XDG_DATA_HOME: join(evidence, 'home/.local/share'),
      COURSIER_CACHE: join(evidence, 'coursier'), COURSIER_JVM_CACHE: join(evidence, 'cache/jvm'), COURSIER_ARCHIVE_CACHE: join(evidence, 'cache/archives') };
    if (actor) {
      env.BANK_ACTOR_TA_CONFIG = actor.config;
      env.BANK_ACTOR_TA_CONFIG_SHA256 = actor.configSha256;
    }
    const supply = join(evidence, 'supply'), repositories = repositoryText(supply);
    env.COURSIER_REPOSITORIES = repositories.maven + '|ivy:' + repositories.ivy + repositories.pattern;
    save(join(evidence, 'input.json'), { ...options, project: PROJECT, handwrittenRoot: HANDWRITTEN, toolRoot: TOOL,
      generator: admitted.generator, sources: admitted.captured.sources, archiveSha256: ARCHIVE_SHA, preparedRuntime,
      toolchain: Object.fromEntries([java, javac, join(javaHome, 'release'), PYTHON, SANDBOX].map(file => [file, fileDigest(file)])),
      initiallyEmpty, compilerBridgePrefill: false, inheritedEnvironment: false, env, verifier: verifierBefore,
      verifierSupport: loadedBuildSupport,
      testFiles: compileTests ? admitted.testFiles : [], testManifest: runTests ? executionManifest : null,
      runtimeManifest: runtimeManifest ?? null,
      ...(runReadside ? { readsideManifest, readsideInputs: readsideBefore } : {}),
      actor: actor ? { ownedRoot: actor.ownedRoot, fixtureSha256: actor.fixtureSha256, configSha256: actor.configSha256 } : null });
    sandbox = prepareSandbox(evidence, output, actor, runReadside);
    await probeSandbox(sandbox, java, javac, output, evidence, env, phases);
    result.checks.osSandboxEnforced = true;
    if (actor) {
      const probe = join(evidence, 'actor-sandbox-probe.py');
      write(probe, actorReadProbeSource(actor.config, actor.ownedRoot));
      sandbox.controlsBefore[probe] = fileDigest(probe);
      phases.actorSandboxProbe = await command(PYTHON, ['-I', '-S', probe], evidence, env, join(evidence, 'actor-sandbox-check'), 30_000, sandbox);
      succeeded(phases.actorSandboxProbe);
      assert.ok(readFileSync(join(evidence, 'actor-sandbox-check.stdout.log'), 'utf8').includes('TRUTHSRC-ACTOR-SANDBOX-OK'));
      result.checks.actorBoundaryEnforced = true;
    }
    const selection = join(evidence, 'supply-selection.json');
    save(selection, { schemaVersion: 'bank.supply-selection/v1', preparedRuntime, excludedPaths: LEGACY_ENGINE_FILES });
    write(join(evidence, 'extract-supply.py'), extractCurrentSource);
    phases.extract = await command(PYTHON, ['-I', '-S', join(evidence, 'extract-supply.py'), archive, supply, ARCHIVE_SHA,
      selection, fileDigest(selection)], evidence, env, join(evidence, 'extract'), 480_000, sandbox);
    succeeded(phases.extract);
    const extracted = JSON.parse(readFileSync(join(evidence, 'extract.stdout.log'), 'utf8'));
    supplyBefore = inventory(supply);
    validateComposedSupply(extracted, preparedRuntime, supplyBefore);
    assert.deepEqual(capturePreparedRuntime(runtimeSupply), preparedRuntime, 'prepared runtime changed during extraction');
    save(join(evidence, 'supply-before.json'), extracted);
    write(join(evidence, 'repositories'), repositories.text);
    write(join(evidence, 'sbt.boot.properties'), bootText(repositories.text));
    const property = (name, value) => '-D' + name + '=' + value;
    const javaOptions = ['-XX:-UsePerfData',
      '-XX:ErrorFile=' + join(evidence, 'tmp/hs_err_pid%p.log'),
      property('user.home', env.HOME), property('java.io.tmpdir', env.TMPDIR), property('sbt.boot.directory', join(evidence, 'boot')),
      property('sbt.global.base', join(evidence, 'global')), property('sbt.ivy.home', join(evidence, 'ivy')),
      property('coursier.cache', env.COURSIER_CACHE), property('sbt.repository.config', join(evidence, 'repositories')),
      property('sbt.boot.properties', join(evidence, 'sbt.boot.properties')), '-Dsbt.override.build.repos=true',
      property('java.util.prefs.userRoot', join(evidence, 'home/.java/userPrefs')),
      property('java.util.prefs.systemRoot', join(evidence, 'home/.java/systemPrefs')),
      // sbt 1.4.9 always tries its boot Unix socket, independently of autostart.
      // With no console, a denied bind otherwise becomes a silent Exit(2).
      // forcestart continues WITHOUT that socket; it grants no OS permissions.
      // Only safe here with the fresh/exclusive candidate and mandatory sandbox.
      '-Dsbt.server.autostart=false', '-Dsbt.server.forcestart=true', '-Dsbt.supershell=false', '-Dsbt.log.noformat=true', '-Dsbt.ci=true'];
    // Cache/config hints only; confinement is inherited OS state, not removable
    // JAVA_TOOL_OPTIONS or Test / javaOptions. No Test runner/guard override.
    const buildEnv = { ...env, JAVA_TOOL_OPTIONS: javaOptions.join(' ') };
    const tasks = (compileRuntimeTests ? runtimeBuildTasks(admitted.testFiles, runtimeManifest)
      : buildTasks(admitted.testFiles, options, executionManifest, actor)).concat(engineClasspathTasks());
    save(join(evidence, 'build-plan.json'), { javaOptions, tasks, env: buildEnv,
      sandbox: { profile: sandbox.profile, sha256: sandbox.profileSha256, subpaths: sandbox.subpaths, literals: sandbox.literals },
      allowedAppArtifactDirectories: ARTIFACT_DIRS, historicalTestSourcesAppended: !!actor || !!runtimeManifest || !!readsideManifest,
      explicitFrozenRuntimeSources: runtimeManifest?.sources ?? [],
      explicitFrozenActorSources: actor ? actor.manifest.suites.filter(s => s.sourceKind === 'frozen-business-test').map(s => s.file) : [],
      ...(runReadside ? { explicitFrozenReadsideSources: readsideSourceFiles(executionManifest, admitted.testFiles) } : {}),
      testExecutionSupported: true, testExecutionRequested: runTests, testManifest: runTests ? executionManifest : null });
    checkSandbox(sandbox);
    assert.deepEqual(inventory(supply), supplyBefore, 'supply changed before build');
    admitted.assertUnchanged(admitted.captured);
    assert.deepEqual(inventory(output), admitted.before, 'candidate changed before build');
    assert.deepEqual(inventory(HANDWRITTEN), admitted.handwritten, 'handwritten input changed before build');
    assert.deepEqual(inventory(admitted.runtimeRoot), admitted.runtime, 'local runtime changed before build');
    assert.deepEqual(capturePreparedRuntime(runtimeSupply), preparedRuntime, 'prepared runtime changed before build');
    if (actor) assert.deepEqual(snapshotFiles(Object.keys(actor.before)), actor.before, 'actor inputs changed before build');
    if (runtimeBefore) assert.deepEqual(snapshotFiles(Object.keys(runtimeBefore)), runtimeBefore, 'runtime sources changed before build');
    if (readsideBefore) {
      assert.deepEqual(snapshotFiles(Object.keys(readsideBefore)), readsideBefore, 'readside tests/helper changed before build');
      assert.deepEqual(readsideTestManifest(), readsideManifest, 'readside source pins changed before build');
    }
    notCancelled();
    // Cooperative output claim within the only allowed app-write territory.
    // Never remove another invocation's claim or clean/reuse old build outputs.
    assertFreshOutput(output);
    mkdirSync(join(output, 'target'));
    save(join(output, 'target/truthsrc-build-owner.json'), { evidence, pid: process.pid, project: PROJECT });
    if (runTests) {
      result.testsExecuted = null;
      testObservation = { requested: true, evidenceState: 'unavailable', jvmStarted: null, started: null, completed: null,
        passed: false, expected: executionManifest, errors: [] };
    }
    phases.build = await command(java, ['-Xmx2G', '-XX:ActiveProcessorCount=2', ...javaOptions,
      '-cp', join(supply, 'launcher/sbt-launch.jar'), 'xsbt.boot.Boot', ...tasks],
      output, buildEnv, join(evidence, 'build'), 480_000, sandbox);
    const stdout = readFileSync(join(evidence, 'build.stdout.log'));
    assert.equal(hash(stdout), phases.build.stdoutSha256, 'build log changed before result verification');
    result.resolvedDependencies = inspectEngineClasspath(stdout.toString('utf8'), evidence, preparedRuntime);
    save(join(evidence, 'resolved-dependencies.json'), result.resolvedDependencies);
    result.checks.runtimeClasspathEnginesVerified = true;
    if (runTests) {
      try {
        testObservation = inspectGeneratedTests(stdout.toString('utf8'), executionManifest, phases.build.pid);
        result.testsExecuted = testObservation.started;
      } catch (error) {
        testObservation.errors.push('test execution evidence unavailable: ' + error.message);
        throw error;
      }
    }
    const actualRoot = actualBuildSourceRoot(stdout.toString('utf8'), output, evidence);
    const actualSources = inventory(actualRoot, { afterBuild: true });
    const actualCheck = compareBuildSources(admitted.before, actualSources);
    result.checks.actualBuildSourcesVerified = true;
    save(join(evidence, 'actual-build-sources.json'), { ...actualCheck, root: actualRoot, staged: actualRoot !== output,
      admittedOutput: output, stdoutSha256: phases.build.stdoutSha256, sources: actualSources });
    if (actor) {
      const sourceMarkers = [...stdout.toString('utf8').matchAll(/^TRUTHSRC-ACTOR-SOURCES=(.+)$/gm)];
      assert.equal(sourceMarkers.length, 1, 'one actual Test sources marker required');
      const expected = [...admitted.testFiles.map(file => join(actualRoot, file)), ...actor.manifest.suites.filter(s => s.sourceKind === 'frozen-business-test').map(s => s.file)].sort();
      assert.deepEqual(sourceMarkers[0][1].split(',').sort(), expected, 'actual compiled Test sources differ');
      result.checks.actualTestSourcesVerified = true;
    }
    if (runReadside) {
      testObservation.sourceClosure = inspectReadsideSources(stdout.toString('utf8'), actualRoot, admitted.testFiles, executionManifest);
      result.checks.actualTestSourcesVerified = true;
    }
    if (runtimeManifest) {
      const closure = inspectRuntimeCompilation(stdout.toString('utf8'), actualRoot, admitted.testFiles, runtimeManifest);
      const classpathInventory = runtimeClasspathInventory(closure.classpath, actualRoot, evidence, { safePath, inventory, fileDigest });
      const jarProbe = join(evidence, 'runtime-jars.py'), jarList = join(evidence, 'runtime-jars-input.json');
      write(jarProbe, jarManifestProbeSource); save(jarList, closure.classpath.filter(file => file.endsWith('.jar')));
      sandbox.controlsBefore[jarProbe] = fileDigest(jarProbe); sandbox.controlsBefore[jarList] = fileDigest(jarList);
      phases.runtimeJars = await command(PYTHON, ['-I', '-S', jarProbe, jarList], evidence, env,
        join(evidence, 'runtime-jars-probe'), 30_000, sandbox);
      succeeded(phases.runtimeJars);
      const jarRecords = JSON.parse(readFileSync(join(evidence, 'runtime-jars-probe.stdout.log'), 'utf8'));
      const jarReferences = validateJarReferences(closure.classpath, jarRecords, { safePath, fileDigest });
      save(join(evidence, 'runtime-jars.json'), jarReferences);
      for (const engine of result.resolvedDependencies.engines)
        assert.equal(closure.classpath.filter(file => file === engine.file).length, 1, 'resolved engine missing from runtime classpath');
      runtimeObservation = { schemaVersion: 'bank.truthsrc-runtime-build/v2', output, buildEvidence: evidence,
        preparedRuntime, resolvedDependencies: result.resolvedDependencies,
        actualRoot, sources: closure.sources, manifest: runtimeManifest, classpath: closure.classpath, classpathInventory, jarReferences,
        buildStdoutSha256: phases.build.stdoutSha256, testsExecuted: false, servicesStarted: false };
      result.checks.actualRuntimeTestSourcesVerified = true;
      result.checks.runtimeClasspathVerified = true;
    }
    succeeded(phases.build);
  } catch (error) {
    result.errors.push(error.message);
    if (runTests && testObservation.evidenceState === 'unavailable')
      testObservation.errors.push('test execution evidence unavailable: ' + error.message);
  }
  finally {
    // Reconcile even on compiler failure, timeout or cancellation. Detection is
    // not rollback and does not make concurrent directory replacement atomic.
    if (admitted) {
      const after = {};
      for (const [name, root, before, opts] of [
        ['output', output, admitted.before, { afterBuild: true }],
        ['handwritten', HANDWRITTEN, admitted.handwritten, {}], ['localRuntime', admitted.runtimeRoot, admitted.runtime, {}],
        ...(supplyBefore ? [['supply', join(evidence, 'supply'), supplyBefore, {}]] : []),
      ]) {
        try {
          after[name] = inventory(root, opts);
          result.checks[name + 'Unchanged'] = isDeepStrictEqual(before, after[name]);
          assert.ok(result.checks[name + 'Unchanged'], name + ' bytes/file set changed');
        } catch (error) { result.checks[name + 'Unchanged'] = false; result.errors.push(error.message); }
      }
      try { admitted.assertUnchanged(admitted.captured); result.checks.currentInputsUnchanged = true; }
      catch (error) { result.checks.currentInputsUnchanged = false; result.errors.push(error.message); }
      try { save(join(evidence, 'sources-after.json'), after); }
      catch (error) { result.errors.push(error.message); }
    }
    if (actor) {
      try {
        const after = snapshotFiles(Object.keys(actor.before));
        save(join(evidence, 'actor-inputs-after.json'), after);
        assert.deepEqual(after, actor.before, 'actor tests/worker/configuration inputs changed');
        result.checks.actorInputsUnchanged = true;
      } catch (error) { result.checks.actorInputsUnchanged = false; result.errors.push(error.message); }
      try {
        const workers = verifyActorWorkers(actor);
        save(join(evidence, 'actor-workers.json'), workers);
        result.checks.actorWorkersVerified = true;
      } catch (error) { result.checks.actorWorkersVerified = false; result.errors.push(error.message); }
      try { save(join(evidence, 'actor-journals-after.json'), inventory(actor.ownedRoot)); }
      catch (error) { result.errors.push(error.message); }
    }
    if (readsideBefore) {
      try {
        const after = snapshotFiles(Object.keys(readsideBefore));
        save(join(evidence, 'readside-sources-after.json'), after);
        assert.deepEqual(after, readsideBefore, 'readside test/helper inputs changed');
        result.checks.readsideInputsUnchanged = true;
      } catch (error) { result.checks.readsideInputsUnchanged = false; result.errors.push(error.message); }
      try {
        assert.deepEqual(readsideTestManifest(), readsideManifest, 'frozen readside source pins changed before sealing');
        result.checks.readsideSourcesPinned = true;
      } catch (error) { result.checks.readsideSourcesPinned = false; result.errors.push(error.message); }
    }
    if (runtimeBefore) {
      try {
        const after = snapshotFiles(Object.keys(runtimeBefore));
        save(join(evidence, 'runtime-inputs-after.json'), after);
        assert.deepEqual(after, runtimeBefore, 'runtime test/support inputs changed');
        result.checks.runtimeTestInputsUnchanged = true;
        if (runtimeObservation) assert.deepEqual(runtimeClasspathInventory(runtimeObservation.classpath, runtimeObservation.actualRoot, evidence,
          { safePath, inventory, fileDigest }), runtimeObservation.classpathInventory, 'runtime classpath changed before sealing');
        if (runtimeObservation) assertJarReferencesUnchanged(runtimeObservation.jarReferences, { safePath, fileDigest });
      } catch (error) { result.checks.runtimeTestInputsUnchanged = false; result.errors.push(error.message); }
    }
    if (sandbox) {
      try {
        save(join(evidence, 'sandbox-after.json'), checkSandbox(sandbox));
        result.checks.sandboxControlsAndCanariesUnchanged = true;
      } catch (error) { result.checks.sandboxControlsAndCanariesUnchanged = false; result.errors.push(error.message); }
    }
    if (cachesBefore) {
      try {
        // Caches are intentionally mutable, but only inside the new evidence.
        // Record their complete final byte inventories; never compare to user caches.
        save(join(evidence, 'cache-after.json'), Object.fromEntries(CACHE_DIRS.map(name => [name, inventory(join(evidence, name))])));
        result.checks.ownedCachesInventoried = true;
      } catch (error) { result.checks.ownedCachesInventoried = false; result.errors.push(error.message); }
    }
    try {
      assert.deepEqual(capturePreparedRuntime(runtimeSupply), preparedRuntime, 'prepared runtime changed before sealing');
      result.checks.runtimeSupplyVerified = true;
    } catch (error) { result.checks.runtimeSupplyVerified = false; result.errors.push(error.message); }
    try {
      assert.ok(verifierBefore, 'verifier baseline unavailable');
      assert.deepEqual(snapshotFiles(BUILD_SUPPORT), loadedBuildSupport, 'file-evidence helpers changed during execution');
      result.checks.verifierUnchanged = fileDigest(verifierBefore.file) === verifierBefore.sha256;
      assert.ok(result.checks.verifierUnchanged, 'verifier changed during execution');
    } catch (error) { result.checks.verifierUnchanged = false; result.errors.push(error.message); }
    await drainPendingSignals();
    result.cancelled = cancelled;
    if (cancelled) result.errors.push('cancelled: ' + cancelled);
    if (runTests) {
      const key = runActors ? 'actorTests' : runReadside ? 'readsideTests' : 'generatedTests', check = key + 'Passed';
      result[key] = completeGeneratedTests(testObservation, phases.build, result.checks, cancelled, result.errors);
      result.checks[check] = result[key].passed;
      if (!result[key].passed) result.errors.push('tests not verified: ' + result[key].errors.join('; '));
      try { save(join(evidence, runActors ? 'actor-tests.json' : runReadside ? 'readside-tests.json' : 'generated-tests.json'), { ...result[key], stdoutSha256: phases.build?.stdoutSha256 ?? null }); }
      catch (error) { result[key].passed = false; result.checks[check] = false; result.errors.push(error.message); }
    }
    if (compileRuntimeTests) {
      let processPassed = false;
      try { succeeded(phases.build); processPassed = true; } catch { /* retained by the source-bound result */ }
      result.runtimeCompilation = completeRuntimeCompilation(runtimeObservation, result.checks, processPassed, result.errors);
      result.checks.runtimeCompilationPassed = result.runtimeCompilation.passed;
      try { save(join(evidence, 'runtime-build.json'), result.runtimeCompilation); }
      catch (error) { result.runtimeCompilation.passed = false; result.checks.runtimeCompilationPassed = false; result.errors.push(error.message); }
      if (!result.runtimeCompilation.passed) result.errors.push('runtime compilation was not source-bound');
    }
    const executionPassed = runReadside ? result.readsideTests.passed : (!runTests || result[runActors ? 'actorTests' : 'generatedTests'].passed);
    result.status = result.errors.length === 0 && result.checks.osSandboxEnforced && phases.build?.code === 0 &&
      result.checks.runtimeSupplyVerified && result.checks.runtimeClasspathEnginesVerified && executionPassed ? 'passed' : 'blocked';
    save(join(evidence, 'result.json'), result);
  }
  console.log(json({ status: result.status, evidence, receipt: join(evidence, 'result.json'), testsExecuted: result.testsExecuted,
    generatedTestsPassed: result.generatedTests.passed, actorTestsPassed: result.actorTests.passed, readsideTestsPassed: result.readsideTests.passed }));
  if (result.status !== 'passed') process.exitCode = cancelled === 'SIGINT' ? 130 : cancelled === 'SIGTERM' ? 143 : 2;
}

if (isMainModule(process.argv[1], import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options) console.log(usage);
    else {
      process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
      try { await verify(options); }
      finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = cancelled === 'SIGINT' ? 130 : cancelled === 'SIGTERM' ? 143 : 2;
  }
}
