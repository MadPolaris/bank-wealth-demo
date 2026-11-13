import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyImmutableData } from '../../metarch-truthsrc/lib/immutable-data.mjs';
import { MAX_JSON_BYTES, parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { captureEvidenceFile, fingerprintEvidenceFile } from '../../metarch-truthsrc/lib/verification/files.mjs';
import { compareEvidenceInventories, createEvidenceReferences, inventoryEvidence } from '../../metarch-truthsrc/lib/verification/inventory.mjs';
import { safePath } from './truthsrc-evidence.mjs';

// Bank policy only: no prepare invocation, compiler, extraction, resolver or writer.
const MODULE_FILE = fileURLToPath(import.meta.url), ROOT = resolve(dirname(MODULE_FILE), '..');
export const RUNTIME_VERSION = '0.3.0';
export const SUPPLY_LOCK_FILE = join(ROOT, 'docs/RUNTIME-0.3.0-SUPPLY.json');
export const SUPPLY_SUPPORT = Object.freeze([MODULE_FILE, SUPPLY_LOCK_FILE]);
export const ARCHIVE_SHA256 = '95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade';
export const ARCHIVE_COUNTS = Object.freeze({ maven: 1048, ivy: 16, launcher: 1 });
export const COMPOSITE_COUNTS = Object.freeze({ maven: 1018, ivy: 16, launcher: 1 });
const ENGINES = ['saga-core_2.13', 'monarch-core_2.13', 'monarch-persistence_2.13'];
const P23 = '0.2.1-p23.20261027.1';
// Exact selected maven members of the pinned archive, not a version/name glob.
export const LEGACY_ENGINE_FILES = Object.freeze(ENGINES.flatMap(artifact =>
  ['-javadoc.jar', '-sources.jar', '.jar', '.pom'].flatMap(suffix => ['', '.md5', '.sha1'].map(checksum =>
    `maven/net/imadz/${artifact}/${P23}/${artifact}-${P23}${suffix}${checksum}`))).sort());
const LOCK_STAMP = Object.freeze({ bytes: 4955, sha256: 'e70fbdd09e0119e7f12824fd810fb5273ddc8cdd9747ae8fc7c7194d66f7514e' });
const FILE_LIMIT = 256 * 1024 * 1024;
const CLASSPATH_MARKER = 'TRUTHSRC-RESOLVED-CLASSPATH=';
const SYMBOLIC_TARGET = 'net.imadz:saga-core:strict-runtime-binding-v1-SNAPSHOT';
const stamp = ({ bytes, sha256 }) => ({ bytes, sha256 });
const reference = (file, captured) => ({ file, ...stamp(captured) });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gav = artifact => [artifact.groupId, artifact.artifactId, artifact.version].join(':');
const repository = root => pathToFileURL(join(root, 'maven')).href + '/';
const engineName = name => /^(?:saga-core|monarch-core|monarch-persistence)(?:[_.-]|$)/i.test(name);
const enginePath = file => file.split('/').some(engineName);

function object(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  return value;
}
function keys(value, expected, label) {
  assert.deepEqual(Object.keys(object(value, label)).sort(), [...expected].sort(), label + ': unexpected fields/members');
}
function options(value, allowed) {
  const data = object(copyImmutableData(value), 'options');
  assert.ok(Object.keys(data).every(key => allowed.includes(key)), 'unknown supply option');
  return data;
}
function plainAbsolute(file) {
  assert.ok(typeof file === 'string' && isAbsolute(file) && resolve(file) === file &&
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) && !file.split('/').includes('.scratch'),
  'canonical plain absolute path required: ' + file);
}
function plainRelative(file) {
  assert.ok(typeof file === 'string' && /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) &&
    !file.split('/').some(part => ['.', '..', '.scratch'].includes(part)), 'plain relative supply path required: ' + file);
}
function protectedStat(file, kind) {
  const stat = lstatSync(file);
  assert.ok(!stat.isSymbolicLink() && (kind === 'file' ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()),
    'regular single-link file or plain directory required: ' + file);
  assert.equal(stat.mode & 0o022, 0, 'group/world-writable supply path forbidden: ' + file);
  return [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid];
}
function ancestors(directory) {
  const rows = [];
  for (let current = directory; ; current = dirname(current)) {
    rows.push([current, protectedStat(current, 'directory')]);
    if (dirname(current) === current) return rows;
  }
}
function capture(file, references, { json = false, limit = MAX_JSON_BYTES } = {}) {
  safePath(file, 'file');
  protectedStat(file, 'file');
  const before = ancestors(dirname(file));
  const captured = captureEvidenceFile(file, { limit, ...(json ? { parse: parseStrictJson } : {}) });
  assert.deepEqual(ancestors(dirname(file)), before, 'capture ancestor changed');
  protectedStat(file, 'file');
  references?.retain(reference(file, captured), { limit });
  return captured;
}
function loadLock(references) {
  const captured = capture(SUPPLY_LOCK_FILE, references, { json: true });
  // The lock is independent of the peer receipt; changing both is not self-proof.
  assert.deepEqual(stamp(captured), LOCK_STAMP, 'independent 0.3.0 supply lock changed');
  const lock = copyImmutableData(captured.value);
  assert.equal(lock.schemaVersion, 'bank.runtime-supply-lock/v1');
  assert.equal(lock.version, RUNTIME_VERSION);
  assert.equal(lock.archive.sha256, ARCHIVE_SHA256);
  assert.deepEqual(lock.archive.counts, ARCHIVE_COUNTS);
  assert.deepEqual(lock.artifacts.map(row => row.artifactId), ENGINES);
  return { value: lock, ref: reference(SUPPLY_LOCK_FILE, captured) };
}
function pinnedFiles(lock) {
  return lock.artifacts.flatMap(artifact => ['jar', 'pom'].map(extension => ({
    path: artifact[extension].path, coordinate: gav(artifact), extension, ...stamp(artifact[extension]),
  })));
}

