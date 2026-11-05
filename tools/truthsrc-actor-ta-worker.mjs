import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson, MAX_JSON_BYTES } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { PersistentMockTACore } from '../simulator/mock-ta-core.mjs';
import { canonicalJson, digest, exactObject, safeTick } from '../simulator/contract.mjs';

const bank = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rounds = path.join(bank, '.local', 'mock-ta');
const fixtureFile = path.join(bank, 'test', 'fixtures', 'truthsrc-actor-ta.json');
const sourceFile = 'tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml';
const sourcePointer = '/payload/info/artifact/body/mockConfiguration';
// Preserve the service worker's 65,536-byte request-line ceiling (excluding CRLF).
const MAX_REQUEST_BYTES = 65536;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const sha256 = (value, label) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('WORKER_SHA256', `${label} must be a lowercase SHA-256`);
};

function absolute(input) {
  if (typeof input !== 'string' || !input || input.includes('\0') || input.includes('\\')
    || !path.isAbsolute(input) || path.resolve(input) !== input) {
    fail('WORKER_PATH', 'Explicit canonical absolute paths required');
  }
  return input;
}

// Inspect every ancestor, including ancestors above the repository. Native realpath
// rejects spelling aliases on case-insensitive filesystems. No mkdir or repair.
function physical(input, kind, missing = false) {
  absolute(input);
  const parts = input.split(path.sep).filter(Boolean);
  let current = path.parse(input).root;
  for (let index = 0; index < parts.length; index++) {
    const parent = current;
    current = path.join(parent, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code === 'ENOENT' && missing && index === parts.length - 1) return null;
      throw error;
    }
    if (stat.isSymbolicLink() || fs.realpathSync.native(current) !== current) {
      fail('WORKER_PATH', 'Symlinks and path aliases are forbidden');
    }
    const directory = index < parts.length - 1 || kind === 'directory';
    if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) {
      fail('WORKER_PATH', 'Expected real directories and regular single-link files');
    }
    if (index === parts.length - 1) return stat;
  }
  fail('WORKER_PATH', 'A filesystem root is not a worker input');
}

// Shared admission primitives; adapters do not weaken the default actor path policy.
export { absolute as absoluteWorkerPath, physical as physicalWorkerPath };

const sameIdentity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const sameVersion = (a, b) => sameIdentity(a, b) && a.size === b.size
  && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && b.isFile() && b.nlink === 1;

// Hash and parse ONE captured buffer, never hash a pathname and then reread it.
// Exported so malformed fixture captures can be tested without editing the frozen fixture.
export function readPinnedJson(file, expectedSha256) {
  sha256(expectedSha256, 'input digest');
  const before = physical(file, 'file');
  if (before.size > MAX_JSON_BYTES) fail('WORKER_CAPACITY', 'JSON input exceeds capture capacity');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let bytes;
  try {
    if (!sameVersion(before, fs.fstatSync(fd))) fail('WORKER_PATH', 'JSON input changed before capture');
    bytes = fs.readFileSync(fd);
    if (bytes.length !== before.size || !sameVersion(before, fs.fstatSync(fd))
      || !sameVersion(before, physical(file, 'file'))) fail('WORKER_PATH', 'JSON input changed during capture');
  } finally { fs.closeSync(fd); }
  const actualSha256 = digest(bytes);
  if (actualSha256 !== expectedSha256) fail('WORKER_SHA256', 'JSON input SHA-256 mismatch');
  return { value: parseStrictJson(bytes), sha256: actualSha256 };
}

function loadInputs() {
  const [journalPath, owned] = process.argv.slice(2);
  if (process.argv.length !== 4) fail('WORKER_PATH', 'Expected only journal absolute path and owned test directory');
  absolute(journalPath); absolute(owned);
  const roundRoot = path.dirname(owned);
  if (path.dirname(roundRoot) !== rounds || !path.basename(roundRoot).startsWith('truthsrc-actors-')
    || path.basename(roundRoot) === 'truthsrc-actors-'
    || !path.basename(owned).startsWith('owner-b-application-') || path.basename(owned) === 'owner-b-application-'
    || journalPath !== path.join(owned, 'ta.jsonl')) fail('WORKER_PATH', 'Paths must belong to a direct actor round and application owner');
  const roundIdentity = physical(roundRoot, 'directory');
  const ownedIdentity = physical(owned, 'directory');
  const configFile = process.env.BANK_ACTOR_TA_CONFIG;
  const configSha256 = process.env.BANK_ACTOR_TA_CONFIG_SHA256;
  if (!configFile || !configSha256) fail('WORKER_CONFIG', 'BANK_ACTOR_TA_CONFIG and BANK_ACTOR_TA_CONFIG_SHA256 are required');
  absolute(configFile);
  // Configuration is a capture owned by this round, not an arbitrary historical input.
  if (!configFile.startsWith(roundRoot + path.sep)) fail('WORKER_PATH', 'Configuration must be captured inside this actor round');
  const { value: config } = readPinnedJson(configFile, configSha256);
  exactObject(config, ['schemaVersion', 'ownedRoot', 'fixture'], [], 'actor TA configuration');
  exactObject(config.fixture, ['file', 'sha256'], [], 'actor TA fixture reference');
  if (config.schemaVersion !== 'bank.truthsrc-actor-ta/v1' || config.ownedRoot !== roundRoot) {
    fail('WORKER_CONFIG', 'Actor TA schema or round ownership mismatch');
  }
  if (config.fixture.file !== fixtureFile) fail('WORKER_PATH', 'Only the fixed repository actor TA fixture is allowed');
  const captured = readPinnedJson(config.fixture.file, config.fixture.sha256);
  const fixture = captured.value;
  exactObject(fixture, ['schemaVersion', 'interpretation', 'source', 'configuration'], [], 'actor TA fixture');
  exactObject(fixture.source, ['file', 'pointer', 'sha256'], [], 'actor TA fixture provenance');
  sha256(fixture.source.sha256, 'historical source digest');
  if (fixture.schemaVersion !== 'bank.truthsrc-actor-ta-fixture/v1'
    || fixture.interpretation !== 'historical-frozen-test-fixture'
    || fixture.source.file !== sourceFile || fixture.source.pointer !== sourcePointer
    || !Array.isArray(fixture.configuration?.scenarios) || fixture.configuration.scenarios.length !== 7) {
    fail('WORKER_CONFIG', 'Expected the seven-scenario historical frozen test fixture');
  }
  physical(journalPath, 'file', true);
  physical(`${journalPath}.lock`, 'file', true);
  return { journalPath, owned, roundRoot, roundIdentity, ownedIdentity,
    receiptSchema: 'bank.truthsrc-actor-ta-worker/v1',
    configSha256, fixtureSha256: captured.sha256, configuration: fixture.configuration };
}

