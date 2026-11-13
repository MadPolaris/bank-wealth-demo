import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureEvidenceFile, fingerprintEvidenceFile } from '../../metarch-truthsrc/lib/verification/files.mjs';
import { safePath } from './truthsrc-evidence.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOL = resolve(ROOT, '../metarch-truthsrc');
export const STAGES = Object.freeze(['source', 'anchors', 'code', 'service']);
export const ARCHIVE_SHA256 = '95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade';
export const DEFAULT_JAVA_HOME = '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonText = value => JSON.stringify(value, null, 2) + '\n';
export const within = (root, file) => file === root || file.startsWith(root + '/');
export const overlap = (a, b) => within(a, b) || within(b, a);
export const requestedStages = through => {
  assert.ok(STAGES.includes(through), 'through must be source, anchors, code or service');
  return STAGES.slice(0, STAGES.indexOf(through) + 1);
};

// Argument-only validation: source never opens an unused archive/runtime directory.
// Doctor can describe missing materials; verify must reject missing flags before writes.
export function validateSupplyOptions(options, { required = true } = {}) {
  requestedStages(options.through);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  if (options.through === 'source') {
    if (options.archive !== undefined || options.runtimeSupply !== undefined) fail('WORKSHOP_SOURCE_SUPPLY_UNUSED');
    return;
  }
  if (!required) return;
  if (typeof options.archive !== 'string' || !options.archive) fail('WORKSHOP_ARCHIVE_REQUIRED');
  if (typeof options.runtimeSupply !== 'string' || !options.runtimeSupply) fail('WORKSHOP_RUNTIME_SUPPLY_REQUIRED');
  for (const file of [options.archive, options.runtimeSupply])
    if (!isAbsolute(file) || resolve(file) !== file) fail('WORKSHOP_SUPPLY_PATH_INVALID');
}

// Kept independent of SQLite imports: doctor must diagnose an old Node first.
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || major === 22 && minor >= 13;
}

// Match the bank build path contract, including aliases in existing ancestors.
// Missing ancestors are allowed only for a planned path, never for an input.
export function checkedPath(file, kind = 'file') {
  if (kind !== 'planned') return safePath(file, kind);
  assert.ok(typeof file === 'string' && isAbsolute(file) && resolve(file) === file &&
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) && !file.split('/').includes('.scratch'), 'canonical plain absolute path required');
  let current = '/';
  const parts = file.slice(1).split('/');
  for (const [index, part] of parts.entries()) {
    const matches = readdirSync(current).filter(name => name.normalize('NFC').toLowerCase() === part.normalize('NFC').toLowerCase());
    if (!matches.length && kind === 'planned') return file;
    assert.deepEqual(matches, [part], 'missing path or filesystem alias');
    current = join(current, part);
    const stat = lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), 'symlink path is not admitted');
    assert.ok(index < parts.length - 1 || kind === 'directory' ? stat.isDirectory() : stat.isFile(), 'unexpected path type');
  }
  return file;
}

export function newRunPath(run, root = ROOT, existing = false) {
  assert.ok(typeof run === 'string' && dirname(run) === join(root, 'target'), 'run must be a direct child of bank target/');
  checkedPath(join(root, 'target'), 'directory');
  checkedPath(run, existing ? 'directory' : 'planned');
  if (!existing) assert.ok(!existsSync(run), 'run already exists; choose a new run, never resume or overwrite');
  return run;
}

export function readJson(file) {
  checkedPath(file);
  return captureEvidenceFile(file, { limit: 32 * 1024 * 1024,
    parse: bytes => JSON.parse(bytes.toString('utf8')) }).value;
}

export async function fileReference(file) {
  checkedPath(file);
  return { file, ...fingerprintEvidenceFile(file) };
}

function sourceFiles(root, filter = () => true) {
  checkedPath(root, 'directory');
  return readdirSync(root).sort().flatMap(name => {
    if (name === '__pycache__') return [];
    const file = join(root, name), stat = lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), 'source symlink not admitted');
    if (stat.isDirectory()) return sourceFiles(file, filter);
    assert.ok(stat.isFile(), 'regular source required');
    return filter(file) ? [file] : [];
  });
}

