import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_NETWORK_SCOPE, RUNTIME_NETWORK_LIMITATION, runtimeProbeSource, runtimeSandboxText, validateRuntimeSandboxPaths } from '../tools/truthsrc-runtime-sandbox.mjs';

const BANK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP = realpathSync(tmpdir());
const write = (file, text) => writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
const options = () => ({ evidence: join(TEMP, 'runtime-pure/evidence'), taRoot: join(TEMP, 'runtime-pure/ta'),
  readOnlyFiles: [join(TEMP, 'runtime-pure/evidence/new-credentials.json')], httpPort: 19481, databasePorts: [29482, 29481] });
const sandboxAvailable = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') && existsSync('/usr/bin/python3');

function fixture() {
  const round = mkdtempSync(join(TEMP, 'truthsrc-runtime-test-'));
  const evidence = join(round, 'evidence'), taRoot = join(round, 'ta'), compiled = join(round, 'compiled');
  for (const dir of [evidence, taRoot, compiled]) mkdirSync(dir, { mode: 0o700 });
  const profile = join(evidence, 'runtime-sandbox.sb'), probe = join(evidence, 'runtime-probe.py');
  const config = join(evidence, 'runtime.conf'), credentials = join(evidence, 'new-credentials.json');
  write(config, 'owned dummy configuration\n'); write(credentials, 'owned dummy credential canary\n');
  write(join(compiled, 'sample.class'), 'owned compile canary\n');
  const outside = mkdtempSync(join(TEMP, 'truthsrc-runtime-canary-')), canary = join(outside, 'write-canary');
  write(canary, 'owned outside canary\n');
  return { round, profile, probe, config, credentials, compiled, canary,
    spec: { evidence, taRoot, readOnlyFiles: [config, credentials, profile, probe, compiled], httpPort: 19481, databasePorts: [29481, 29482] } };
}

test('pure rendering is deterministic, does not mutate input or create output', () => {
  const spec = options(), before = structuredClone(spec), files = readdirSync(TEMP);
  const text = runtimeSandboxText(spec);
  assert.equal(runtimeSandboxText(spec), text);
  assert.deepEqual(spec, before); assert.deepEqual(readdirSync(TEMP), files);
  assert.match(text, /^\(version 1\)\n\(allow default\)\n\(deny network\*\)\n\(deny file-write\*\)\n/);
  assert.equal(text.split('\n').filter(line => line.startsWith('(allow file-write*')).length, 1);
  assert.ok(text.includes(`(subpath "${spec.evidence}") (subpath "${spec.taRoot}") (literal "/dev/null")`));
});

test('network defaults deny-all; explicit host-local scope grants only reserved ports and states its limitation', () => {
  assert.ok(!runtimeSandboxText(options()).includes('(allow network'));
  const opts = { ...options(), networkScope: RUNTIME_NETWORK_SCOPE };
  const text = runtimeSandboxText(opts);
  assert.ok(text.includes('(allow network-bind (local tcp4 "localhost:19481"))'));
  assert.ok(text.includes('(allow network-inbound (local tcp4 "localhost:19481"))'));
  assert.ok(text.includes('(allow network-outbound (remote tcp4 "localhost:19481") (remote tcp4 "localhost:29481") (remote tcp4 "localhost:29482"))'));
  const grants = text.split('\n').filter(line => line.startsWith('(allow network'));
  assert.equal(grants.length, 3);
  assert.ok(grants.every(line => !line.includes('*') && !line.includes('::') && !line.includes('udp') && !line.includes('literal')));
  if (sandboxAvailable) assert.match(readFileSync('/usr/share/sandbox/com.apple.smbd.sb', 'utf8'), /\(allow network-bind \(local tcp "\*:445"\)\)/);
  assert.ok(!runtimeSandboxText({ ...opts, databasePorts: [] }).includes('29481'));
  assert.match(RUNTIME_NETWORK_LIMITATION, /wildcard and configured local interface/);
  assert.throws(() => runtimeSandboxText({ ...opts, networkScope: 'exact-ipv4' }), /unsupported/);
  const { databasePorts, ...noDatabases } = opts;
  assert.equal(runtimeSandboxText(noDatabases), runtimeSandboxText({ ...noDatabases, databasePorts: [] }));
});

