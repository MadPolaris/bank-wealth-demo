import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertJarReferencesUnchanged, jarManifestProbeSource, validateJarReferences } from '../tools/truthsrc-runtime-jars.mjs';

const COMPILER = 'org/scala-lang/scala-compiler/2.13.14/scala-compiler-2.13.14.jar';
const PINNED = [
  ['org/scala-lang/scala-compiler/2.12.12/scala-compiler-2.12.12.jar', ['scala-reflect.jar', 'scala-library.jar']],
  [COMPILER, ['scala-reflect.jar', 'scala-library.jar']],
  ['xalan/serializer/2.7.2/serializer-2.7.2.jar', ['xml-apis.jar']],
  ['xalan/xalan/2.7.2/xalan-2.7.2.jar', ['xercesImpl.jar', 'xml-apis.jar', 'serializer.jar']],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = (file, classPath = []) => ({ file, sha256: hash(readFileSync(file)), classPath });

function fixture() {
  // Only fresh test-owned paths. No historical supply or service data is opened/deleted.
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'truthsrc-runtime-jars-'));
  const classes = join(root, 'classes'); mkdirSync(classes);
  const put = (relative, bytes = 'synthetic bytes for JS probe-validation tests') => {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, { flag: 'wx' });
    return file;
  };
  const jar = (coordinate, bytes) => put('supply/maven/' + coordinate, bytes);
  return { root, classes, put, jar };
}

function compilerFixture(tokens = ['scala-reflect.jar', 'scala-library.jar']) {
  const f = fixture(), source = f.jar(COMPILER);
  const classpath = [f.classes, source], records = [record(source, tokens)];
  return { ...f, source, classpath, records, capture: () => validateJarReferences(classpath, records) };
}

test('all four pinned Maven headers inventory their exact absent siblings', () => {
  const f = fixture(), records = PINNED.map(([coordinate, tokens]) => record(f.jar(coordinate), tokens));
  const report = validateJarReferences([f.classes, ...records.map(row => row.file)], records);
  assert.equal(report.schemaVersion, 'bank.truthsrc-runtime-jars/v1');
  assert.equal(report.jars.length, 4); assert.equal(report.references.length, 8);
  assert.deepEqual(report.references, records.flatMap(row => row.classPath.map(token => ({
    sourceJar: row.file, token, resolved: join(dirname(row.file), token), exists: false, sha256: null,
  }))));
  assert.deepEqual(assertJarReferencesUnchanged(JSON.parse(JSON.stringify(report))), report);
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.jars[0].classPath) && Object.isFrozen(report.references[0]));
});

test('explicit listed present sibling/descendant targets are hashed once, without following a new closure', () => {
  const f = fixture(), source = f.jar('example/main.jar'), second = f.jar('example/second.jar');
  const dep = f.jar('example/deps/library.jar'), self = 'main.jar';
  const records = [record(source, ['deps/library.jar', self]), record(second, ['deps/library.jar']), record(dep)];
  const classpath = [f.classes, ...records.map(row => row.file)];
  const calls = new Map(), paths = [];
  const helpers = { safePath: (file, kind) => paths.push([file, kind]), fileDigest: file => {
    calls.set(file, (calls.get(file) ?? 0) + 1); return hash(readFileSync(file));
  } };
  const report = validateJarReferences(classpath, records, helpers);
  assert.equal(report.references.length, 3);
  assert.ok(report.references.every(row => row.exists && row.sha256 === records.find(jar => jar.file === row.resolved).sha256));
  assert.deepEqual([...calls.values()], [1, 1, 1]); assert.ok(paths.every(([, kind]) => kind === 'file'));
  calls.clear(); assert.deepEqual(assertJarReferencesUnchanged(report, helpers), report);
  assert.deepEqual([...calls.values()], [1, 1, 1]);
});

test('no headers is a valid report, including a classpath with no JARs', () => {
  const f = fixture(), files = [f.jar('a.jar'), f.jar('b.jar')];
  const report = validateJarReferences([f.classes, ...files], files.map(file => record(file)));
  assert.deepEqual(report.references, []); assert.deepEqual(assertJarReferencesUnchanged(report), report);
  assert.deepEqual(validateJarReferences([f.classes], []).jars, []);
});

test('present but unlisted targets fail even inside supply or on a pinned absent name', () => {
  const f = compilerFixture(['scala-reflect.jar']);
  writeFileSync(join(dirname(f.source), 'scala-reflect.jar'), 'unexpected JAR');
  assert.throws(f.capture, /not explicitly listed/);
  const g = fixture(), source = g.jar('example/main.jar'); g.jar('example/lib.jar');
  assert.throws(() => validateJarReferences([source], [record(source, ['lib.jar'])]), /not explicitly listed/);
});

