import {
  constants, openSync, closeSync, writeSync, fsyncSync, readFileSync, fstatSync,
  lstatSync, realpathSync, mkdirSync, unlinkSync, readSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonicalJson, clone, deepFreeze, digest, exactObject } from './contract.mjs';

export const MOCK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_JOURNAL = '.scratch/mock-ta/journal.jsonl';
export const JOURNAL_SCHEMA = 'bank-wealth.mock-ta-journal/v1';
export const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;

export class JournalError extends Error {
  constructor(message, code = 'JOURNAL_INVALID') {
    super(message);
    this.name = 'JournalError';
    this.code = code;
  }
}

const failPath = () => { throw new JournalError('Journal must be a nonsymlink file inside bank-wealth-demo/.scratch or .local/mock-ta', 'JOURNAL_PATH'); };
function statIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// Reject traversal, symlink components and existing hard-linked files, not just lexical escapes.
// This is a local workshop boundary, not protection against a malicious concurrent OS user.
export function resolveJournalPath(input = DEFAULT_JOURNAL) {
  if (typeof input !== 'string' || !input || input.includes('\0') || input.split(/[\\/]/).includes('..')) failPath();
  const path = isAbsolute(input) ? resolve(input) : resolve(MOCK_ROOT, input);
  const rel = relative(MOCK_ROOT, path);
  const parts = rel.split(sep);
  const allowed = (parts[0] === '.scratch' && parts.length >= 2)
    || (parts[0] === '.local' && parts[1] === 'mock-ta' && parts.length >= 3);
  if (!allowed || isAbsolute(rel) || parts.includes('..') || realpathSync(MOCK_ROOT) !== MOCK_ROOT) failPath();
  let directory = MOCK_ROOT;
  for (const part of parts.slice(0, -1)) {
    const parent = directory;
    directory = join(directory, part);
    let stat = statIfPresent(directory);
    if (!stat) {
      try { mkdirSync(directory, { mode: 0o700 }); syncDirectory(parent); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = lstatSync(directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) failPath();
  }
  for (const file of [path, `${path}.lock`]) {
    const stat = statIfPresent(file);
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== file)) failPath();
  }
  return path;
}

function writeComplete(fd, bytes, io) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = io.writeSync(fd, bytes, offset, bytes.length - offset, null);
    if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) throw new JournalError('Journal write did not make valid progress', 'JOURNAL_IO');
    offset += written;
  }
  io.fsyncSync(fd);
}

// Cleanup must never replace the diagnostic which caused construction/operation to fail.
export function attachCleanupError(primary, cleanup) {
  (primary.cleanupErrors ??= []).push(cleanup);
  return primary;
}

const sameFile = (stat, identity) => stat?.isFile() && !stat.isSymbolicLink()
  && stat.nlink === 1 && stat.dev === identity?.dev && stat.ino === identity?.ino;

// One canonical JSONL record per complete TA mutation (all receipts included).
// Integrity covers retained records only: deleting whole trailing records to a valid
// prefix is undetectable. No rollback watermark, automatic repair or crash lock stealing.
// After a crash, manually inspect the journal and prove no writer remains before removing
// its lock. Active journal rotation is unsupported. This synchronous whole-file replay is
// for bounded local demo workloads, not an unlimited-capacity store.
// O_EXCL is cooperative, NOT kernel/distributed fencing: identity checks detect sequential
// removal/replacement, not adversarial unlink/replacement check-to-write races. Hash chains
// do not authenticate an adversarial rewrite; fsync is not production power-loss certification.
export class Journal {
  #fd = null;
  #identity;
  #lockFd = null;
  #lockIdentity;
  #lockToken;
  #lockInitialized = false;
  #lockResolved = true;
  #directorySyncPending = false;
  #path;
  #configDigest;
  #records = [];
  #closed = false;
  #cleanupComplete = false;
  #poisoned = false;
  #io;
  #lockIO;

