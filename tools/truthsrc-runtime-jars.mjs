import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_JARS = 4096, MAX_REFERENCES = 4096, MAX_PATH_BYTES = 4096;
const MAX_JAR_BYTES = 512 * 1024 * 1024;
const SCHEMA = 'bank.truthsrc-runtime-jars/v1';
const SHA256 = /^[0-9a-f]{64}$/;
// These are absent unversioned siblings in the pinned Maven supply, NOT a
// blanket permission for missing dependencies or for extra present supply JARs.
const ABSENT_SIBLINGS = new Map([
  ['org/scala-lang/scala-compiler/2.12.12/scala-compiler-2.12.12.jar', ['scala-reflect.jar', 'scala-library.jar']],
  ['org/scala-lang/scala-compiler/2.13.14/scala-compiler-2.13.14.jar', ['scala-reflect.jar', 'scala-library.jar']],
  ['xalan/serializer/2.7.2/serializer-2.7.2.jar', ['xml-apis.jar']],
  ['xalan/xalan/2.7.2/xalan-2.7.2.jar', ['xercesImpl.jar', 'xml-apis.jar', 'serializer.jar']],
]);
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.nlink];
const keys = (value, expected) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'record required');
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'unexpected record fields');
};

function canonicalPath(file) {
  assert.ok(typeof file === 'string' && Buffer.byteLength(file) <= MAX_PATH_BYTES &&
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) && resolve(file) === file,
  'canonical plain absolute path required: ' + file);
}

// Do not use existsSync: dangling links, ENOTDIR and access errors are not absence.
function inspectPath(file) {
  canonicalPath(file);
  let current = '/', stat;
  const parts = file.slice(1).split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try { stat = lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    assert.ok(!stat.isSymbolicLink(), 'symlink path forbidden: ' + current);
    assert.equal(realpathSync(current), current, 'filesystem alias forbidden: ' + current);
    if (index < parts.length - 1) assert.ok(stat.isDirectory(), 'non-directory ancestor: ' + current);
  }
  return stat;
}

function jarStat(file, safePath) {
  const stat = inspectPath(file);
  assert.ok(stat?.isFile() && stat.nlink === 1 && stat.size <= MAX_JAR_BYTES,
    'bounded regular non-hardlinked JAR required: ' + file);
  if (safePath) safePath(file, 'file');
  return stat;
}

function fileDigest(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= MAX_JAR_BYTES, 'bounded regular JAR required');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
    let count, bytes = 0;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += count;
      assert.ok(bytes <= MAX_JAR_BYTES, 'JAR grew beyond byte limit');
      hash.update(buffer.subarray(0, count));
    }
    assert.equal(bytes, stat.size, 'JAR size changed while hashing');
    assert.deepEqual(identity(fstatSync(fd)), identity(stat), 'JAR changed while hashing');
    return hash.digest('hex');
  } finally { closeSync(fd); }
}

function referencePath(sourceJar, token) {
  // Intentionally admit only a small relative-URL subset. Percent escapes,
  // schemes, authority, queries/fragments, backslashes and directory URLs fail.
  assert.ok(typeof token === 'string' && Buffer.byteLength(token) <= MAX_PATH_BYTES &&
    /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.jar$/.test(token) &&
    !token.split('/').some(part => part === '.' || part === '..'),
  'unsafe Class-Path token: ' + token);
  const url = new URL(token, pathToFileURL(sourceJar));
  assert.ok(url.protocol === 'file:' && !url.host && !url.search && !url.hash, 'local file URL required');
  const resolved = fileURLToPath(url);
  assert.ok(resolved.startsWith(dirname(sourceJar) + '/'), 'Class-Path escaped source directory');
  canonicalPath(resolved);
  return resolved;
}

function knownAbsent(sourceJar, token) {
  return [...ABSENT_SIBLINGS].some(([coordinate, siblings]) =>
    sourceJar.endsWith('/supply/maven/' + coordinate) && siblings.includes(token));
}

/**
 * Consume an ALREADY source/supply-admitted ordered classpath (including class
 * directories) and the sandbox probe's JSON array. Only .jar entries are probed.
 * No roots are discovered or admitted here; references cannot escape the source
 * JAR's directory, which is stricter than staying within its supply subtree.
 * Each listed JAR is hashed once per call. Helpers are optional trusted hooks;
 * core path/link checks still run. Throws on any mismatch, never returns partial
 * success. Caller must bind probe controls/output and pre/post supply inventories.
 */
