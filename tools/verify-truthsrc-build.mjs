import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, readlinkSync, readSync, realpathSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Deliberately independent of the historical release/cold-build drivers.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = resolve(ROOT, '../metarch-truthsrc');
const PROJECT = join(ROOT, 'truthsrc.project.json');
const HANDWRITTEN = join(ROOT, 'v1/handwritten/scala');
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
const usage = `Usage: node tools/verify-truthsrc-build.mjs \\
  --project-output <absolute-fresh-generated-root> \\
  --archive <absolute-clean-1134.tar.gz> --evidence <absolute-new-evidence-root> \\
  [--java-home <absolute-JDK11-home>] [--compile-generated-tests]

Output must be under this bank's generated/ or target/; evidence under target/.
Parents must exist. No symlinks, path aliases, spaces, or .scratch paths.
Default: compile the service and original handwritten Scala. The optional flag
also compiles ONLY generated test sources; neither mode executes tests/services.
Each attempt needs a fresh candidate and a new evidence directory. No cleanup,
network resolution, runtime rebuild/publish, or historical acceptance runner.`;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const flags = new Map();
  let compileTests = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--compile-generated-tests' && !compileTests) { compileTests = true; continue; }
    assert.ok(['--project-output', '--archive', '--evidence', '--java-home'].includes(flag) &&
      !flags.has(flag) && args[i + 1] && !args[i + 1].startsWith('--'), usage);
    flags.set(flag, args[++i]);
  }
  for (const flag of ['--project-output', '--archive', '--evidence']) assert.ok(flags.has(flag), usage);
  return { output: flags.get('--project-output'), archive: flags.get('--archive'),
    evidence: flags.get('--evidence'), javaHome: flags.get('--java-home') ?? DEFAULT_JAVA_HOME, compileTests };
}

function safePath(file, kind = 'directory') {
  assert.ok(typeof file === 'string' && isAbsolute(file) && resolve(file) === file &&
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file), 'canonical plain absolute path required: ' + file);
  assert.ok(!file.split('/').some(part => ['.', '..', '.scratch'].includes(part)), 'forbidden path component: ' + file);
  let current = '/';
  const parts = file.slice(1).split('/');
  for (const [i, part] of parts.entries()) {
    const matches = readdirSync(current).filter(name => fold(name) === fold(part));
    const leaf = i === parts.length - 1;
    if (leaf && kind === 'new') {
      assert.equal(matches.length, 0, 'destination already exists or aliases another path: ' + file);
      return file;
    }
    assert.deepEqual(matches, [part], 'missing path or filesystem alias: ' + join(current, part));
    current = join(current, part);
    const stat = lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), 'symlink path forbidden: ' + current);
    assert.ok(leaf && kind === 'file' ? stat.isFile() : stat.isDirectory(), 'unexpected path type: ' + current);
  }
  return file;
}

function fileDigest(file) {
  const fd = openSync(file, 'r');
  try {
    const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, bytes));
    return digest.digest('hex');
  } finally { closeSync(fd); }
}

async function archiveDigest(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) { notCancelled(); digest.update(bytes); }
  return digest.digest('hex');
}

function inventory(root, { afterBuild = false } = {}) {
  safePath(root);
  const files = {};
  function visit(dir) {
    const names = readdirSync(dir).sort();
    assert.equal(new Set(names.map(fold)).size, names.length, 'case/unicode aliases in ' + dir);
    for (const name of names) {
      assert.ok(!/[\\\x00-\x1f\x7f]/.test(name), 'unsafe inventory name');
      const file = join(dir, name), key = relative(root, file), stat = lstatSync(file);
      assert.ok(!stat.isSymbolicLink(), 'symlink in inventory: ' + file);
      if (ARTIFACT_DIRS.includes(key) && root !== HANDWRITTEN && afterBuild) {
        assert.ok(stat.isDirectory(), 'artifact directory replaced: ' + file);
        continue;
      }
      if (stat.isDirectory()) visit(file);
      else {
        assert.ok(stat.isFile() && stat.nlink === 1, 'regular, non-hardlinked input required: ' + file);
        files[key] = { bytes: stat.size, sha256: fileDigest(file) };
      }
    }
  }
  visit(root);
  return files;
}