// Fingerprint only declared source/support trees, never .local secrets, old runs,
// host caches or process environments. Public toolEvidence remains authoritative.
export async function captureCurrent({ root = ROOT, tool = TOOL, legacy = false } = {}) {
  assert.ok(nodeSupported(), 'Node >=22.13 required');
  const { treeEvidence, toolEvidence, localPath } = await import(new URL('file://' + tool + '/lib/project/cli.mjs'));
  const project = join(root, 'truthsrc.project.json'), config = readJson(project);
  const tree = localPath(root, config.tree);
  assert.ok(within(join(root, 'truth'), tree), 'current author tree must be within bank truth/');
  const inputs = [project, ...(config.documents ?? []).map(row => localPath(root, row.file))];
  // The adapter is automatically in tools/. The technical lock is explicit source
  // support, not a read of the prepared artifacts. Old v1 uses its original set;
  // all retained signatures still have to match (never re-sign old evidence).
  const support = sourceFiles(join(root, 'tools'), file => /\.(mjs|py|scala)$/.test(file) &&
      (!legacy || file !== join(root, 'tools/truthsrc-acceptance-supply.mjs')))
    .concat(sourceFiles(join(root, 'simulator'), file => /\.mjs$/.test(file)),
      sourceFiles(join(root, 'test/scala')), sourceFiles(join(root, 'test/fixtures')),
      join(root, 'docs/V1-RETIREMENT-MANIFEST.json'), join(root, 'docs/V1-REFERENCE-RELOCATIONS.json'),
      join(root, 'docs/architecture/HANDWRITTEN-SOURCE-MAP.json'),
      ...(legacy ? [] : [join(root, 'docs/RUNTIME-0.3.0-SUPPLY.json')]));
  const references = async files => Promise.all(files.sort().map(fileReference));
  return { project, tree, inputs: await references(inputs), author: treeEvidence(tree), tool: toolEvidence(),
    handwritten: await references(sourceFiles(join(root, 'handwritten/scala'))), support: await references(support) };
}

// Historical v1/P23 reader only. No current verification dispatches preparation
// or silently selects this fixed directory when explicit 0.3.0 supply is absent.
export async function captureSupply(archive, root = ROOT) {
  const input = await fileReference(archive);
  assert.equal(input.sha256, ARCHIVE_SHA256, 'clean1134 archive SHA differs');
  const directory = join(root, '.local/truthsrc-runtime'), receiptFile = join(directory, 'receipt.json');
  const receipt = readJson(receiptFile);
  assert.equal(receipt.schemaVersion, 'bank.truthsrc-runtime/v1');
  assert.equal(receipt.archiveSha256, ARCHIVE_SHA256);
  assert.equal(receipt.runtimeRebuilt, false); assert.equal(receipt.runtimePublished, false);
  assert.equal(receipt.files?.length, 6, 'prepare must verify six pinned JAR/POM members');
  const files = await Promise.all(sourceFiles(directory).map(fileReference));
  assert.equal(files.length, 7, 'unexpected local frozen supply files');
  assert.equal(new Set(receipt.files.map(row => row.file)).size, 6);
  for (const row of receipt.files) {
    const file = resolve(directory, row.file);
    assert.ok(within(directory, file));
    assert.equal(files.find(entry => entry.file === file)?.sha256, row.sha256, 'prepared member changed');
  }
  return { archive: input, files };
}

// Lazy import keeps source/doctor independent of artifact capture and of any
// adapter module initialization. This only reads an already prepared supply.
export async function captureWorkshopSupply(archive, directory, { root = ROOT } = {}) {
  assert.ok(typeof directory === 'string' && directory.length > 0, 'explicit runtime supply required');
  const { captureAcceptanceSupply } = await import('./truthsrc-acceptance-supply.mjs');
  return captureAcceptanceSupply(archive, directory, { root });
}

function runtimeSupplyMetadata(directory, root) {
  checkedPath(directory, 'directory'); checkedPath(join(directory, 'maven'), 'directory');
  checkedPath(join(root, 'tools/truthsrc-acceptance-supply.mjs'));
  const receipt = readJson(join(directory, 'receipt.json'));
  assert.equal(receipt.schemaVersion, 'bank.truthsrc-runtime/v2');
  assert.equal(receipt.version, '0.3.0'); assert.equal(receipt.source, 'maven-central');
  assert.equal(receipt.runtimeRebuilt, false); assert.equal(receipt.files?.length, 6);
  const lock = readJson(join(root, 'docs/RUNTIME-0.3.0-SUPPLY.json'));
  assert.equal(lock.schemaVersion, 'bank.runtime-supply-lock/v1'); assert.equal(lock.version, '0.3.0');
  const selected = readJson(join(root, 'truthsrc.project.json')).options?.runtimeArtifact;
  assert.equal(selected?.coordinate, 'net.imadz:saga-core_2.13:0.3.0');
  assert.equal(selected.sha256, lock.artifacts?.find(row => row.artifactId === 'saga-core_2.13')?.jar?.sha256);
  const repository = selected.repository;
  assert.ok(typeof repository === 'string' && repository.length > 0);
  // Compare local repository identity without traversing, hashing or resolving
  // the JAR/POM members. The acceptance adapter does those checks in verify.
  const selectedPath = repository.startsWith('file:') ? fileURLToPath(repository) : resolve(root, repository);
  assert.equal(pathToFileURL(selectedPath).href.replace(/\/$/, ''), pathToFileURL(join(directory, 'maven')).href);
}

