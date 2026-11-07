import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRuntimeFile, safePath } from './truthsrc-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'bank.truthsrc-runtime-lease/v1';
const exact = (value, fields) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'lease object required');
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), 'unknown/missing lease fields');
};
const inside = (a, b) => b.toLowerCase() === a.toLowerCase() || b.toLowerCase().startsWith(a.toLowerCase() + '/');
const overlap = (a, b) => inside(a, b) || inside(b, a);
const identity = stat => [stat.dev, stat.ino];
const stamp = ({ bytes, sha256 }) => ({ bytes, sha256 });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// runRoot is the evidence/data root, NOT a build root. The TA sibling location is
// kept explicit to preserve the unchanged worker's direct .local/mock-ta contract.
export function validateRuntimeLease(spec, options, { root = ROOT } = {}) {
  exact(spec, ['schemaVersion', 'owner', 'host', 'ports', 'runRoot']);
  assert.equal(spec.schemaVersion, SCHEMA);
  assert.ok(typeof spec.owner === 'string' && /^[a-z][a-z0-9_-]{0,59}$/.test(spec.owner), 'plain new owner required');
  assert.ok(!/^truthsrc-unification-runtime-/.test(spec.owner), 'historical date owner is returned; choose a new owner');
  assert.equal(spec.host, '127.0.0.1', 'only IPv4 loopback is admitted');
  exact(spec.ports, ['http', 'mysql', 'mongo']);
  for (const port of Object.values(spec.ports)) assert.ok(Number.isSafeInteger(port) && port > 1024 && port <= 65535 &&
    ![9000, 2551, 3306, 27017].includes(port), 'explicit unprivileged nonshared ports required');
  assert.equal(new Set(Object.values(spec.ports)).size, 3, 'lease ports must be distinct');
  assert.equal(spec.runRoot, join(root, 'target', 'truthsrc-runtime-' + spec.owner), 'runRoot must be the new owner-specific bank target root');
  assert.equal(options.evidence, spec.runRoot, '--evidence must equal lease.runRoot');
  assert.equal(options.round, join(root, '.local/mock-ta', basename(spec.runRoot)), '--round must be the owner-specific TA root');
  safePath(spec.runRoot, 'new'); safePath(options.round, 'new');
  safePath(options.buildEvidence);
  assert.ok(![spec.runRoot, options.round].some(path => overlap(path, options.buildEvidence)), 'build and runtime roots must be disjoint');
  return freeze(structuredClone(spec));
}

export function readRuntimeLease(options, settings) {
  assert.ok(typeof options.lease === 'string', '--lease is required; the historical reservation has been returned');
  const capture = captureRuntimeFile(options.lease, { json: true, limit: 16 * 1024 });
  const spec = validateRuntimeLease(capture.value, options, settings);
  assert.ok(![spec.runRoot, options.round].some(path => overlap(path, options.lease)), 'lease input must be outside new data roots');
  return { spec, input: { file: options.lease, ...stamp(capture) } };
}

export async function assertRuntimePortFree(port) {
  const server = createServer();
  try {
    await new Promise((yes, no) => {
      server.once('error', no);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, yes);
    });
  } catch (error) {
    throw new Error('runtime port unavailable on 127.0.0.1:' + port + ' (' + error.code + ')');
  } finally {
    if (server.listening) await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  }
}

function privateDirectory(path) {
  safePath(path);
  const stat = lstatSync(path);
  assert.ok(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'private current-user lease directory required');
  return identity(stat);
}

// Cooperative file leases are not hostile-process isolation. The kernel must
// still reject bind races and the existing runtime verifies actual listeners.
// Never steal a stale lock: SIGKILL/unknown cleanup requires owner investigation.
// `root` and `probePort` are Node-test seams; there are no corresponding CLI flags.
export async function acquireRuntimeLease(options, { root = ROOT, probePort = assertRuntimePortFree } = {}) {
  options = Object.freeze({ ...options });
  const { spec, input } = readRuntimeLease(options, { root });
  const registry = join(root, 'target/truthsrc-runtime-leases');
  safePath(dirname(registry));
  try { mkdirSync(registry, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const registryIdentity = privateDirectory(registry);
  const record = freeze({ ...spec, input, round: options.round, buildEvidence: options.buildEvidence,
    token: randomBytes(24).toString('hex'), pid: process.pid, acquiredAt: new Date().toISOString() });
  const text = JSON.stringify(record) + '\n', locks = [];
  let released = false;
  const checkRegistry = () => assert.deepEqual(privateDirectory(registry), registryIdentity, 'lease directory replaced');
  const checkLocks = () => {
    checkRegistry();
    for (const lock of locks) {
      assert.deepEqual(identity(lstatSync(lock.file)), lock.identity, 'lease lock replaced');
      const current = captureRuntimeFile(lock.file, { json: true, limit: 32 * 1024 });
      assert.deepEqual(current.value, record, 'lease owner/token/content changed');
      assert.deepEqual(identity(fstatSync(lock.fd)), lock.identity, 'lease handle changed');
    }
  };
  const releaseLocks = () => {
    checkLocks(); // Check every lock BEFORE removing any; never touch another owner's file.
    while (locks.length) {
      const lock = locks.at(-1);
      unlinkSync(lock.file); closeSync(lock.fd); locks.pop();
    }
  };
  try {
    for (const name of ['owner-' + spec.owner, ...Object.values(spec.ports).sort((a, b) => a - b).map(port => 'port-' + port)]) {
      checkRegistry();
      const file = join(registry, name + '.lock');
      let fd;
      try { fd = openSync(file, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error('runtime lease already held: ' + name + '; no automatic takeover');
        throw error;
      }
      locks.push({ file, fd, identity: identity(fstatSync(fd)) });
      writeFileSync(fd, text); fsyncSync(fd);
    }
    // Hold all cooperative locks during the probes and the subsequent runtime.
    for (const port of Object.values(spec.ports)) await probePort(port);
    assert.deepEqual(stamp(captureRuntimeFile(input.file, { json: true, limit: 16 * 1024 })), stamp(input), 'lease input changed');
    validateRuntimeLease(spec, options, { root });
    checkLocks();
    // Persistent single-use owner marker, retained along with all data/evidence.
    // This prevents a released lease or copied old JSON from becoming a new grant.
    const used = join(registry, 'owner-' + spec.owner + '.used.json');
    try {
      const fd = openSync(used, 'wx', 0o600);
      try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('runtime owner already used/returned; choose a new owner');
      throw error;
    }
  } catch (error) {
    try { releaseLocks(); }
    catch (cleanupError) {
      for (const lock of locks) { try { closeSync(lock.fd); } catch { /* files remain held, no takeover */ } }
      throw new AggregateError([error, cleanupError], 'lease acquisition failed; changed locks retained for owner investigation');
    }
    throw error;
  }
  return Object.freeze({
    spec, record, registry,
    assertHeld() {
      assert.equal(released, false, 'lease already released'); checkLocks();
      assert.deepEqual(stamp(captureRuntimeFile(input.file, { json: true, limit: 16 * 1024 })), stamp(input), 'lease input changed');
    },
    release(owner) {
      assert.equal(owner, spec.owner, 'only the acquiring owner can release this lease');
      if (!released) { releaseLocks(); released = true; }
      return { owner, released: true, dataPreserved: true, reusable: false };
    },
  });
}