test('absence is allowed only for exact pinned coordinate/token pairs, never arbitrary additions', () => {
  const f = compilerFixture(['other.jar']); assert.throws(f.capture, /not a pinned absent sibling/);
  for (const coordinate of ['example/scala-compiler-2.13.14.jar', COMPILER.replaceAll('2.13.14', '2.13.15'),
    'xalan/serializer/2.7.2/serializer-2.7.2.jar']) {
    const g = fixture(), source = g.jar(coordinate);
    assert.throws(() => validateJarReferences([source], [record(source, ['scala-reflect.jar'])]), /not a pinned absent sibling/);
  }
  const g = fixture(), source = g.put('not-supply/maven/' + COMPILER);
  assert.throws(() => validateJarReferences([source], [record(source, ['scala-reflect.jar'])]), /not a pinned absent sibling/);
  const nested = compilerFixture(['nested/scala-reflect.jar']); assert.throws(nested.capture, /not a pinned absent sibling/);
});

test('network, absolute, traversal, encoded and ambiguous URL tokens are rejected before hashing', () => {
  const f = compilerFixture([]);
  for (const token of ['https://example.test/a.jar', 'http://example.test/a.jar', '//example.test/a.jar',
    'file:///tmp/a.jar', 'file:a.jar', 'jar:file:a.jar!/b.jar', '/tmp/a.jar', '../a.jar', 'nested/../../a.jar',
    './a.jar', 'nested/../a.jar', 'nested/./a.jar', 'nested//a.jar', 'C:/a.jar', '\\host\\a.jar', 'nested\\a.jar',
    '%2e%2e/a.jar', '%2Fa.jar', 'a%20b.jar', 'a.jar?q=1', 'a.jar#fragment', 'a.jar\0', ' a.jar',
    'a.jar\tb.jar', 'a.jar\nb.jar', '', 'directory/', 'not-a-jar', 'a'.repeat(4097) + '.jar']) {
    assert.throws(() => validateJarReferences(f.classpath, [{ ...f.records[0], classPath: [token] }], {
      fileDigest: () => assert.fail('unsafe token must fail before file read'),
    }), /unsafe Class-Path token/, JSON.stringify(token));
  }
});

test('even explicitly listed external paths cannot authorize traversal or an absolute URL', () => {
  const f = compilerFixture([]), outside = f.jar('other/outside.jar');
  const classpath = [...f.classpath, outside];
  for (const token of [outside, 'file://' + outside, '../../../../../other/outside.jar']) {
    assert.throws(() => validateJarReferences(classpath, [record(f.source, [token]), record(outside)]), /unsafe Class-Path token/);
  }
});

test('probe list must exactly match ordered JARs: missing, extra, reordered, duplicated and malformed fail', () => {
  const f = fixture(), a = f.jar('a.jar'), b = f.jar('b.jar'), ra = record(a), rb = record(b);
  const classpath = [f.classes, a, b];
  for (const records of [[], [ra], [ra, rb, ra], [rb, ra], [ra, ra], null,
    [ra, { ...rb, sha256: '0'.repeat(63) }], [ra, { ...rb, classPath: '' }],
    [ra, { ...rb, extra: true }], [ra, { file: b, sha256: rb.sha256 }], [ra, null],
    [{ ...ra, classPath: ['b.jar', 'b.jar'] }, rb]]) {
    assert.throws(() => validateJarReferences(classpath, records));
  }
  for (const paths of [[a, a], ['relative.jar'], [a + '/../a.jar'], [a + '/'], [a + ':b'], new Array(1), new Array(4097)]) {
    assert.throws(() => validateJarReferences(paths, []));
  }
  assert.throws(() => validateJarReferences([a], [{ ...ra, classPath: new Array(4097).fill('b.jar') }]), /too many/);
});

test('changed or forged probe hashes fail, and mutation during the digest hook fails', () => {
  const f = compilerFixture([]);
  assert.throws(() => validateJarReferences(f.classpath, [{ ...f.records[0], sha256: '0'.repeat(64) }]), /SHA-256 differs/);
  writeFileSync(f.source, 'changed after probe'); assert.throws(f.capture, /SHA-256 differs/);
  const g = compilerFixture([]);
  assert.throws(() => validateJarReferences(g.classpath, g.records, { fileDigest: file => {
    writeFileSync(file, 'replaced during hash with a different size'); return g.records[0].sha256;
  } }), /changed during validation/);
});