function assertFreshOutput(output) {
  for (const directory of ARTIFACT_DIRS) {
    try { lstatSync(join(output, directory)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('fresh output required; preexisting build artifacts: ' + directory);
  }
}

// Only this fixed, local JS implementation is loaded. Never import from the
// candidate, its ledger, an archive member, or a caller-selected generator.
async function admitCandidate(output) {
  safePath(TOOL);
  safePath(PROJECT, 'file');
  safePath(HANDWRITTEN);
  safePath(RUNTIME);
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
  assert.equal(captured.config.options.runtimeArtifact.repository, pathToFileURL(join(RUNTIME, 'maven')).href + '/');
  assert.ok(!overlap(output, HANDWRITTEN) && !overlap(output, TOOL) && !overlap(output, RUNTIME));
  const plan = projectPlan(captured, output); // In-memory plan; NEVER applyEntries/projectCli(generate).
  assert.equal(plan.generator.id, GENERATOR);
  assert.equal(plan.generator.version, '1');
  const before = inventory(output);
  const ledger = parseStrictJson(readFileSync(join(output, 'truthsrc.ledger.json')));
  const anchors = readAnchorsIndex(parseStrictJson(readFileSync(join(output, 'anchors.json'))));
  assert.equal(ledger.generator, GENERATOR);
  assert.ok(Array.isArray(ledger.entries));
  const rows = new Map(ledger.entries.map(row => [row.path, row]));
  assert.equal(rows.size, ledger.entries.length, 'duplicate ownership ledger paths');
  assert.equal(rows.size, plan.entries.length, 'retained/missing/foreign ledger entries forbidden');
  assert.deepEqual(Object.keys(before).sort(), [...plan.entries.map(entry => entry.path), 'truthsrc.ledger.json', 'anchors.json'].sort(),
    'candidate contains missing or unplanned files (including build scripts and old tests)');
  const inputs = parseStrictJson(readFileSync(join(output, '.truthsrc/inputs.json')));
  const plannedInputs = JSON.parse(plan.entries.find(entry => entry.path === '.truthsrc/inputs.json').content);
  for (const key of ['sources', 'sourceIndex', 'generatedFiles', 'canonicalId'])
    assert.deepEqual(inputs[key], plannedInputs[key], 'current generation input differs: ' + key);
  assert.equal(inputs.validation?.hard?.length, 0, 'generation validation evidence required');
  assert.equal(inputs.validation?.roundtrip?.ok, true, 'successful generation roundtrip evidence required');
  const associations = entry => [...new Set([...(entry.knowledgeIds ?? []), ...(entry.noteIds ?? [])])].sort();
  const expectedAnchors = new Map();
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
    for (const key of associations(entry)) {
      if (!expectedAnchors.has(key)) expectedAnchors.set(key, []);
      expectedAnchors.get(key).push(entry.path);
    }
  }
  assert.deepEqual(Object.keys(anchors.anchors).sort(), [...expectedAnchors.keys()].sort(), 'anchor membership differs');
  for (const [key, files] of expectedAnchors) {
    const locations = anchors.anchors[key];
    assert.deepEqual(locations.map(loc => loc.file).sort(), files.sort(), 'anchor file associations differ');
    for (const loc of locations) {
      assert.equal(loc.repo, output, 'copied/foreign anchor repository');
      assert.equal(loc.generator, GENERATOR);
      assert.equal(loc.generatorVersion, plan.generator.version);
      assert.equal(loc.status, 'source-verified');
      assert.equal(loc.verification.fileVerified, true);
      assert.equal(loc.fingerprint, rows.get(loc.file).ownership.fingerprint);
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
  const handwritten = inventory(HANDWRITTEN), runtime = inventory(RUNTIME);
  assert.ok(Object.keys(handwritten).some(file => file.endsWith('.scala')), 'empty handwritten Scala tree');
  assertUnchanged(captured);
  return { before, handwritten, runtime, captured, assertUnchanged, testFiles, generator: plan.generator };
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

function prepareSandbox(evidence, output) {
  // Existing ancestors are checked for symlinks/aliases by safePath; subpaths use
  // canonical kernel paths, never a lexical allowlist in a replaceable JVM guard.
  for (const root of [evidence, output]) assert.equal(realpathSync(safePath(root)), root);
  safePath(SANDBOX, 'file');
  const subpaths = [evidence, ...ARTIFACT_DIRS.map(dir => join(output, dir))];
  assert.equal(realpathSync('/dev/null'), '/dev/null');
  assert.ok(lstatSync('/dev/null').isCharacterDevice(), 'expected /dev/null device');
  // Python subprocess DEVNULL opens O_RDWR (observed EPERM without this literal).
  // Never allow /dev as a subtree, nor any other external filesystem location.
  const literals = [join(output, 'project/project'), '/dev/null'];
  const profile = join(evidence, 'sandbox.sb');
  const text = '(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write*\n' +
    subpaths.map(path => '  (subpath ' + JSON.stringify(path) + ')').join('\n') + '\n' +
    literals.map(path => '  (literal ' + JSON.stringify(path) + ')').join('\n') + ')\n';
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
  const controlFiles = [profile, join(boundary, 'probe.py'), join(boundary, 'TruthsrcSandboxProbe.java')];
  const controlsBefore = Object.fromEntries(controlFiles.map(file => [file, fileDigest(file)]));
  const sandbox = { executable: SANDBOX, profile, profileSha256: hash(text), subpaths, literals,
    network: 'deny network* (unconditional)', defaultFileWrites: 'deny file-write*', deviceWriteExceptions: ['/dev/null'],
    canaries, canariesBefore, escape, controlsBefore };
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
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function signalGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function command(executable, args, cwd, env, base, timeoutMs, sandbox) {
  notCancelled();
  // Mandatory wrapper: extraction, javac, probes, sbt and every exec descendant
  // have the same OS boundary. No unsandboxed or Java-only fallback exists.
  assert.equal(sandbox?.executable, SANDBOX, 'OS sandbox required');
  safePath(sandbox.profile, 'file');
  assert.equal(fileDigest(sandbox.profile), sandbox.profileSha256, 'sandbox profile changed before launch');
  const invocation = [SANDBOX, '-f', sandbox.profile, executable, ...args];
  const descriptors = [];
  let timer, killer, child, launchError = null, timedOut = false, termAt = null;
  const started = Date.now();
  try {
    for (const suffix of ['.stdout.log', '.stderr.log', '.json']) descriptors.push(openSync(base + suffix, 'wx', 0o600));
    const stop = () => {
      if (termAt !== null) return;
      termAt = Date.now();
      signalGroup(child?.pid, 'SIGTERM');
      killer = setTimeout(() => signalGroup(child?.pid, 'SIGKILL'), GRACE_MS);
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
      signalGroup(child.pid, 'SIGKILL');
      const until = Date.now() + REAP_POLL_MS;
      while (groupAlive(child.pid) && Date.now() < until) await delay(100);
    }
    clearTimeout(killer);
    const receipt = { command: invocation, sandboxProfileSha256: sandbox.profileSha256, cwd, pid: child?.pid ?? null,
      startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, timeoutMs, graceMs: GRACE_MS,
      code, signal, launchError, timedOut, cancelled, directChildClosed: closed,
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
function succeeded(receipt) {
  assert.ok(receipt.code === 0 && !receipt.signal && !receipt.launchError && !receipt.timedOut && !receipt.cancelled &&
    receipt.directChildReaped && !receipt.leftoverGroup && !receipt.groupAliveAfter, 'command failed; inspect its exclusive receipt and logs');
}

async function verify(options) {
  const { output, archive, evidence, javaHome, compileTests } = options;
  assert.equal(process.platform, 'darwin', 'this captured toolchain is for Darwin, not a portable supply');
  safePath(output); safePath(archive, 'file'); safePath(evidence, 'new'); safePath(javaHome);
  assert.ok([join(ROOT, 'generated'), join(ROOT, 'target')].some(root => within(root, output) && output !== join(ROOT, 'target')),
    'generated output must be inside this bank generated/ or target/');
  assert.ok(within(join(ROOT, 'target'), evidence) && evidence !== join(ROOT, 'target'), 'new evidence must be under bank target/');
  assert.ok(!overlap(output, evidence) && !overlap(archive, evidence) && !overlap(output, archive), 'input/evidence paths overlap');
  assertFreshOutput(output);
  const java = safePath(join(javaHome, 'bin/java'), 'file'), javac = safePath(join(javaHome, 'bin/javac'), 'file');
  safePath(PYTHON, 'file'); safePath(SANDBOX, 'file'); safePath(join(javaHome, 'release'), 'file');
  const release = readFileSync(join(javaHome, 'release'), 'utf8');
  assert.match(release, /^JAVA_VERSION="11(?:\.|\")/m, 'explicit JDK11 required');
  assert.match(release, /^OS_ARCH="(?:x86_64|amd64)"/m, 'clean archive contains Darwin x86_64 protoc; x64 JDK/Rosetta required');
  mkdirSync(evidence, { mode: 0o700 }); // exclusive: no recursive parent creation or reuse
  const result = { schemaVersion: 'bank.truthsrc-build/v1', status: 'blocked', output, evidence,
    archive: { file: archive, expectedSha256: ARCHIVE_SHA }, javaHome, compileGeneratedTests: compileTests,
    testsExecuted: false, servicesStarted: false, runtimeRebuilt: false, runtimePublished: false,
    release1134Resigned: false, runtimeRetryBackoffDeadline: 'OPEN', phases: {}, checks: {}, errors: [],
    scope: 'current JS-generated bank service plus original handwritten Scala compilation; optional generated-test compilation only; not runtime or 1134 acceptance' };
  let admitted, supplyBefore, sandbox, cachesBefore;
  const phases = result.phases;
  try {
    for (const name of CACHE_DIRS) mkdirSync(join(evidence, name), { mode: 0o700 });
    cachesBefore = Object.fromEntries(CACHE_DIRS.map(name => [name, inventory(join(evidence, name))]));
    const initiallyEmpty = Object.fromEntries(CACHE_DIRS.map(name => [name, Object.keys(cachesBefore[name]).length === 0]));
    save(join(evidence, 'cache-before.json'), cachesBefore);
    admitted = await admitCandidate(output);
    notCancelled();
    save(join(evidence, 'sources-before.json'), { output: admitted.before, handwritten: admitted.handwritten, localRuntime: admitted.runtime });
    result.archive.sha256 = await archiveDigest(archive);
    assert.equal(result.archive.sha256, ARCHIVE_SHA, 'clean 1134 archive SHA differs; no extraction');
    const env = { HOME: join(evidence, 'home'), USERPROFILE: join(evidence, 'home'), JAVA_HOME: javaHome,
      PATH: join(javaHome, 'bin') + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: join(evidence, 'tmp'),
      XDG_CACHE_HOME: join(evidence, 'cache'), XDG_CONFIG_HOME: join(evidence, 'home/.config'), XDG_DATA_HOME: join(evidence, 'home/.local/share'),
      COURSIER_CACHE: join(evidence, 'coursier'), COURSIER_JVM_CACHE: join(evidence, 'cache/jvm'), COURSIER_ARCHIVE_CACHE: join(evidence, 'cache/archives') };
    const supply = join(evidence, 'supply'), repositories = repositoryText(supply);
    env.COURSIER_REPOSITORIES = repositories.maven + '|ivy:' + repositories.ivy + repositories.pattern;
    save(join(evidence, 'input.json'), { ...options, project: PROJECT, handwrittenRoot: HANDWRITTEN, toolRoot: TOOL,
      generator: admitted.generator, sources: admitted.captured.sources, archiveSha256: ARCHIVE_SHA,
      toolchain: Object.fromEntries([java, javac, join(javaHome, 'release'), PYTHON, SANDBOX].map(file => [file, fileDigest(file)])),
      initiallyEmpty, compilerBridgePrefill: false, inheritedEnvironment: false, env, testFiles: compileTests ? admitted.testFiles : [] });
    sandbox = prepareSandbox(evidence, output);
    await probeSandbox(sandbox, java, javac, output, evidence, env, phases);
    result.checks.osSandboxEnforced = true;
    write(join(evidence, 'extract-supply.py'), extractSource);
    phases.extract = await command(PYTHON, ['-I', '-S', join(evidence, 'extract-supply.py'), archive, supply, ARCHIVE_SHA],
      evidence, env, join(evidence, 'extract'), 480_000, sandbox);
    succeeded(phases.extract);
    const extracted = JSON.parse(readFileSync(join(evidence, 'extract.stdout.log'), 'utf8'));
    assert.equal(extracted.archiveSha256, ARCHIVE_SHA);
    assert.deepEqual(extracted.counts, { maven: 1048, ivy: 16, launcher: 1 });
    supplyBefore = inventory(supply);
    assert.deepEqual(supplyBefore, extracted.files);
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
    const quoted = value => JSON.stringify(value);
    const tasks = [
      'set Test / unmanagedSourceDirectories := Seq(baseDirectory.value / "src" / "test" / "scala")',
      'set Test / unmanagedSources := Seq(' + admitted.testFiles.map(file => 'baseDirectory.value / ' + quoted(file)).join(', ') + ')',
      'set Test / unmanagedResourceDirectories := Seq(baseDirectory.value / "src" / "test" / "resources")',
      'show externalResolvers', 'show csrCacheDirectory', 'compile', 'show Compile / fullClasspath',
      ...(compileTests ? ['Test / compile'] : []),
    ];
    save(join(evidence, 'build-plan.json'), { javaOptions, tasks, env: buildEnv,
      sandbox: { profile: sandbox.profile, sha256: sandbox.profileSha256, subpaths: sandbox.subpaths, literals: sandbox.literals },
      allowedAppArtifactDirectories: ARTIFACT_DIRS, historicalTestSourcesAppended: false, testExecutionSupported: false });
    checkSandbox(sandbox);
    assert.deepEqual(inventory(supply), supplyBefore, 'supply changed before build');
    admitted.assertUnchanged(admitted.captured);
    assert.deepEqual(inventory(output), admitted.before, 'candidate changed before build');
    assert.deepEqual(inventory(HANDWRITTEN), admitted.handwritten, 'handwritten input changed before build');
    assert.deepEqual(inventory(RUNTIME), admitted.runtime, 'local runtime changed before build');
    notCancelled();
    // Cooperative output claim within the only allowed app-write territory.
    // Never remove another invocation's claim or clean/reuse old build outputs.
    assertFreshOutput(output);
    mkdirSync(join(output, 'target'));
    save(join(output, 'target/truthsrc-build-owner.json'), { evidence, pid: process.pid, project: PROJECT });
    phases.build = await command(java, ['-Xmx2G', '-XX:ActiveProcessorCount=2', ...javaOptions,
      '-cp', join(supply, 'launcher/sbt-launch.jar'), 'xsbt.boot.Boot', ...tasks],
      output, buildEnv, join(evidence, 'build'), 480_000, sandbox);
    succeeded(phases.build);
  } catch (error) { result.errors.push(error.message); }
  finally {
    // Reconcile even on compiler failure, timeout or cancellation. Detection is
    // not rollback and does not make concurrent directory replacement atomic.
    if (admitted) {
      const after = {};
      for (const [name, root, before, opts] of [
        ['output', output, admitted.before, { afterBuild: true }],
        ['handwritten', HANDWRITTEN, admitted.handwritten, {}], ['localRuntime', RUNTIME, admitted.runtime, {}],
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
    result.cancelled = cancelled;
    if (cancelled) result.errors.push('cancelled: ' + cancelled);
    result.status = result.errors.length === 0 && result.checks.osSandboxEnforced && phases.build?.code === 0 ? 'passed' : 'blocked';
    save(join(evidence, 'result.json'), result);
  }
  console.log(json({ status: result.status, evidence, receipt: join(evidence, 'result.json'), testsExecuted: false }));
  if (result.status !== 'passed') process.exitCode = cancelled === 'SIGINT' ? 130 : cancelled === 'SIGTERM' ? 143 : 2;
}

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