export function leaseMetadata(file, { root = ROOT, run } = {}) {
  checkedPath(file);
  // Metadata preflight only. The runtime's authoritative strict lease admission
  // repeats validation and acquires exclusive owner/port locks before launch.
  const spec = readJson(file);
  assert.deepEqual(Object.keys(spec).sort(), ['schemaVersion', 'owner', 'host', 'ports', 'runRoot'].sort());
  assert.equal(spec.schemaVersion, 'bank.truthsrc-runtime-lease/v1');
  assert.match(spec.owner, /^[a-z][a-z0-9_-]{0,59}$/);
  assert.ok(!spec.owner.startsWith('truthsrc-unification-runtime-'), 'returned historical owner is not a lease');
  assert.equal(spec.host, '127.0.0.1');
  assert.deepEqual(Object.keys(spec.ports).sort(), ['http', 'mongo', 'mysql']);
  const ports = Object.values(spec.ports);
  assert.ok(ports.every(port => Number.isSafeInteger(port) && port > 1024 && port <= 65535 && ![9000, 2551, 3306, 27017].includes(port)));
  assert.equal(new Set(ports).size, 3);
  assert.equal(spec.runRoot, join(root, 'target', 'truthsrc-runtime-' + spec.owner));
  const round = join(root, '.local/mock-ta', basename(spec.runRoot));
  for (const path of [spec.runRoot, round]) { checkedPath(path, 'planned'); assert.ok(!existsSync(path), 'runtime/TA root already exists'); }
  assert.ok(![spec.runRoot, round].some(path => overlap(path, file) || run && overlap(path, run)), 'lease/run/evidence roots must be disjoint');
  const registry = join(root, 'target/truthsrc-runtime-leases');
  for (const name of ['owner-' + spec.owner + '.used.json', 'owner-' + spec.owner + '.lock', ...ports.map(port => 'port-' + port + '.lock')])
    assert.ok(!existsSync(join(registry, name)), 'lease owner already used or resource held; no takeover');
  return { spec, round };
}