// Bound unfinished lines too: readline's post-line check would buffer an unlimited
// unterminated request. JSON/UTF-8/duplicate-key validation uses the same line bytes.
async function* requestLines(input) {
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      const size = pending.length + part.length;
      const last = part.length ? part.at(-1) : pending.at(-1);
      if (size > MAX_REQUEST_BYTES + (last === 13 ? 1 : 0)) fail('WORKER_CAPACITY', 'worker input capacity exceeded');
      pending = Buffer.concat([pending, part], size);
      if (newline === -1) break;
      yield pending.at(-1) === 13 ? pending.subarray(0, -1) : pending;
      pending = Buffer.alloc(0);
      start = newline + 1;
    }
  }
  if (pending.length) yield pending.at(-1) === 13 ? pending.subarray(0, -1) : pending;
}

const reply = (message) => new Promise((resolve, reject) => {
  process.stdout.write(`${canonicalJson(message)}\n`, (error) => error ? reject(error) : resolve());
});

// loadInputs is a trusted internal, synchronous admission callback, never supplied
// by JSON/argv. It returns validated paths/identities, pinned configuration and a
// fixed receiptSchema. Protocol, state machine and close attestation stay shared.
export async function runConfiguredWorker(loadInputs) {
  let ta;
  let closed = false;
  // Stream write errors are propagated by reply's callback rather than an uncaught event.
  process.stdout.on('error', () => {});
  try {
    const inputs = loadInputs();
    ta = new PersistentMockTACore({ configuration: inputs.configuration, journalPath: inputs.journalPath });
    const configurationDigest = digest(canonicalJson(ta.configuration));
    const receiptPath = path.join(inputs.owned, `ta-worker-${process.pid}.json`);
    const checkReceiptLocation = () => {
      if (!sameIdentity(inputs.roundIdentity, physical(inputs.roundRoot, 'directory'))
        || !sameIdentity(inputs.ownedIdentity, physical(inputs.owned, 'directory'))) {
        fail('WORKER_PATH', 'Actor round or owner directory changed before close');
      }
      if (physical(receiptPath, 'file', true)) fail('EEXIST', 'Exclusive worker receipt already exists');
    };
    const close = () => {
      if (closed) return;
      // A poisoned/identity-lost instance cannot issue a clean-close receipt.
      void ta.businessTick;
      checkReceiptLocation();
      ta.close();
      closed = true;
    };
    for await (const line of requestLines(process.stdin)) {
      const message = parseStrictJson(line);
      safeTick(message?.id, 'worker request sequence');
      try {
        exactObject(message, ['id', 'op', 'input'], [], 'worker request');
        let result;
        switch (message.op) {
          case 'submit': result = ta.submit(message.input); break;
          case 'query': result = ta.query(message.input); break;
          case 'advance': result = ta.advanceBusinessClock(message.input); break;
          case 'close': close(); result = { closed: true }; break;
          default: fail('WORKER_REQUEST', 'unknown worker operation');
        }
        await reply({ id: message.id, ok: true, result });
      } catch (error) {
        await reply({ id: message.id, ok: false, error: { code: error.code ?? 'WORKER_REQUEST', message: error.message } });
        if (message.op === 'close') throw error;
        // Request rejection is normal protocol traffic; journal poisoning is not.
        void ta.businessTick;
      }
      if (closed) break;
    }
    close();
    // Attest only after the protocol loop and all stdout callbacks succeeded.
    // In particular, a broken close-response pipe must not leave closed:true.
    checkReceiptLocation();
    fs.writeFileSync(receiptPath, `${canonicalJson({ schemaVersion: inputs.receiptSchema,
      pid: process.pid, journalPath: inputs.journalPath, ownedRoot: inputs.owned, roundRoot: inputs.roundRoot,
      configSha256: inputs.configSha256, fixtureSha256: inputs.fixtureSha256, configurationDigest, closed: true })}\n`,
    { flag: 'wx', mode: 0o600 });
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${error.code ?? 'WORKER_FAILURE'}: ${error.message}\n`);
    // Cleanup is not a clean-close attestation. Never remove an unknown/stale lock.
    try { ta?.close(); }
    catch (cleanup) { process.stderr.write(`WORKER_CLEANUP: ${cleanup.message}\n`); }
  } finally { process.stdin.destroy(); }
}

export async function runWorker() { return runConfiguredWorker(loadInputs); }

if (process.argv[1] === fileURLToPath(import.meta.url)) await runWorker();
