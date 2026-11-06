import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRuntimeLease, assertRuntimePortFree, readRuntimeLease, validateRuntimeLease } from '../tools/truthsrc-runtime-lease.mjs';

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'runtime-lease-test-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(join(root, 'target/build'), { recursive: true });
  mkdirSync(join(root, '.local/mock-ta'), { recursive: true });
  function request(owner = 'onboarding-new-a', ports = { http: 28761, mysql: 28762, mongo: 28763 }) {
    const runRoot = join(root, 'target/truthsrc-runtime-' + owner);
    const spec = { schemaVersion: 'bank.truthsrc-runtime-lease/v1', owner, host: '127.0.0.1', ports, runRoot };
    const options = { lease: join(root, owner + '.json'), evidence: runRoot,
      round: join(root, '.local/mock-ta/truthsrc-runtime-' + owner), buildEvidence: join(root, 'target/build') };
    writeFileSync(options.lease, JSON.stringify(spec), { flag: 'wx', mode: 0o600 });
    return { spec, options };
  }
  return { root, request, settings: { root, probePort: async () => {} }, registry: join(root, 'target/truthsrc-runtime-leases') };
}
const locks = registry => readdirSync(registry).filter(name => name.endsWith('.lock')).sort();

for (const [name, mutate] of [
  ['old owner', s => { s.owner = 'truthsrc-unification-runtime-20261105'; }],
  ['owner traversal', s => { s.owner = '../other'; }],
  ['uppercase alias', s => { s.owner = 'OWNER'; }],
  ['shared HTTP port', s => { s.ports.http = 9000; }],
  ['privileged port', s => { s.ports.mysql = 1024; }],
  ['ephemeral auto port', s => { s.ports.mongo = 0; }],
  ['noninteger port', s => { s.ports.mongo = '28763'; }],
  ['duplicate ports', s => { s.ports.mongo = s.ports.mysql; }],
  ['wildcard host', s => { s.host = '0.0.0.0'; }],
  ['remote host', s => { s.host = '192.0.2.1'; }],
  ['IPv6 host', s => { s.host = '::1'; }],
  ['hostname alias', s => { s.host = 'localhost'; }],
  ['arbitrary old data root', s => { s.runRoot = '/tmp/old-data'; }],
  ['extra remote database option', s => { s.databaseUrl = 'mongodb://remote'; }],
  ['credential option', s => { s.password = 'not-a-real-secret'; }],
  ['extra port', s => { s.ports.remoting = 2552; }],
  ['missing explicit host', s => { delete s.host; }],
  ['missing schema', s => { delete s.schemaVersion; }],
]) test('lease schema rejects ' + name, t => {
  const f = fixture(t), { spec, options } = f.request(); mutate(spec);
  assert.throws(() => validateRuntimeLease(spec, options, f.settings));
  assert.equal(existsSync(f.registry), false);
});

test('lease binds both CLI paths and rejects existing data or symlink roots', t => {
  const f = fixture(t), { spec, options } = f.request();
  assert.deepEqual(readRuntimeLease(options, f.settings).spec, spec);
  assert.throws(() => validateRuntimeLease(spec, { ...options, evidence: spec.runRoot + '-other' }, f.settings), /--evidence/);
  assert.throws(() => validateRuntimeLease(spec, { ...options, round: options.round + '-other' }, f.settings), /--round/);
  assert.throws(() => readRuntimeLease({ ...options, lease: undefined }, f.settings), /returned/);
  symlinkSync(options.buildEvidence, options.round);
  assert.throws(() => readRuntimeLease(options, f.settings), /already exists/);
  rmSync(options.round); mkdirSync(spec.runRoot);
  assert.throws(() => readRuntimeLease(options, f.settings), /already exists/);
});

test('lease file is bounded, strict, non-linked JSON rather than executable configuration', t => {
  const f = fixture(t), { options } = f.request();
  for (const bytes of ['{"owner":"a","owner":"b"}', Buffer.from([0xff]), ' '.repeat(17000)]) {
    writeFileSync(options.lease, bytes);
    assert.throws(() => readRuntimeLease(options, f.settings));
  }
  writeFileSync(options.lease, '{}'); linkSync(options.lease, join(f.root, 'hardlink'));
  assert.throws(() => readRuntimeLease(options, f.settings), /non-hardlinked/);
});

