import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { acquireRuntimeLease, readRuntimeLease } from '../tools/truthsrc-runtime-lease.mjs';

function fixture(t, owner = 'public-adapter-job') {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bank-public-lease-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.mkdirSync(path.join(root, 'target/build'), { recursive: true });
  fs.mkdirSync(path.join(root, '.local/mock-ta'), { recursive: true });
  // These are file-lock identifiers only; every test injects a non-network probe.
  const spec = { schemaVersion: 'bank.truthsrc-runtime-lease/v1', owner, host: '127.0.0.1',
    ports: { http: 28763, mysql: 28761, mongo: 28762 }, runRoot: path.join(root, 'target/truthsrc-runtime-' + owner) };
  const options = { lease: path.join(root, 'lease.json'), evidence: spec.runRoot,
    round: path.join(root, '.local/mock-ta/truthsrc-runtime-' + owner), buildEvidence: path.join(root, 'target/build') };
  fs.writeFileSync(options.lease, JSON.stringify(spec), { flag: 'wx', mode: 0o600 });
  return { root, spec, options, registry: path.join(root, 'target/truthsrc-runtime-leases'),
    settings: { root, probePort: async () => {} } };
}
const names = f => ['owner-' + f.spec.owner + '.lock', 'port-28761.lock', 'port-28762.lock', 'port-28763.lock'];
const marker = f => 'owner-' + f.spec.owner + '.used.json';

test('bank imports public file lease, while public closure has no bank or port policy', () => {
  const bank = fileURLToPath(new URL('../tools/truthsrc-runtime-lease.mjs', import.meta.url));
  assert.match(fs.readFileSync(bank, 'utf8'), /import\s+\{\s*acquireFileLease\s*\}\s+from\s+['"]\.\.\/\.\.\/metarch-truthsrc\/lib\/verification\/lease\.mjs['"]/);
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /bank-wealth|127\.0\.0\.1|node:net|probePort|runtime-admission/);
    for (const match of source.matchAll(/^import\s[^;]*?\sfrom\s['"]([^'"]+)['"]/gm)) {
      if (match[1].startsWith('node:')) continue;
      assert.ok(match[1].startsWith('.'));
      visit(path.resolve(path.dirname(file), match[1]));
    }
  }
  visit(fileURLToPath(new URL('../../metarch-truthsrc/lib/verification/lease.mjs', import.meta.url)));
});

test('adapter keeps record key/byte layout, lock acquisition order and probe order', async t => {
  const f = fixture(t), opened = [], probed = [];
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    if ((typeof flags === 'number' && (flags & fs.constants.O_CREAT)) || flags === 'wx') opened.push(path.basename(file));
    return open(file, flags, ...args);
  });
  const lease = await acquireRuntimeLease(f.options, { root: f.root, probePort: async port => {
    probed.push(port);
    assert.deepEqual(fs.readdirSync(f.registry).sort(), names(f).sort());
  } });
  assert.deepEqual(opened, [...names(f), marker(f)]);
  assert.deepEqual(probed, [28763, 28761, 28762]);
  assert.deepEqual(Object.keys(lease), ['spec', 'record', 'registry', 'assertHeld', 'release']);
  assert.deepEqual(Object.keys(lease.record), ['schemaVersion', 'owner', 'host', 'ports', 'runRoot', 'input', 'round',
    'buildEvidence', 'token', 'pid', 'acquiredAt']);
  assert.deepEqual(lease.spec, f.spec);
  const bytes = fs.readFileSync(f.options.lease);
  assert.deepEqual(lease.record.input, { file: f.options.lease, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.match(lease.record.token, /^[0-9a-f]{48}$/);
  assert.equal(lease.record.pid, process.pid);
  assert.equal(new Date(lease.record.acquiredAt).toISOString(), lease.record.acquiredAt);
  for (const name of opened)
    assert.equal(fs.readFileSync(path.join(f.registry, name), 'utf8'), JSON.stringify(lease.record) + '\n');
  assert.equal(Object.isFrozen(lease.record.ports), true);
  lease.release(f.spec.owner);
  assert.deepEqual(fs.readdirSync(f.registry), [marker(f)]);
});