// Explicit opt-in, read-only Docker metadata request; no pull/start/stop or config
// lookup. Raw output is discarded, never used in a shareable diagnostic.
async function probeDocker() {
  const executable = '/usr/local/bin/docker';
  const args = ['--config', '/var/empty', '--host', 'unix:///var/run/docker.sock', 'image', 'inspect', '--format', '{{.Id}}',
    'sha256:8eccfc5e5aebbf3a49375b13956a88cd244d13ac6b25b52dec792b7526363b19',
    'sha256:0010f63d26952bd3960fac5513c64a1cf7d6299f31fa7b54ac1b36633ee04333'];
  return new Promise((yes, no) => {
    const child = spawn(executable, args, { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.once('error', error => { clearTimeout(timer); no(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? yes() : no(new Error('Docker/pinned images unavailable')); });
  });
}

export async function doctor(options, { root = ROOT, tool = TOOL, probePorts, probeImages = probeDocker } = {}) {
  validateSupplyOptions(options, { required: false });
  const stages = requestedStages(options.through), checks = [];
  const check = async (id, kind, detail, action) => {
    try { await action(); checks.push({ id, kind, status: 'passed', detail }); }
    catch { checks.push({ id, kind, status: 'blocked', detail }); }
  };
  await check('node', 'metadata', 'Node >=22.13; recommended tested version 22.23.4.', () => assert.ok(nodeSupported()));
  await check('project', 'metadata', 'Current root project and sibling public tool checkout required.', () => {
    const config = readJson(join(root, 'truthsrc.project.json'));
    assert.equal(config.schemaVersion, 'truthsrc.project/v1');
    const tree = resolve(root, config.tree); assert.ok(within(join(root, 'truth'), tree)); checkedPath(tree, 'directory');
    assert.ok(existsSync(join(tree, 'system.yaml')), 'current system declaration required');
    for (const document of config.documents ?? []) checkedPath(resolve(root, document.file));
    for (const name of ['package.json', 'lib/project/cli.mjs']) checkedPath(join(tool, name));
    for (const name of ['lib', 'src', 'generators', 'schema', 'scaffold']) checkedPath(join(tool, name), 'directory');
  });
  if (options.run) await check('run', 'metadata', 'Choose an absent direct child of bank target/; no resume.', () => newRunPath(options.run, root));
  if (stages.includes('anchors')) {
    await check('archive', 'metadata', 'Explicit regular clean1134 archive required. Metadata only; SHA is checked by verify, not doctor.', () => {
      checkedPath(options.archive); assert.ok(lstatSync(options.archive).size > 0);
      if (options.run) assert.ok(!overlap(options.run, options.archive));
    });
    await check('runtime-supply', 'metadata', 'Explicit existing 0.3.0 receipt/maven directory matching the project required. No artifact hashes, preparation or downloads; verify checks the full supply.', () => {
      runtimeSupplyMetadata(options.runtimeSupply, root);
      if (options.run) assert.ok(!overlap(options.run, options.runtimeSupply));
      if (options.archive) assert.ok(!overlap(options.archive, options.runtimeSupply));
    });
    await check('public-verifier', 'metadata', 'Sibling lib/project/verify.mjs required; no bank-only anchor verifier fallback.', () => checkedPath(join(tool, 'lib/project/verify.mjs')));
  }
  if (stages.includes('code')) {
    await check('platform', 'metadata', 'First full-bank target: native Darwin x64. No JVM was launched.', () => assert.ok(process.platform === 'darwin' && process.arch === 'x64'));
    await check('jdk11', 'metadata', 'Explicit installed x64 JDK11 release metadata and java/javac executables required.', () => {
      const home = options.javaHome ?? DEFAULT_JAVA_HOME;
      const release = readFileSync(checkedPath(join(home, 'release')), 'utf8');
      assert.match(release, /^JAVA_VERSION="11(?:\.|\")/m); assert.match(release, /^OS_ARCH="(?:x86_64|amd64)"/m);
      for (const name of ['java', 'javac']) accessSync(checkedPath(join(home, 'bin', name)), constants.X_OK);
    });
    await check('sandbox-python', 'metadata', 'macOS sandbox-exec and Python required; enforcement is not proven by this metadata check.', () => {
      for (const file of ['/usr/bin/python3', '/usr/bin/sandbox-exec']) accessSync(checkedPath(file), constants.X_OK);
    });
  }
  let lease;
  if (stages.includes('service')) {
    await check('lease', 'metadata', 'New explicit lease, disjoint owner-specific runtime evidence and TA roots required.', () => { lease = leaseMetadata(options.lease, { root, run: options.run }); });
    await check('browser', 'metadata', 'Both explicit Playwright module and chrome-headless-shell required; no installation/download.', () => {
      checkedPath(options.browserModule); checkedPath(options.browserExecutable);
      assert.equal(basename(options.browserExecutable), 'chrome-headless-shell'); accessSync(options.browserExecutable, constants.X_OK);
    });
    await check('docker', 'metadata', 'Docker executable and socket metadata only; daemon/images are unprobed unless explicitly requested.', () => {
      accessSync('/usr/local/bin/docker', constants.X_OK); assert.ok(lstatSync(realpathSync('/var/run/docker.sock')).isSocket());
    });
    if (options.probeResources) {
      await check('ports-free-now', 'explicit-resource-probe', 'Temporary IPv4 loopback bind/close only, not a reservation or runtime authorization.', async () => {
        assert.ok(lease);
        const probe = probePorts ?? (await import('./truthsrc-runtime-lease.mjs')).assertRuntimePortFree;
        for (const port of Object.values(lease.spec.ports)) await probe(port);
      });
      await check('pinned-images', 'explicit-resource-probe', 'Bounded Docker image inspect only; never starts Docker or pulls images.', probeImages);
    } else checks.push({ id: 'resources', kind: 'explicit-resource-probe', status: 'not-run', detail: 'Ports/daemon/images not probed. Use doctor --probe-resources; runtime checks again under lease.' });
  }
  return { schemaVersion: 'bank.workshop-doctor/v1', through: options.through, passed: checks.every(row => row.status !== 'blocked'),
    metadataOnly: !options.probeResources, checks, servicesStarted: false, jvmStarted: false,
    deliveryReady: false, limitations: ['Metadata readiness is not build/service acceptance.', 'Archive delivery channel and independent newcomer acceptance remain unverified.'] };
}