for (const kind of ['file', 'directory', 'dangling symlink']) test('late creation of pinned absent sibling is rejected: ' + kind, () => {
  const f = compilerFixture(['scala-reflect.jar']), report = f.capture(), target = report.references[0].resolved;
  if (kind === 'file') writeFileSync(target, 'late JAR');
  if (kind === 'directory') mkdirSync(target);
  if (kind === 'dangling symlink') symlinkSync(join(f.root, 'missing.jar'), target);
  assert.throws(() => assertJarReferencesUnchanged(report), /not explicitly listed|symlink/);
});

test('recheck rejects changed/deleted present JARs and a replaced source ancestor', () => {
  const f = compilerFixture(['scala-reflect.jar']), dep = join(dirname(f.source), 'scala-reflect.jar');
  writeFileSync(dep, 'present'); f.classpath.push(dep); f.records.push(record(dep));
  const report = f.capture(); writeFileSync(dep, 'changed present reference');
  assert.throws(() => assertJarReferencesUnchanged(report), /SHA-256 differs/);
  const g = compilerFixture([]), report2 = g.capture();
  renameSync(g.source, g.source + '.saved');
  assert.throws(() => assertJarReferencesUnchanged(report2), /regular non-hardlinked JAR required/);
  const h = compilerFixture(), report3 = h.capture(), parent = dirname(h.source);
  renameSync(parent, parent + '-saved'); symlinkSync(parent + '-saved', parent);
  assert.throws(() => assertJarReferencesUnchanged(report3), /symlink/);
});

test('source or target symlinks, directory ancestors and hardlinks fail closed', () => {
  const f = compilerFixture([]), alias = join(f.root, 'alias.jar'); symlinkSync(f.source, alias);
  assert.throws(() => validateJarReferences([alias], [{ ...f.records[0], file: alias }]), /symlink/);
  const aliasDir = join(f.root, 'alias-dir'); symlinkSync(dirname(f.source), aliasDir);
  const nestedAlias = join(aliasDir, 'scala-compiler-2.13.14.jar');
  assert.throws(() => validateJarReferences([nestedAlias], [{ ...f.records[0], file: nestedAlias }]), /symlink/);
  const g = compilerFixture(['scala-reflect.jar']); symlinkSync(g.source, join(dirname(g.source), 'scala-reflect.jar'));
  assert.throws(g.capture, /symlink/);
  const h = compilerFixture([]); linkSync(h.source, join(h.root, 'hardlink.jar'));
  assert.throws(h.capture, /non-hardlinked/);
  const k = compilerFixture(['sub/library.jar']); writeFileSync(join(dirname(k.source), 'sub'), 'not a directory');
  assert.throws(k.capture, /non-directory ancestor/);
});

test('serialized report cannot silently drop or alter absence guards', () => {
  const f = compilerFixture(), report = f.capture();
  for (const edit of [r => { r.references = []; }, r => { r.references[0].resolved += '.other'; },
    r => { r.references[0].exists = true; }, r => { r.schemaVersion = 'other'; }, r => { r.extra = true; }]) {
    const changed = structuredClone(report); edit(changed);
    assert.throws(() => assertJarReferencesUnchanged(changed));
  }
});