test('public contention and used codes map to the exact bank messages; used retry still probes', async t => {
  const f = fixture(t), lease = await acquireRuntimeLease(f.options, f.settings);
  await assert.rejects(acquireRuntimeLease(f.options, f.settings), error =>
    error.message === 'runtime lease already held: owner-' + f.spec.owner + '; no automatic takeover');
  const other = structuredClone(f.spec); other.owner = 'other-public-job';
  other.runRoot = path.join(f.root, 'target/truthsrc-runtime-' + other.owner);
  const options = { ...f.options, lease: path.join(f.root, 'other.json'), evidence: other.runRoot,
    round: path.join(f.root, '.local/mock-ta/truthsrc-runtime-' + other.owner) };
  fs.writeFileSync(options.lease, JSON.stringify(other));
  await assert.rejects(acquireRuntimeLease(options, f.settings), error =>
    error.message === 'runtime lease already held: port-28761; no automatic takeover');
  assert.equal(fs.existsSync(path.join(f.registry, 'owner-' + other.owner + '.lock')), false);
  lease.release(f.spec.owner); lease.release(f.spec.owner);
  assert.throws(() => lease.release('wrong-owner'), /only the acquiring owner can release this lease/);
  assert.throws(() => lease.assertHeld(), /lease already released/);
  const probed = [];
  await assert.rejects(acquireRuntimeLease(f.options, { root: f.root, probePort: async port => probed.push(port) }), error =>
    error.message === 'runtime owner already used/returned; choose a new owner');
  assert.deepEqual(probed, [28763, 28761, 28762]);
  assert.deepEqual(fs.readdirSync(f.registry), [marker(f)]);
});

test('bank still rechecks input and fresh roots after the final probe, before writing its marker', async t => {
  for (const change of ['input', 'evidence', 'round']) await t.test(change, async t => {
    const f = fixture(t); let count = 0;
    await assert.rejects(acquireRuntimeLease(f.options, { root: f.root, probePort: async () => {
      count++;
      if (count === 3) {
        if (change === 'input') fs.appendFileSync(f.options.lease, '\n');
        else fs.mkdirSync(f.options[change]);
      }
    } }), change === 'input' ? /lease input changed/ : /already exists/);
    assert.equal(count, 3);
    assert.deepEqual(fs.readdirSync(f.registry), []);
  });
});

test('post-acquisition input drift blocks held assertion but not idempotent owner release', async t => {
  const f = fixture(t), lease = await acquireRuntimeLease(f.options, f.settings);
  fs.writeFileSync(f.options.lease, '{}');
  assert.throws(() => lease.assertHeld(), /lease input changed/);
  const expected = { owner: f.spec.owner, released: true, dataPreserved: true, reusable: false };
  assert.deepEqual(lease.release(f.spec.owner), expected);
  assert.deepEqual(lease.release(f.spec.owner), expected);
  assert.deepEqual(fs.readdirSync(f.registry), [marker(f)]);
});

test('bank rejects arbitrary public records and preserves its input JSON and pathname policy', async t => {
  const f = fixture(t);
  for (const bytes of [JSON.stringify({ application: 'renderer', resource: 'dataset' }),
    JSON.stringify({ ...f.spec, host: 'localhost' }), JSON.stringify({ ...f.spec, ports: { ...f.spec.ports, http: 9000 } }),
    '{"schemaVersion":1,"schemaVersion":2}', Buffer.from([0xff]), ' '.repeat(16385)]) {
    fs.writeFileSync(f.options.lease, bytes);
    await assert.rejects(acquireRuntimeLease(f.options, f.settings));
    assert.equal(fs.existsSync(f.registry), false);
  }
  fs.writeFileSync(f.options.lease, JSON.stringify(f.spec));
  const alias = path.join(f.root, 'not plain.json'); fs.writeFileSync(alias, JSON.stringify(f.spec));
  assert.throws(() => readRuntimeLease({ ...f.options, lease: alias }, f.settings), /canonical plain absolute path/);
});

test('bank keeps strict duplicate-key rejection when validating a held lease record', async t => {
  const f = fixture(t), lease = await acquireRuntimeLease(f.options, f.settings);
  const file = path.join(f.registry, names(f)[0]), original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{"owner":"different",' + original.slice(1));
  assert.throws(() => lease.assertHeld(), /changed/);
  assert.throws(() => lease.release(f.spec.owner), /changed/);
  fs.writeFileSync(file, original); lease.release(f.spec.owner);
});

test('probe failure propagates unchanged without a used marker or leftover cooperative locks', async t => {
  const f = fixture(t), failure = new Error('owned simulated probe failure');
  await assert.rejects(acquireRuntimeLease(f.options, { root: f.root, probePort: async () => { throw failure; } }),
    error => error === failure);
  assert.deepEqual(fs.readdirSync(f.registry), []);
});