test('exclusive owner/port locks survive concurrent acquisition and only owner can release', async t => {
  const f = fixture(t), a = f.request();
  const results = await Promise.allSettled([acquireRuntimeLease(a.options, f.settings), acquireRuntimeLease(a.options, f.settings)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.match(results.find(row => row.status === 'rejected').reason.message, /already held/);
  const lease = results.find(row => row.status === 'fulfilled').value;
  assert.equal(locks(f.registry).length, 4);
  assert.equal(lstatSync(f.registry).mode & 0o777, 0o700);
  for (const name of locks(f.registry)) assert.equal(lstatSync(join(f.registry, name)).mode & 0o777, 0o600);
  assert.throws(() => lease.release('different-owner'), /only the acquiring owner/);
  lease.assertHeld();
  const b = f.request('onboarding-new-b');
  await assert.rejects(acquireRuntimeLease(b.options, f.settings), /already held: port-/);
  assert.equal(locks(f.registry).length, 4); // b's partial owner lock was released, a's were not.
  assert.deepEqual(lease.release(a.spec.owner), { owner: a.spec.owner, released: true, dataPreserved: true, reusable: false });
  assert.equal(lease.release(a.spec.owner).released, true); // Idempotent, same capability only.
  assert.deepEqual(locks(f.registry), []);
  await assert.rejects(acquireRuntimeLease(a.options, f.settings), /already used\/returned/);
  assert.deepEqual(locks(f.registry), []);
  const next = await acquireRuntimeLease(b.options, f.settings); next.release(b.spec.owner);
});

test('a second Node process cannot acquire another process owner lock even with other ports', async t => {
  const f = fixture(t), a = f.request(), lease = await acquireRuntimeLease(a.options, f.settings);
  const other = { ...a.spec, ports: { http: 28861, mysql: 28862, mongo: 28863 } };
  const file = join(f.root, 'same-owner-new-ports.json'); writeFileSync(file, JSON.stringify(other));
  const module = new URL('../tools/truthsrc-runtime-lease.mjs', import.meta.url).href;
  const script = `import { acquireRuntimeLease } from ${JSON.stringify(module)};
    try { await acquireRuntimeLease(${JSON.stringify({ ...a.options, lease: file })}, {root:${JSON.stringify(f.root)}, probePort:async()=>{}}); process.exitCode=3; }
    catch (error) { console.log(error.message); process.exitCode=2; }`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  const code = await new Promise((yes, no) => { child.once('error', no); child.once('close', yes); }).finally(() => clearTimeout(timeout));
  assert.equal(code, 2, err); assert.match(out, /already held: owner-/); lease.assertHeld();
  lease.release(a.spec.owner);
});

test('port preflight rejects an actual foreign listener and rolls back only newly acquired locks', async t => {
  const f = fixture(t), server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen({ host: '127.0.0.1', port: 0 }, yes); });
  t.after(() => new Promise(done => server.close(done)));
  const port = server.address().port;
  await assert.rejects(assertRuntimePortFree(port), /port unavailable/);
  const other = [28761, 28762, 28763].filter(value => value !== port);
  const a = f.request('onboarding-conflict', { http: port, mysql: other[0], mongo: other[1] });
  await assert.rejects(acquireRuntimeLease(a.options, { root: f.root }), /port unavailable/);
  assert.equal(server.listening, true); assert.deepEqual(locks(f.registry), []);
  assert.equal(existsSync(a.spec.runRoot), false); assert.equal(existsSync(a.options.round), false);
  assert.equal(existsSync(join(f.registry, 'owner-' + a.spec.owner + '.used.json')), false);
});

test('successful real loopback probes release their listeners', async t => {
  const server = createServer();
  await new Promise(done => server.listen({ host: '127.0.0.1', port: 0 }, done));
  const port = server.address().port; await new Promise(done => server.close(done));
  await assertRuntimePortFree(port); await assertRuntimePortFree(port);
});

test('input drift fails held check but cannot stop the original owner releasing its unchanged locks', async t => {
  const f = fixture(t), a = f.request(), lease = await acquireRuntimeLease(a.options, f.settings);
  writeFileSync(a.options.lease, JSON.stringify({ ...a.spec, host: '0.0.0.0' }));
  assert.throws(() => lease.assertHeld(), /lease input changed/);
  assert.equal(lease.release(a.spec.owner).released, true);
});

test('lock replacement or token modification is never unlinked on release', async t => {
  const f = fixture(t), a = f.request(), lease = await acquireRuntimeLease(a.options, f.settings);
  const file = join(f.registry, 'owner-' + a.spec.owner + '.lock'), original = readFileSync(file);
  writeFileSync(file, JSON.stringify({ ...lease.record, token: 'foreign' }));
  assert.throws(() => lease.release(a.spec.owner), /owner\/token\/content changed/);
  assert.equal(locks(f.registry).length, 4);
  writeFileSync(file, original);
  const backup = file + '.original'; renameSync(file, backup); writeFileSync(file, original);
  assert.throws(() => lease.release(a.spec.owner), /lock replaced/);
  assert.equal(locks(f.registry).length, 4);
  rmSync(file); renameSync(backup, file); lease.release(a.spec.owner);
});

test('normal owner release keeps fresh data and permanently records the used owner', async t => {
  const f = fixture(t), a = f.request(), lease = await acquireRuntimeLease(a.options, f.settings);
  mkdirSync(a.spec.runRoot); mkdirSync(a.options.round);
  const journal = join(a.options.round, 'journal'); writeFileSync(journal, 'owned data');
  lease.release(a.spec.owner);
  assert.equal(readFileSync(journal, 'utf8'), 'owned data');
  assert.equal(existsSync(join(f.registry, 'owner-' + a.spec.owner + '.used.json')), true);
  assert.deepEqual(locks(f.registry), []);
});