export function validateJarReferences(classpath, probeRecords, helpers = {}) {
  assert.ok(Array.isArray(classpath) && classpath.length <= MAX_JARS, 'bounded classpath array required');
  for (const file of classpath) canonicalPath(file);
  assert.equal(new Set(classpath).size, classpath.length, 'duplicate classpath entry');
  const jars = classpath.filter(file => file.endsWith('.jar'));
  assert.ok(Buffer.byteLength(JSON.stringify(jars)) <= 1024 * 1024, 'JAR list exceeds probe input bound');
  assert.ok(Array.isArray(probeRecords) && probeRecords.length === jars.length, 'exact ordered JAR probe list required');
  let referencesCount = 0;
  for (const [index, row] of probeRecords.entries()) {
    keys(row, ['file', 'sha256', 'classPath']);
    assert.equal(row.file, jars[index], 'exact ordered JAR probe list required');
    assert.ok(typeof row.sha256 === 'string' && SHA256.test(row.sha256), 'SHA-256 required');
    assert.ok(Array.isArray(row.classPath), 'Class-Path token array required');
    referencesCount += row.classPath.length;
    assert.ok(referencesCount <= MAX_REFERENCES, 'too many Class-Path references');
    assert.equal(new Set(row.classPath).size, row.classPath.length, 'duplicate Class-Path token');
    row.classPath.forEach(token => referencePath(row.file, token));
  }
  const digest = helpers.fileDigest ?? fileDigest, hashes = new Map();
  assert.equal(typeof digest, 'function');
  if (helpers.safePath !== undefined) assert.equal(typeof helpers.safePath, 'function');
  for (const row of probeRecords) {
    const before = jarStat(row.file, helpers.safePath);
    const sha256 = digest(row.file);
    assert.deepEqual(identity(jarStat(row.file, helpers.safePath)), identity(before), 'JAR changed during validation');
    assert.equal(sha256, row.sha256, 'JAR SHA-256 differs from probe: ' + row.file);
    hashes.set(row.file, sha256);
  }
  const references = [];
  for (const row of probeRecords) for (const token of row.classPath) {
    const resolved = referencePath(row.file, token), stat = inspectPath(resolved), exists = stat !== null;
    if (exists) {
      assert.ok(hashes.has(resolved), 'present Class-Path target is not explicitly listed: ' + resolved);
      jarStat(resolved, helpers.safePath);
    } else {
      assert.ok(knownAbsent(row.file, token), 'unlisted Class-Path target is not a pinned absent sibling: ' + resolved);
      if (helpers.safePath) helpers.safePath(resolved, 'new');
    }
    references.push({ sourceJar: row.file, token, resolved, exists, sha256: exists ? hashes.get(resolved) : null });
  }
  const report = { schemaVersion: SCHEMA,
    jars: probeRecords.map(row => ({ file: row.file, sha256: row.sha256, classPath: [...row.classPath] })), references };
  // Keep the in-process seal immutable; a JSON roundtrip is also accepted for recheck.
  for (const row of report.jars) { Object.freeze(row.classPath); Object.freeze(row); }
  report.references.forEach(Object.freeze);
  Object.freeze(report.jars); Object.freeze(report.references);
  return Object.freeze(report);
}

/** Rehash all present JARs and recheck exact absence immediately before runtime. */
export function assertJarReferencesUnchanged(report, helpers = {}) {
  keys(report, ['schemaVersion', 'jars', 'references']);
  assert.equal(report.schemaVersion, SCHEMA, 'unsupported JAR reference report');
  assert.ok(Array.isArray(report.jars) && Array.isArray(report.references), 'JAR reference report arrays required');
  const current = validateJarReferences(report.jars.map(row => row.file), report.jars, helpers);
  assert.deepEqual(current, report, 'JAR references changed since probe');
  return current;
}

/**
 * Run as python3 -I -S <owned-script> <owned-json-list> under the caller's OS
 * sandbox with a timeout and bounded stdout. Input is the ordered absolute .jar
 * list, NOT a directory or classpath discovery request. Output is one JSON array
 * of {file, sha256, classPath}. Stdlib ZIP inspection only: no extraction, import
 * from JARs, classloading, subprocesses, network or writes. Maximum stdout 8 MiB.
 */