test('history reads, controls, new credentials and compile/classpath writes remain denied', () => {
  const spec = options(), text = runtimeSandboxText(spec);
  for (const suffix of ['tree', 'v1/tree', '.scratch', 'dist/v1', 'tools/truth-source.mjs'])
    assert.ok(text.includes(`(subpath "${join(BANK, suffix)}")`));
  const deny = text.split('\n').find(line => line.startsWith('(deny file-write* (subpath'));
  for (const suffix of ['new-credentials.json', 'sandbox.sb', 'runtime-sandbox.sb', 'probe.py', 'runtime-probe.py'])
    assert.ok(deny.includes(`(subpath "${join(spec.evidence, suffix)}")`));
  assert.match(text, /class\|jar/);
  assert.ok(text.includes(`(deny file-write-unlink (literal "${spec.evidence}")`));
});

test('rejects invalid, privileged, duplicate and overlapping network ports', () => {
  for (const httpPort of [undefined, null, true, '19481', 0, 1, 1023, 1024, 9000, 2551, 3306, 27017, 65536, 3.14, NaN, Infinity])
    assert.throws(() => runtimeSandboxText({ ...options(), httpPort }));
  for (const databasePorts of [null, '29481', {}, [19481], [29481, 29481], [true], [0], ['29481']])
    assert.throws(() => runtimeSandboxText({ ...options(), databasePorts }));
  for (const httpPort of [1025, 65535]) assert.equal(typeof runtimeSandboxText({ ...options(), httpPort }), 'string');
});

test('rejects nonplain paths, broad roots, history, source and compiler write roots', () => {
  for (const evidence of [undefined, null, {}, 'relative', '/', '/private/tmp', '/private/var', '/Users', BANK,
    join(BANK, 'target'), join(BANK, 'v1'), join(BANK, 'tools'), join(BANK, 'tree/round'), join(BANK, 'v1/tree/round'),
    join(BANK, 'handwritten/scala'), join(BANK, 'handwritten/scala/round'), join(BANK, 'test/scala'), join(BANK, 'test/scala/round'),
    join(BANK, '.scratch/round'), join(BANK, 'dist/v1/round'), join(TEMP, 'round/compile'), join(TEMP, 'round/classpath'),
    join(TEMP, 'round/classes'), join(TEMP, 'round/../round'), join(TEMP, 'round//child'), join(TEMP, 'bad name'),
    join(TEMP, 'bad"name'), join(TEMP, 'bad\nname'), join(TEMP, 'bad\\name'), join(TEMP, 'round') + '/']) {
    // Do not normalize deliberately invalid strings before passing them to the API.
    if (evidence === join(TEMP, 'round/../round') || evidence === join(TEMP, 'round//child')) continue;
    assert.throws(() => runtimeSandboxText({ ...options(), evidence }), String(evidence));
  }
  for (const evidence of [TEMP + '/round/../round', TEMP + '/round//child', '/tmp/round', '/var/tmp/round'])
    assert.throws(() => runtimeSandboxText({ ...options(), evidence }));
  assert.doesNotThrow(() => runtimeSandboxText({ ...options(), evidence: join(BANK, 'target/new-runtime'), taRoot: join(BANK, '.local/mock-ta/new-runtime') }));
});

test('rejects path overlaps and ambiguous read-only lists', () => {
  const spec = options();
  for (const taRoot of [spec.evidence, join(spec.evidence, 'ta'), dirname(spec.evidence)])
    assert.throws(() => runtimeSandboxText({ ...spec, taRoot }));
  for (const readOnlyFiles of [undefined, [], 'config', [null], [spec.evidence], [dirname(spec.evidence)],
    [spec.taRoot], [spec.readOnlyFiles[0], spec.readOnlyFiles[0]], [join(TEMP, 'compiled'), join(TEMP, 'compiled/a.jar')]])
    assert.throws(() => runtimeSandboxText({ ...spec, readOnlyFiles }));
});

test('on-disk admission accepts new controls without reading any config contents', () => {
  const { spec, profile } = fixture();
  assert.equal(existsSync(profile), false);
  assert.equal(validateRuntimeSandboxPaths(spec), true);
  assert.equal(existsSync(profile), false);
});

test('on-disk admission rejects symlink roots, symlink controls, hard links and wrong types', () => {
  const f = fixture(), alias = join(f.round, 'alias'); symlinkSync(f.spec.evidence, alias);
  assert.throws(() => validateRuntimeSandboxPaths({ ...f.spec, evidence: alias }));
  symlinkSync(f.config, f.profile);
  assert.throws(() => validateRuntimeSandboxPaths(f.spec));
  const g = fixture(); linkSync(g.config, join(g.round, 'config-link'));
  assert.throws(() => validateRuntimeSandboxPaths(g.spec));
  assert.throws(() => validateRuntimeSandboxPaths({ ...g.spec, evidence: g.config }));
});