// Check the exact directory closure as well as the seven files. Empty extra
// directories are not an exemption. Public inventory/capture owns byte/FD checks.
function preparedLayout(root, files) {
  safePath(root);
  const directories = new Set(['']), kinds = new Map(files.map(file => [file, 'file']));
  for (const file of files) {
    plainRelative(file);
    for (let parent = dirname(file); parent !== '.'; parent = dirname(parent)) directories.add(parent);
  }
  for (const directory of directories) kinds.set(directory, 'directory');
  const parents = ancestors(dirname(root)), entries = [];
  for (const [name, kind] of [...kinds].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const file = name ? join(root, name) : root, identity = protectedStat(file, kind);
    const names = kind === 'directory' ? readdirSync(file).sort() : null;
    if (names) assert.deepEqual(names, [...kinds.keys()].filter(key => key &&
      (dirname(key) === '.' ? '' : dirname(key)) === name).map(key => key.split('/').at(-1)).sort(),
    'unexpected prepared runtime directory members: ' + file);
    entries.push({ file, identity, names });
  }
  return { parents, entries };
}

// Inspect only the already SHA-pinned XML dialect. This is not Maven dependency
// resolution, XML entity evaluation, or a general-purpose XML parser.
function checkPom(bytes, artifact) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(!/<!|&/.test(text), 'POM entities/declarations are not supported');
  const blocks = [...text.matchAll(/<dependencies>([\s\S]*?)<\/dependencies>/g)];
  assert.equal(blocks.length, 1, 'one declared POM dependency list required');
  const header = text.slice(0, blocks[0].index);
  const tag = (body, name, fallback) => {
    const matches = [...body.matchAll(new RegExp('<' + name + '>([^<>]+)</' + name + '>', 'g'))];
    if (!matches.length && fallback !== undefined) return fallback;
    assert.equal(matches.length, 1, 'one literal POM ' + name + ' required');
    return matches[0][1];
  };
  assert.equal(tag(header, 'modelVersion'), '4.0.0');
  for (const name of ['groupId', 'artifactId', 'version', 'packaging']) assert.equal(tag(header, name), artifact[name], 'POM identity differs: ' + name);
  const dependencies = [...blocks[0][1].matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  assert.equal(blocks[0][1].replace(/<dependency>[\s\S]*?<\/dependency>/g, '').trim(), '', 'unknown dependency-list content');
  const declared = dependencies.map(([, body]) => {
    assert.equal(body.replace(/<(groupId|artifactId|version|scope)>[^<>]+<\/\1>/g, '').trim(), '', 'unknown POM dependency fields');
    return { coordinate: ['groupId', 'artifactId', 'version'].map(name => tag(body, name)).join(':'), scope: tag(body, 'scope', 'compile') };
  });
  assert.deepEqual(declared, artifact.dependencies, 'declared POM dependencies differ from independent lock');
}
function projectRepository(value, projectFile) {
  assert.equal(typeof value, 'string', 'project runtime repository required');
  let directory;
  if (/^\.\.?\//.test(value)) {
    const raw = value.replace(/\/$/, '').replace(/^\.\//, '');
    assert.ok(/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(raw) && normalize(raw) === raw,
      'plain relative project repository required');
    directory = resolve(dirname(projectFile), raw);
  } else {
    const url = new URL(value);
    assert.equal(url.protocol, 'file:', 'only the explicitly prepared file repository is admitted');
    assert.ok(!url.host && !url.search && !url.hash, 'local repository URL required');
    directory = fileURLToPath(url).replace(/\/$/, '');
    assert.ok(value === pathToFileURL(directory).href || value === pathToFileURL(directory).href + '/', 'repository URL alias forbidden');
  }
  safePath(directory);
  return pathToFileURL(directory).href + '/';
}

export function capturePreparedRuntime(directory, input = {}) {
  const { projectFile = join(ROOT, 'truthsrc.project.json') } = options(input, ['projectFile']);
  const references = createEvidenceReferences(), locked = loadLock(references), lock = locked.value;
  const files = pinnedFiles(lock), names = ['receipt.json', ...files.map(row => row.path)];
  const layout = preparedLayout(directory, names), before = inventoryEvidence(directory, { limit: FILE_LIMIT });
  keys(before, names, 'prepared runtime inventory');
  const receipt = capture(join(directory, 'receipt.json'), references, { json: true });
  const peer = receipt.value;
  keys(peer, ['schemaVersion', 'source', 'version', 'files', 'runtimeRebuilt'], 'runtime receipt');
  assert.equal(peer.schemaVersion, 'bank.truthsrc-runtime/v2');
  assert.equal(peer.source, 'maven-central');
  assert.equal(peer.version, RUNTIME_VERSION);
  assert.equal(peer.runtimeRebuilt, false);
  assert.ok(Array.isArray(peer.files), 'runtime receipt file list required');
  for (const row of peer.files) keys(row, ['file', 'sha256'], 'runtime receipt file');
  const byFile = (a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  assert.deepEqual([...peer.files].sort(byFile), files.map(row => ({ file: row.path, sha256: row.sha256 })).sort(byFile), 'receipt members differ from independent pins');
  assert.deepEqual(stamp(receipt), before['receipt.json'], 'receipt changed during capture');
  for (const row of files) {
    const captured = capture(join(directory, row.path), references, { limit: row.bytes });
    assert.deepEqual(stamp(captured), stamp(row), 'independent runtime pin differs: ' + row.path);
    assert.deepEqual(stamp(captured), before[row.path], 'runtime file changed during capture: ' + row.path);
    if (row.extension === 'pom') checkPom(captured.value, lock.artifacts.find(artifact => gav(artifact) === row.coordinate));
  }
  const project = capture(projectFile, references, { json: true }).value;
  assert.equal(project.schemaVersion, 'truthsrc.project/v1', 'unknown project schema');
  const selected = project.options?.runtimeArtifact, saga = files.find(row => row.coordinate === 'net.imadz:saga-core_2.13:0.3.0' && row.extension === 'jar');
  keys(selected, ['coordinate', 'sha256', 'repository', 'symbolicTarget'], 'project runtimeArtifact');
  assert.equal(selected.coordinate, saga.coordinate, 'project runtime coordinate differs');
  assert.equal(selected.sha256, saga.sha256, 'project runtime hash differs');
  assert.equal(selected.symbolicTarget, SYMBOLIC_TARGET, 'unknown project symbolic runtime target');
  assert.equal(projectRepository(selected.repository, projectFile), repository(directory), 'project repository does not select this prepared runtime');
  references.assertUnchanged();
  compareEvidenceInventories(before, inventoryEvidence(directory, { limit: FILE_LIMIT }));
  assert.deepEqual(preparedLayout(directory, names), layout, 'prepared runtime paths/permissions changed');
  return copyImmutableData({ schemaVersion: 'bank.prepared-runtime/v3', root: directory, repository: repository(directory),
    version: RUNTIME_VERSION, receipt: reference(join(directory, 'receipt.json'), receipt), lock: locked.ref, files, inventory: before });
}

export async function captureAcceptanceSupply(archive, directory, input = {}) {
  const { root = ROOT } = options(input, ['root']);
  safePath(root); safePath(archive, 'file'); protectedStat(archive, 'file');
  const parents = ancestors(dirname(archive)), references = createEvidenceReferences();
  // Public bounded streaming fingerprinting does not retain this 454 MB archive.
  const captured = fingerprintEvidenceFile(archive);
  assert.equal(captured.sha256, ARCHIVE_SHA256, 'clean1134 archive SHA differs');
  references.retain(reference(archive, captured));
  const runtime = capturePreparedRuntime(directory, { projectFile: join(root, 'truthsrc.project.json') });
  references.assertUnchanged();
  assert.deepEqual(ancestors(dirname(archive)), parents, 'archive ancestor changed');
  protectedStat(archive, 'file');
  return copyImmutableData({ schemaVersion: 'bank.acceptance-supply/v3', archive: reference(archive, captured), runtime });
}

function checkInventory(value, label) {
  object(value, label);
  // Reuse strict fingerprint/alias/unknown-field validation, without filesystem IO.
  compareEvidenceInventories(value, value);
  for (const [file, fingerprint] of Object.entries(value)) {
    plainRelative(file);
    assert.ok(fingerprint.bytes <= FILE_LIMIT, 'oversized supply member: ' + file);
  }
}
function countInventory(files) {
  const counts = { maven: 0, ivy: 0, launcher: 0 };
  for (const file of Object.keys(files)) {
    const namespace = file.split('/')[0];
    assert.ok(Object.hasOwn(counts, namespace) && file.includes('/'), 'unknown supply namespace: ' + file);
    if (namespace === 'launcher') assert.equal(file, 'launcher/sbt-launch.jar', 'unexpected launcher');
    counts[namespace]++;
  }
  return counts;
}
function inventoryHash(files) {
  return hash(JSON.stringify(Object.keys(files).sort().map(file => [file, files[file].bytes, files[file].sha256])));
}
function checkPrepared(prepared, locked) {
  keys(prepared, ['schemaVersion', 'root', 'repository', 'version', 'receipt', 'lock', 'files', 'inventory'], 'prepared runtime');
  assert.equal(prepared.schemaVersion, 'bank.prepared-runtime/v3');
  assert.equal(prepared.version, RUNTIME_VERSION);
  plainAbsolute(prepared.root);
  assert.equal(prepared.repository, repository(prepared.root));
  keys(prepared.receipt, ['file', 'bytes', 'sha256'], 'prepared receipt reference');
  assert.equal(prepared.receipt.file, join(prepared.root, 'receipt.json'));
  assert.deepEqual(prepared.lock, locked.ref, 'prepared runtime uses a different independent lock');
  assert.deepEqual(prepared.files, pinnedFiles(locked.value), 'prepared runtime file pins differ');
  checkInventory(prepared.inventory, 'prepared inventory');
  compareEvidenceInventories(prepared.inventory, { 'receipt.json': stamp(prepared.receipt),
    ...Object.fromEntries(prepared.files.map(row => [row.path, stamp(row)])) });
}

export function validateComposedSupply(record, prepared, actualInventory) {
  const data = copyImmutableData({ record, prepared, actualInventory }), locked = loadLock();
  record = data.record; prepared = data.prepared; actualInventory = data.actualInventory;
  keys(record, ['schemaVersion', 'archiveSha256', 'membersValidated', 'archiveCounts', 'counts', 'archiveFiles',
    'excludedFiles', 'overlays', 'preparedRuntime', 'files'], 'composed supply');
  assert.equal(record.schemaVersion, 'bank.composed-supply/v3', 'unknown composed supply schema');
  assert.equal(record.archiveSha256, ARCHIVE_SHA256);
  assert.equal(record.membersValidated, locked.value.archive.membersValidated, 'archive member validation count differs');
  assert.deepEqual(record.archiveCounts, ARCHIVE_COUNTS);
  assert.deepEqual(record.counts, COMPOSITE_COUNTS);
  checkPrepared(prepared, locked);
  assert.deepEqual(record.preparedRuntime, prepared, 'composed supply has a different prepared runtime');
  for (const name of ['archiveFiles', 'excludedFiles', 'overlays', 'files']) checkInventory(record[name], name);
  checkInventory(actualInventory, 'actual supply inventory');
  assert.deepEqual(countInventory(record.archiveFiles), ARCHIVE_COUNTS);
  assert.equal(inventoryHash(record.archiveFiles), locked.value.archive.inventorySha256, 'original archive inventory differs from pinned bytes');
  keys(record.excludedFiles, LEGACY_ENGINE_FILES, 'exact P23 exclusion set');
  assert.deepEqual(Object.keys(record.archiveFiles).filter(enginePath).sort(), LEGACY_ENGINE_FILES, 'unexpected original engine members');
  for (const file of LEGACY_ENGINE_FILES) {
    assert.ok(Object.hasOwn(record.archiveFiles, file), 'excluded file absent from archive: ' + file);
    assert.deepEqual(record.excludedFiles[file], record.archiveFiles[file], 'excluded file stamp differs: ' + file);
  }
  const overlays = Object.fromEntries(prepared.files.map(row => [row.path, stamp(row)]));
  compareEvidenceInventories(record.overlays, overlays);
  for (const file of Object.keys(overlays)) assert.ok(!Object.hasOwn(record.archiveFiles, file), 'overlay overlaps original archive: ' + file);
  const effective = { ...Object.fromEntries(Object.entries(record.archiveFiles).filter(([file]) => !Object.hasOwn(record.excludedFiles, file))), ...overlays };
  compareEvidenceInventories(record.files, effective);
  compareEvidenceInventories(actualInventory, effective);
  assert.deepEqual(countInventory(effective), COMPOSITE_COUNTS);
  assert.equal(Object.keys(effective).length, 1035);
  assert.deepEqual(Object.keys(effective).filter(enginePath).sort(), Object.keys(overlays).sort(), 'legacy/unknown engine remains in effective supply');
  return record;
}

// Append these TWO commands after normal compile/test tasks. moduleID.key is
// sbt's actual Attributed[File] ModuleID key; revisions never come from filenames.
export function engineClasspathTasks() {
  return [
    'set Compile / dependencyClasspath := { val entries=(Compile / dependencyClasspath).value; println("TRUTHSRC-RESOLVED-CLASSPATH=" + entries.map(e => e.get(moduleID.key).map(m=>m.organization+":"+m.name+":"+m.revision).getOrElse("")+"="+e.data.getCanonicalPath).mkString("|")); entries }',
    'show Compile / dependencyClasspath',
  ];
}

export function inspectEngineClasspath(stdout, evidence, prepared) {
  assert.equal(typeof stdout, 'string', 'build stdout text required');
  prepared = copyImmutableData(prepared);
  const references = createEvidenceReferences(), locked = loadLock(references);
  checkPrepared(prepared, locked);
  safePath(evidence);
  const supply = join(evidence, 'supply');
  safePath(supply);
  const parents = ancestors(supply);
  const lines = stdout.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.replace(/^\[info\] ?/, ''));
  const markers = lines.filter(line => line.includes(CLASSPATH_MARKER));
  assert.equal(markers.length, 1, 'exactly one resolved dependency classpath marker required');
  assert.ok(markers[0].startsWith(CLASSPATH_MARKER), 'malformed resolved dependency marker');
  const pins = prepared.files.filter(row => row.extension === 'jar'), seen = new Set(), engines = [];
  const entries = markers[0].slice(CLASSPATH_MARKER.length).split('|').map(entry => {
    const match = entry.match(/^([A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+)=(.+)$/);
    assert.ok(match, 'attributed module GAV and file required for every dependency');
    const [, coordinate, file] = match;
    safePath(file, 'file'); protectedStat(file, 'file');
    assert.ok(file.startsWith(supply + '/') && file.endsWith('.jar'), 'dependency must be a JAR from this build supply: ' + file);
    const path = relative(supply, file);
    plainRelative(path);
    assert.ok(path.startsWith('maven/') || path.startsWith('ivy/'), 'dependency outside repository namespaces');
    assert.ok(!seen.has(file), 'duplicate dependency file: ' + file); seen.add(file);
    const captured = fingerprintEvidenceFile(file, { limit: FILE_LIMIT });
    references.retain(reference(file, captured), { limit: FILE_LIMIT });
    const row = { coordinate, file, ...stamp(captured) };
    // Common-core 0.2 is legitimate. Only engine identities/path families (or
    // duplicate pinned engine bytes under another name) receive the engine gate.
    if (engineName(coordinate.split(':')[1]) || enginePath(path) || pins.some(pin => pin.sha256 === row.sha256)) {
      const pin = pins.find(pin => pin.coordinate === coordinate);
      assert.ok(pin, 'old or unknown engine coordinate: ' + coordinate);
      assert.equal(path, pin.path, 'engine JAR is not at its pinned supply path');
      assert.deepEqual(stamp(row), stamp(pin), 'resolved engine bytes differ: ' + coordinate);
      engines.push(row);
    }
    return row;
  });
  assert.deepEqual(engines.map(row => row.coordinate).sort(), pins.map(row => row.coordinate).sort(), 'three exact released engine modules required');
  references.assertUnchanged();
  for (const row of entries) protectedStat(row.file, 'file');
  assert.deepEqual(ancestors(supply), parents, 'dependency supply ancestors changed');
  return copyImmutableData({ schemaVersion: 'bank.resolved-dependencies/v1', entries, engines });
}

const usage = `Usage: node tools/truthsrc-acceptance-supply.mjs --check \\
  --archive <absolute-clean1134.tar.gz> --runtime-supply <absolute-prepared-runtime>

Read-only capture of the released 0.3.0 supply selected by truthsrc.project.json.
No preparation, extraction, downloads, compilation, tests or services are run.
Use --help alone for this scope; --check requires both explicit supply paths.`;

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(usage);
    else {
      const flags = new Map();
      for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        assert.ok(!flags.has(flag), 'duplicate flag: ' + flag);
        if (flag === '--check') { flags.set(flag, true); continue; }
        assert.ok(['--archive', '--runtime-supply'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--'), usage);
        flags.set(flag, args[++i]);
      }
      assert.ok(flags.has('--check') && flags.has('--archive') && flags.has('--runtime-supply'), usage);
      const captured = await captureAcceptanceSupply(flags.get('--archive'), flags.get('--runtime-supply'));
      console.log(JSON.stringify(captured, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