export const jarManifestProbeSource = String.raw`import hashlib, json, os, re, stat, sys, zipfile

MAX_JAR = 512 * 1024 * 1024
MAX_MANIFEST = 1024 * 1024
MAX_JSON = 1024 * 1024
MAX_REFERENCES = 4096
MANIFEST = 'META-INF/MANIFEST.MF'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def safe_file(file):
    require(isinstance(file, str) and len(file.encode('utf-8')) <= 4096 and
            re.fullmatch(r'/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+', file) and
            os.path.normpath(file) == file, 'canonical plain absolute path required')
    current = '/'
    parts = file[1:].split('/')
    for i, part in enumerate(parts):
        current = os.path.join(current, part)
        s = os.lstat(current)
        require(not stat.S_ISLNK(s.st_mode), 'symlink path forbidden')
        require(os.path.realpath(current) == current, 'filesystem alias forbidden')
        require(stat.S_ISREG(s.st_mode) if i == len(parts) - 1 else stat.S_ISDIR(s.st_mode), 'unexpected path type')
    require(s.st_nlink == 1, 'hardlinked input forbidden')
    return s


def identity(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)


def class_path(raw):
    require(len(raw) <= MAX_MANIFEST, 'manifest exceeds 1 MiB')
    require(not raw or raw.endswith((b'\r', b'\n')), 'unterminated manifest line')
    # Unfold BYTES before UTF-8 decoding: a continuation may split a codepoint.
    lines = re.split(br'\r\n|\n|\r', raw)
    logical = []
    for line in lines:
        if line.startswith(b' '):
            require(logical and logical[-1] != b'', 'orphan manifest continuation')
            logical[-1].extend(line[1:])
        else:
            logical.append(bytearray(line))
    main = True
    found = False
    result = []
    for line in logical:
        if not line:
            main = False
            continue
        text = line.decode('utf-8', errors='strict')
        require(not any(ord(c) < 32 or ord(c) == 127 for c in text), 'manifest control character')
        match = re.fullmatch(r'([A-Za-z0-9_-]{1,70}): (.*)', text)
        require(match is not None, 'malformed manifest header')
        if main and match.group(1).lower() == 'class-path':
            require(not found, 'duplicate main Class-Path header')
            found = True
            # The manifest specification separates URLs with ASCII spaces.
            result = [token for token in match.group(2).split(' ') if token]
            require(len(result) <= MAX_REFERENCES and len(set(result)) == len(result), 'too many or duplicate Class-Path tokens')
            require(all(len(token.encode('utf-8')) <= 4096 for token in result), 'Class-Path token too long')
    return result


def probe(file):
    require(file.endswith('.jar'), 'only explicit .jar files may be probed')
    before = safe_file(file)
    require(before.st_size <= MAX_JAR, 'JAR exceeds byte limit')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        require(identity(os.fstat(source.fileno())) == identity(before), 'JAR replaced before probe')
        digest = hashlib.sha256()
        size = 0
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            size += len(block)
            require(size <= MAX_JAR, 'JAR exceeds byte limit')
            digest.update(block)
        require(size == before.st_size, 'JAR size changed')
        source.seek(0)
        with zipfile.ZipFile(source, 'r') as archive:
            entries = archive.infolist()
            require(len(entries) <= 100000, 'too many ZIP entries')
            manifests = [entry for entry in entries if entry.filename.upper() == MANIFEST]
            require(len(manifests) <= 1, 'duplicate or ambiguous manifest entry')
            tokens = []
            if manifests:
                entry = manifests[0]
                require(entry.filename == MANIFEST and entry.orig_filename == MANIFEST, 'noncanonical manifest entry')
                require(entry.file_size <= MAX_MANIFEST and entry.compress_size <= MAX_MANIFEST, 'manifest exceeds 1 MiB')
                require(not entry.flag_bits & 1 and not entry.is_dir(), 'unsupported manifest entry')
                require(entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'unsupported manifest compression')
                with archive.open(entry, 'r') as manifest:
                    raw = manifest.read(MAX_MANIFEST + 1)
                require(len(raw) == entry.file_size, 'manifest size mismatch')
                tokens = class_path(raw)
        require(identity(os.fstat(source.fileno())) == identity(before), 'JAR changed during probe')
    require(identity(safe_file(file)) == identity(before), 'JAR path changed during probe')
    return {'file': file, 'sha256': digest.hexdigest(), 'classPath': tokens}


def main():
    require(len(sys.argv) == 2, 'usage: probe.py jars.json')
    input_file = sys.argv[1]
    require(safe_file(input_file).st_size <= MAX_JSON, 'JAR list too large')
    with open(input_file, 'rb') as source:
        raw = source.read(MAX_JSON + 1)
    require(len(raw) <= MAX_JSON, 'JAR list too large')
    files = json.loads(raw.decode('utf-8', errors='strict'))
    require(isinstance(files, list) and len(files) <= 4096 and all(isinstance(f, str) for f in files), 'ordered JAR list required')
    require(len(set(files)) == len(files), 'duplicate JAR input')
    records = []
    references = 0
    for file in files:
        record = probe(file)
        references += len(record['classPath'])
        require(references <= MAX_REFERENCES, 'too many Class-Path references')
        records.append(record)
    output = json.dumps(records, ensure_ascii=True, separators=(',', ':'))
    require(len(output) < 8 * 1024 * 1024, 'probe output too large')
    print(output)


if __name__ == '__main__':
    main()
`;