test('probe is denial-only by default; positive sockets require explicit boolean opt-in', () => {
  const spec = options(), canary = join(TEMP, 'outside-canary/write-canary');
  const source = runtimeProbeSource({ ...spec, canary });
  assert.match(source, /if False and len\(sys.argv\) == 1:/);
  assert.match(source, /signal.alarm\(20\)/); assert.match(source, /settimeout\(0.5\)/);
  assert.match(source, /errno.EPERM, errno.EACCES/);
  assert.match(source, /scope=deny-all/);
  const positive = runtimeProbeSource({ ...spec, networkScope: RUNTIME_NETWORK_SCOPE, canary, positiveNetwork: true });
  assert.match(positive, /if True and len\(sys.argv\) == 1:/);
  assert.match(positive, /scope=host-local-reserved-ports/);
  for (const positiveNetwork of ['true', 1, null]) assert.throws(() => runtimeProbeSource({ ...spec, canary, positiveNetwork }));
  assert.throws(() => runtimeProbeSource({ ...spec, canary: join(spec.evidence, 'not-outside') }));
});

test('real Seatbelt syscall denials and owned filesystem exceptions, without allowed listeners', { skip: !sandboxAvailable, timeout: 20000 }, t => {
  const f = fixture();
  write(f.profile, runtimeSandboxText(f.spec));
  const escape = join(f.spec.evidence, 'outside-link'); symlinkSync(f.canary, escape);
  const extra = `\ndenied('symlink-write-escape', lambda: write_attempt(${JSON.stringify(escape)}))\n`;
  write(f.probe, runtimeProbeSource({ ...f.spec, canary: f.canary }) + extra);
  assert.equal(validateRuntimeSandboxPaths(f.spec), true);
  const immutable = [f.canary, f.config, f.credentials, f.profile, f.probe, join(f.compiled, 'sample.class')];
  const before = immutable.map(p => readFileSync(p));
  const result = spawnSync('/usr/bin/sandbox-exec', ['-f', f.profile, '/usr/bin/python3', '-I', '-S', f.probe], {
    cwd: f.spec.evidence, env: { PATH: '/usr/bin:/bin', HOME: f.spec.evidence, TMPDIR: f.spec.evidence },
    encoding: 'utf8', timeout: 17000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
  });
  write(join(f.spec.evidence, 'probe.stdout.log'), result.stdout ?? '');
  write(join(f.spec.evidence, 'probe.stderr.log'), result.stderr ?? '');
  write(join(f.spec.evidence, 'probe-result.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.code ?? null }) + '\n');
  t.diagnostic('Retained runtime evidence: ' + f.round + '; outside canary: ' + dirname(f.canary));
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TRUTHSRC-RUNTIME-SANDBOX-OK scope=deny-all depth=2/);
  for (const [index, path] of ['tree', 'v1/tree'].entries()) if (!existsSync(join(BANK, path)))
    assert.match(result.stdout, new RegExp('ABSENT historical-read-' + index + ' baseline=missing no-denial-proof'));
  for (const label of ['ipv4-connect', 'ipv4-bind', 'ipv6-connect', 'ipv6-bind', 'ipv6-http-connect',
    'unix-bind', 'http-bind-0.0.0.0', 'remote-connect', 'udp-53', 'database-bind-29481',
    'outside-write', 'readonly-0', 'readonly-1', 'readonly-2', 'readonly-3', 'readonly-4', 'historical-read-4', 'symlink-write-escape'])
    assert.match(result.stdout, new RegExp('DENIED ' + label + ' errno=(1|13)\\b'));
  assert.ok(!result.stdout.includes('ALLOWED ipv4-http') && !result.stdout.includes('ALLOWED database-connect'));
  immutable.forEach((p, i) => assert.deepEqual(readFileSync(p), before[i]));
  for (const root of [f.spec.evidence, f.spec.taRoot]) assert.equal(readFileSync(join(root, 'runtime-probe-write'), 'utf8'), 'owned-write-allowed\n');
  assert.equal(existsSync(join(f.spec.evidence, 'denied.sock')), false);
});