  // Journal write/barrier injection stays separate from native lock initialization.
  // Only filesystem callbacks are injectable; ownership tokens/identities stay private.
  constructor({ journalPath = DEFAULT_JOURNAL, configDigest, io = {}, validateReplay }) {
    if (typeof configDigest !== 'string' || !/^[a-f0-9]{64}$/.test(configDigest)) throw new JournalError('Invalid configuration digest');
    this.#configDigest = configDigest;
    this.#io = { writeSync, fsyncSync, closeSync, unlinkSync, ...io };
    this.#lockIO = { writeSync, fsyncSync, ...io.lock };
    this.#path = resolveJournalPath(journalPath);
    this.#lockToken = canonicalJson({ owner: randomUUID(), pid: process.pid });
    try {
      try { this.#lockFd = openSync(`${this.#path}.lock`, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new JournalError('MockTA journal already has a writer; locks are never automatically stolen', 'JOURNAL_LOCKED');
        throw error;
      }
      this.#lockResolved = false;
      this.#lockIdentity = fstatSync(this.#lockFd);
      writeComplete(this.#lockFd, Buffer.from(this.#lockToken), this.#lockIO);
      this.#lockInitialized = true;
      syncDirectory(dirname(this.#path));
      let created = false;
      try {
        this.#fd = openSync(this.#path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        created = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        this.#fd = openSync(this.#path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
      }
      this.#identity = fstatSync(this.#fd);
      if (!this.#identity.isFile() || this.#identity.nlink !== 1) failPath();
      if (this.#identity.size > MAX_JOURNAL_BYTES) throw new JournalError('Local demo journal exceeds 16 MiB replay capacity', 'JOURNAL_CAPACITY');
      if (created) syncDirectory(dirname(this.#path));
      this.assertUsable();
      const bytes = readFileSync(this.#fd);
      if (!bytes.length && !created) throw new JournalError('Existing journal is empty/incomplete; refusing to initialize over it');
      if (bytes.length) this.#replay(bytes);
      if (validateReplay) validateReplay(this.#records.map((record) => clone(record.event)));
      this.assertUsable();
      // A complete earlier append may not have passed fsync. Replay alone cannot
      // authorize a duplicate success: every reopen must pass a fresh journal barrier.
      if (!created) {
        try { this.#io.fsyncSync(this.#fd); }
        catch (cause) {
          const error = new JournalError('Reopened journal fsync failed; no recovered state was acknowledged', 'JOURNAL_IO');
          error.cause = cause;
          throw error;
        }
      }
      this.assertUsable();
    } catch (error) {
      try { this.close(); } catch (cleanup) { attachCleanupError(error, cleanup); }
      throw error;
    }
  }

  #replay(bytes) {
    let text;
    // ignoreBOM means preserve it in decoded text, so canonical comparison rejects it.
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new JournalError('Journal is not valid UTF-8'); }
    if (!text.endsWith('\n')) throw new JournalError('Journal has an incomplete trailing record/newline');
    for (const line of text.slice(0, -1).split('\n')) {
      let record;
      try {
        record = JSON.parse(line);
        exactObject(record, ['schemaVersion', 'seq', 'configDigest', 'previousHash', 'event', 'recordHash'], [], 'journal record');
        if (canonicalJson(record) !== line) throw new Error('noncanonical');
      } catch { throw new JournalError('Malformed or noncanonical journal record'); }
      if (record.schemaVersion !== JOURNAL_SCHEMA || !Number.isSafeInteger(record.seq) || record.seq !== this.#records.length + 1) {
        throw new JournalError('Journal schema or sequence mismatch');
      }
      if (record.configDigest !== this.#configDigest) throw new JournalError('Truth MockTA configuration changed since journal initialization', 'CONFIG_CHANGED');
      if (record.previousHash !== (this.#records.at(-1)?.recordHash ?? null)) throw new JournalError('Journal hash chain mismatch');
      const { recordHash, ...body } = record;
      if (recordHash !== digest(canonicalJson(body))) throw new JournalError('Journal record hash mismatch');
      this.#records.push(deepFreeze(record));
    }
  }

  // Open the pathname without following a symlink, then verify the opened inode too.
  // Partial-token rollback is permitted only while the acquired descriptor is held.
  #ownsLock(allowPrefix = false) {
    const path = `${this.#path}.lock`;
    const stat = statIfPresent(path);
    if (!sameFile(stat, this.#lockIdentity) || realpathSync(path) !== path) return false;
    if (this.#lockFd !== null && !sameFile(fstatSync(this.#lockFd), this.#lockIdentity)) return false;
    if (allowPrefix && this.#lockFd === null) return false;
    const token = Buffer.from(this.#lockToken);
    if (stat.size > token.length) return false;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (!sameFile(opened, this.#lockIdentity) || opened.size > token.length) return false;
      const bytes = readFileSync(fd);
      if (allowPrefix) {
        // Prove the path and held acquisition descriptor contain our empty/prefix token.
        const heldStat = fstatSync(this.#lockFd);
        if (heldStat.size !== bytes.length) return false;
        const held = Buffer.alloc(bytes.length);
        if (readSync(this.#lockFd, held, 0, held.length, 0) !== held.length) return false;
        return bytes.equals(held) && bytes.length <= token.length && bytes.equals(token.subarray(0, bytes.length));
      }
      return bytes.equals(token);
    } finally { closeSync(fd); }
  }

  get path() { return this.#path; }
  get events() {
    this.assertUsable();
    const events = this.#records.map((record) => clone(record.event));
    this.assertUsable();
    return events;
  }
  assertUsable() {
    if (this.#closed) throw new JournalError('MockTA journal is closed', 'JOURNAL_CLOSED');
    if (this.#poisoned) throw new JournalError('MockTA journal is poisoned after I/O or identity failure; close and inspect before reopening', 'JOURNAL_POISONED');
    try {
      if (!sameFile(fstatSync(this.#fd), this.#identity) || !sameFile(statIfPresent(this.#path), this.#identity)
        || realpathSync(this.#path) !== this.#path || !this.#ownsLock()) {
        throw new Error('Journal pathname/inode or writer lock identity/token no longer matches');
      }
    } catch (cause) {
      this.#poisoned = true;
      const error = new JournalError('Live journal or lock was removed/replaced; instance is poisoned', 'JOURNAL_IDENTITY');
      error.cause = cause;
      throw error;
    }
  }

  append(event) {
    this.assertUsable();
    if (!Number.isSafeInteger(this.#records.length + 1)) throw new JournalError('Journal sequence exhausted');
    const body = { schemaVersion: JOURNAL_SCHEMA, seq: this.#records.length + 1, configDigest: this.#configDigest,
      previousHash: this.#records.at(-1)?.recordHash ?? null, event: clone(event) };
    const record = deepFreeze({ ...body, recordHash: digest(canonicalJson(body)) });
    const bytes = Buffer.from(`${canonicalJson(record)}\n`);
    if (fstatSync(this.#fd).size + bytes.length > MAX_JOURNAL_BYTES) throw new JournalError('Local demo journal would exceed 16 MiB replay capacity; mutation not acknowledged', 'JOURNAL_CAPACITY');
    this.assertUsable();
    try { writeComplete(this.#fd, bytes, this.#io); }
    catch (cause) {
      this.#poisoned = true;
      const error = new JournalError('Journal write/fsync failed; mutation was not acknowledged and instance is poisoned', 'JOURNAL_IO');
      error.cause = cause;
      throw error;
    }
    this.assertUsable();
    // Mutation visible in memory only after all bytes, fsync and identity checks succeed.
    this.#records.push(record);
  }

  close() {
    this.#closed = true;
    if (this.#cleanupComplete) return;
    let failure;
    const failed = (error) => { if (failure) attachCleanupError(failure, error); else failure = error; };
    if (this.#fd !== null) {
      const fd = this.#fd;
      // A throwing close may already have released/reused the fd. Never close it again.
      this.#fd = null;
      try { this.#io.closeSync(fd); } catch (error) { failed(error); }
    }
    if (!this.#lockResolved) {
      try {
        if (this.#ownsLock(!this.#lockInitialized)) {
          this.#io.unlinkSync(`${this.#path}.lock`);
          this.#directorySyncPending = true;
        }
        // Missing, preexisting/replacement or unknown-content locks are never ours to delete.
        this.#lockResolved = true;
      } catch (error) { failed(error); }
    }
    if (this.#lockFd !== null) {
      const fd = this.#lockFd;
      this.#lockFd = null;
      try { this.#io.closeSync(fd); } catch (error) { failed(error); }
    }
    if (this.#directorySyncPending) {
      try { syncDirectory(dirname(this.#path)); this.#directorySyncPending = false; }
      catch (error) { failed(error); }
    }
    this.#cleanupComplete = this.#lockResolved && !this.#directorySyncPending;
    if (failure) throw failure;
  }
}