// No JVM, external packages, downloads or services. Python's stdlib writes only
// tiny fixture ZIPs, and each process has a timeout, closed stdio and output cap.
function boundedPython(source, args, input) {
  const result = spawnSync('/usr/bin/python3', ['-I', '-S', '-c', source, ...args], {
    encoding: 'utf8', input, timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function zipFixture(f, coordinate, entries) {
  const file = join(f.root, 'supply/maven', coordinate); mkdirSync(dirname(file), { recursive: true });
  const input = JSON.stringify(entries.map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')]));
  const result = boundedPython(String.raw`import base64, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, content in json.load(sys.stdin):
        archive.writestr(name, base64.b64decode(content))
`, [file], input);
  assert.equal(result.status, 0, result.stderr);
  return file;
}

function runProbe(f, files) {
  const list = f.put('jars.json', JSON.stringify(files));
  return boundedPython(jarManifestProbeSource, [list]);
}
const MANIFEST = 'META-INF/MANIFEST.MF';

test('Python probes real ZIPs in order, unfolds bytes, ignores named-section Class-Path and hashes whole JARs', () => {
  const f = fixture();
  const raw = Buffer.concat([
    Buffer.from('Manifest-Version: 1.0\r\nClass-Path: scala-reflect.\r\n jar scala-\r\n library.jar\r\nComment: '),
    Buffer.from([0xe2, 0x82]), Buffer.from('\r\n '), Buffer.from([0xac]),
    Buffer.from('\r\n\r\nName: example/Foo.class\r\nClass-Path: https://ignored.example/a.jar\r\n\r\n'),
  ]);
  const compiler = zipFixture(f, COMPILER, [[MANIFEST, raw], ['not-loaded.class', 'arbitrary bytes']]);
  const empty = zipFixture(f, 'example/empty.jar', [['unrelated.txt', 'empty of manifests']]);
  const result = runProbe(f, [compiler, empty]); assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(result.stdout);
  assert.deepEqual(records, [record(compiler, ['scala-reflect.jar', 'scala-library.jar']), record(empty)]);
  const report = validateJarReferences([f.classes, compiler, empty], records);
  assert.equal(report.references.length, 2); assert.deepEqual(assertJarReferencesUnchanged(report), report);
});

test('Python accepts LF/CR line endings, case-insensitive header names, no headers and named-section duplicates', () => {
  const f = fixture();
  const files = [
    zipFixture(f, COMPILER, [[MANIFEST, 'Manifest-Version: 1.0\nclass-PATH: scala-reflect.jar  scala-library.jar\n\n']]),
    zipFixture(f, 'example/cr.jar', [[MANIFEST, 'Manifest-Version: 1.0\r\rName: a\rClass-Path: ignored.jar\rClass-Path: also-ignored.jar\r\r']]),
    zipFixture(f, 'example/blank.jar', [[MANIFEST, '']]),
    zipFixture(f, 'example/no-header.jar', [[MANIFEST, 'Manifest-Version: 1.0\n\n']]),
  ];
  const result = runProbe(f, files); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map(row => row.classPath), [['scala-reflect.jar', 'scala-library.jar'], [], [], []]);
});

for (const [label, entries, error] of [
  ['duplicate main headers', [[MANIFEST, 'Class-Path: a.jar\nclass-path: b.jar\n\n']], /duplicate main/],
  ['duplicate manifest entries', [[MANIFEST, ''], [MANIFEST, '']], /duplicate or ambiguous/],
  ['case-ambiguous manifest', [[MANIFEST, ''], ['meta-inf/manifest.mf', '']], /duplicate or ambiguous/],
  ['noncanonical manifest', [['meta-inf/manifest.mf', '']], /noncanonical/],
  ['oversized compressed manifest', [[MANIFEST, 'X: ' + 'a'.repeat(1024 * 1024) + '\n']], /exceeds 1 MiB/],
  ['invalid UTF-8', [[MANIFEST, Buffer.from([0x58, 0x3a, 0x20, 0xff, 0x0a])]], /UnicodeDecodeError/],
  ['orphan continuation', [[MANIFEST, ' orphan\n']], /orphan/],
  ['continuation after section boundary', [[MANIFEST, 'X: value\n\n orphan\n']], /orphan/],
  ['malformed header', [[MANIFEST, 'Class-Path:a.jar\n']], /malformed/],
  ['control character', [[MANIFEST, 'Class-Path: a.jar\tb.jar\n']], /control character/],
  ['missing terminal newline', [[MANIFEST, 'Class-Path: a.jar']], /unterminated/],
  ['duplicate token', [[MANIFEST, 'Class-Path: a.jar a.jar\n']], /duplicate Class-Path tokens/],
]) test('Python rejects ' + label, () => {
  const f = fixture(), file = zipFixture(f, 'example/probe.jar', entries);
  const result = runProbe(f, [file]); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, error);
});

test('Python bounds exactly 1 MiB manifests without rejecting a valid long continuation', () => {
  const f = fixture(), prefix = 'Comment: ', suffix = '\n\n';
  const manifest = prefix + 'x'.repeat(1024 * 1024 - prefix.length - suffix.length) + suffix;
  const file = zipFixture(f, 'example/limit.jar', [[MANIFEST, manifest]]);
  const result = runProbe(f, [file]); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [record(file)]);
});

test('Python rejects duplicate input, non-JAR input, corrupt ZIP and symlink sources without partial output', () => {
  for (const kind of ['duplicate', 'non-jar', 'corrupt', 'symlink']) {
    const f = fixture(); let files;
    if (kind === 'duplicate') { const file = zipFixture(f, 'example/probe.jar', []); files = [file, file]; }
    if (kind === 'non-jar') files = [f.put('not-a-jar.txt', 'content')];
    if (kind === 'corrupt') files = [f.jar('example/corrupt.jar', 'not ZIP')];
    if (kind === 'symlink') {
      const original = zipFixture(f, 'example/original.jar', []), link = join(f.root, 'link.jar');
      symlinkSync(original, link); files = [link];
    }
    const result = runProbe(f, files); assert.notEqual(result.status, 0, kind); assert.equal(result.stdout, '', kind);
  }
});
