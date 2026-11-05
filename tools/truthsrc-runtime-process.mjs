import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fchmodSync, fsyncSync, ftruncateSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

const SANDBOX = '/usr/bin/sandbox-exec', GRACE_MS = 15_000, REAP_MS = 5_000, MAX_OUTPUT = 16 * 1024 * 1024;
const delay = ms => new Promise(done => setTimeout(done, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = (ok, message) => { if (!ok) throw new Error(message); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const writeAll = (fd, bytes) => { for (let n = 0; n < bytes.length;) n += writeSync(fd, bytes, n, bytes.length - n); };

// Retain raw lookahead ONLY in memory. Mask overlapping matches, including a
// truncated secret prefix at EOF, before any bytes reach the evidence descriptor.
function redactor(secrets, emit) {
  let pending = Buffer.alloc(0), pendingMask = Buffer.alloc(0);
  const lookahead = Math.max(1, ...secrets.map(s => s.length)) - 1;
  return (chunk, final = false) => {
    const data = Buffer.concat([pending, chunk]), end = final ? data.length : Math.max(0, data.length - lookahead);
    const mask = Buffer.alloc(data.length); pendingMask.copy(mask);
    for (const secret of secrets) {
      for (let at = data.indexOf(secret); at >= 0; at = data.indexOf(secret, at + 1)) mask.fill(1, at, at + secret.length);
      if (final) for (let n = Math.min(secret.length - 1, data.length); n > 0; n--)
        if (data.subarray(data.length - n).equals(secret.subarray(0, n))) { mask.fill(1, data.length - n); break; }
    }
    const pieces = [], visibleMask = mask.subarray(0, end);
    let cursor = 0;
    for (let at = visibleMask.indexOf(1); at >= 0; at = visibleMask.indexOf(1, cursor)) {
      pieces.push(data.subarray(cursor, at), Buffer.from('[REDACTED]'));
      const next = visibleMask.indexOf(0, at); cursor = next < 0 ? end : next;
    }
    pieces.push(data.subarray(cursor, end)); emit(Buffer.concat(pieces));
    pending = Buffer.from(data.subarray(end)); pendingMask = Buffer.from(mask.subarray(end));
  };
}

/**
 * runRuntimeProcess({executable, args=[], cwd, env, base, timeoutMs, sandbox,
 *   secrets=[], onStarted?, expectedSignal=null, signal?}) -> frozen receipt.
 * sandbox: {executable:'/usr/bin/sandbox-exec', profile, profileSha256}.
 * base reserves .stdout.log/.stderr.log/.json with wx BEFORE spawn; never reuse.
 * env is explicit (not inherited); only envKeys are recorded. No secret in argv
 * or metadata. The verified profile bytes are passed with -p (no file TOCTOU).
 * onStarted({pid, signal, exited(), killMain(signal='SIGKILL'), waitForFile(path,ms)})
 * must honor signal; helpers are revoked on settlement/abort. waitForFile returns
 * a regular file's absolute path, NOT its contents or proof of barrier validity.
 * Expected termination additionally requires a successful callback/killMain call.
 * Failure returns passed:false; invalid admission/evidence I/O throws fixed errors.
 * A noncooperative callback is bounded by timeout/cleanup and recorded unsettled.
 */
export async function runRuntimeProcess({ executable, args = [], cwd, env, base, timeoutMs, sandbox,
  secrets = [], onStarted, expectedSignal = null, descendantExitGraceMs = 0, signal: cancellation } = {}) {
  require(process.platform === 'darwin' && sandbox?.executable === SANDBOX, 'OS sandbox required');
  require(Array.isArray(secrets) && secrets.every(s => typeof s === 'string' && s.length > 0 && Buffer.byteLength(s) <= 65536), 'invalid secrets');
  require([executable, cwd, base, sandbox.profile].every(p => typeof p === 'string' && isAbsolute(p) && resolve(p) === p && !p.includes('\0')), 'absolute paths required');
  require(Array.isArray(args) && args.every(s => typeof s === 'string' && !s.includes('\0')), 'string argv required');
  require(env && typeof env === 'object' && Object.entries(env).every(([k, v]) => k && !/[=\0]/.test(k) && typeof v === 'string' && !v.includes('\0')), 'explicit string environment required');
  require(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647, 'bounded timeout required');
  require(expectedSignal === null || (typeof expectedSignal === 'string' && constants.signals[expectedSignal] > 0), 'invalid expected signal');
  require(Number.isInteger(descendantExitGraceMs) && descendantExitGraceMs >= 0 && descendantExitGraceMs <= 10_000 &&
    (descendantExitGraceMs === 0 || expectedSignal === 'SIGKILL'), 'descendant grace requires an explicit crash signal');
  require(onStarted === undefined || typeof onStarted === 'function', 'invalid callback');
  require(cancellation === undefined || cancellation instanceof AbortSignal, 'invalid cancellation signal');
  let profile;
  try {
    require(realpathSync(dirname(base)) === dirname(base) && realpathSync(sandbox.profile) === sandbox.profile, 'canonical evidence/profile paths required');
    profile = readFileSync(sandbox.profile, 'utf8');
  } catch { throw new Error('runtime evidence/profile admission failed'); }
  const profilePath = sandbox.profile, profileSha256 = hash(profile);
  require(profileSha256 === sandbox.profileSha256, 'sandbox profile hash mismatch');
  const command = freeze([SANDBOX, '-p', profile, executable, ...args]), childEnv = { NODE_V8_COVERAGE: '', ...env }, envKeys = Object.keys(childEnv).sort();
  const paths = { stdout: base + '.stdout.log', stderr: base + '.stderr.log', receipt: base + '.json' };
  require(![...command, cwd, ...Object.values(paths), profilePath, ...envKeys].some(text => secrets.some(secret => text.includes(secret))), 'secret forbidden in argv or metadata');
  const buffers = [...new Set(secrets)].map(s => Buffer.from(s)), fds = [];
  const started = Date.now(), abort = new AbortController(), terminationErrors = [], groupSignals = [], mainSignals = [];
  let child, pid = null, exited = false, closed = false, groupGone = false, leftoverGroup = false, stopPromise, timer, descendantDrain;
  let code = null, exitSignal = null, launchError = null, timedOut = false, cancelled = null, outputLimitExceeded = false;
  let rawBytes = 0, logBytes = 0, outputError = false, active = false, sandboxProfileUnchanged = false;
  const barrier = { status: onStarted ? 'not-started' : 'not-requested', settled: !onStarted, error: null };
  const groupAlive = () => {
    if (!pid || groupGone) return false;
    try { process.kill(-pid, 0); return true; }
    catch (error) {
      if (error.code === 'ESRCH') { groupGone = true; return false; }
      if (error.code === 'EPERM') return true;
      terminationErrors.push('group-probe-failed'); return true;
    }
  };
  const sendGroup = sig => {
    if (!groupAlive()) return;
    try { process.kill(-pid, sig); groupSignals.push({ signal: sig, at: new Date().toISOString() }); }
    catch (error) { if (error.code !== 'ESRCH') terminationErrors.push('group-signal-failed'); }
  };
  const stop = () => {
    if (stopPromise) return stopPromise;
    active = false;
    if (barrier.status === 'running') barrier.status = 'aborted';
    stopPromise = Promise.resolve().then(async () => {
      abort.abort();
      sendGroup('SIGTERM');
      const until = Date.now() + GRACE_MS;
      while (pid && (!closed || groupAlive()) && Date.now() < until) await delay(25);
      if (pid && (!closed || groupAlive())) {
        sendGroup('SIGKILL');
        const reapUntil = Date.now() + REAP_MS;
        while ((!closed || groupAlive()) && Date.now() < reapUntil) await delay(25);
      }
    });
    return stopPromise;
  };
  const cancel = why => { cancelled ??= why; void stop(); };
  const onAbort = () => cancel('AbortSignal'), onInt = () => cancel('SIGINT'), onTerm = () => cancel('SIGTERM');
  const control = () => require(active && !abort.signal.aborted, 'runtime callback control is closed');
  const api = Object.freeze({
    get pid() { return pid; }, signal: abort.signal, exited: () => exited,
    killMain(sig = 'SIGKILL') {
      control(); require(typeof sig === 'string' && constants.signals[sig] > 0, 'invalid main signal');
      require(!exited && !!child?.pid, 'main child already exited');
      const sent = child.kill(sig); mainSignals.push({ signal: sig, sent, at: new Date().toISOString() });
      require(sent, 'main child signal failed'); return sent;
    },
    async waitForFile(path, ms) {
      require(typeof path === 'string' && isAbsolute(path) && Number.isSafeInteger(ms) && ms > 0, 'invalid barrier wait');
      const until = Date.now() + ms;
      for (;;) {
        control();
        try { require(statSync(path).isFile(), 'barrier is not a regular file'); return path; }
        catch (error) { if (error.code !== 'ENOENT') throw new Error('barrier file unavailable'); }
        require(!exited, 'main exited before barrier'); require(Date.now() < until, 'barrier wait timed out');
        await delay(Math.min(25, Math.max(1, until - Date.now())));
      }
    },
  });
  try {
    try { for (const path of Object.values(paths)) fds.push(openSync(path, 'wx', 0o600)); }
    catch { throw new Error('runtime evidence reservation failed'); }
    if (cancellation) cancellation.addEventListener('abort', onAbort, { once: true });
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
    if (cancellation?.aborted) cancel('AbortSignal');
    if (!cancelled) {
      timer = setTimeout(() => {
        if (closed && barrier.settled && !groupAlive()) return;
        timedOut = true; void stop();
      }, timeoutMs);
      try {
        child = spawn(SANDBOX, command.slice(1), { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        pid = child.pid ?? null;
        child.once('error', () => { launchError = 'spawn-failed'; void stop(); });
        child.once('exit', (c, s) => {
          exited = true; code = c; exitSignal = s;
          if (groupAlive() && descendantExitGraceMs && exitSignal === expectedSignal && mainSignals.some(row => row.sent && row.signal === expectedSignal)) {
            descendantDrain = (async () => {
              const until = Date.now() + descendantExitGraceMs;
              while (groupAlive() && Date.now() < until && !stopPromise) await delay(25);
              if (groupAlive()) { leftoverGroup = true; await stop(); }
            })();
          } else {
            leftoverGroup = groupAlive();
            if (leftoverGroup) void stop();
          }
        });
        child.once('close', (c, s) => { closed = true; code = c; exitSignal = s; });
        for (const [index, stream] of [child.stdout, child.stderr].entries()) {
          const redact = redactor(buffers, bytes => {
            if (bytes.length > MAX_OUTPUT - logBytes) { outputLimitExceeded = true; void stop(); }
            const safe = bytes.subarray(0, MAX_OUTPUT - logBytes); writeAll(fds[index], safe); logBytes += safe.length;
          });
          const consume = (chunk, final = false) => {
            const remaining = Math.max(0, MAX_OUTPUT - rawBytes); rawBytes += chunk.length;
            if (rawBytes > MAX_OUTPUT) { outputLimitExceeded = true; void stop(); }
            try { redact(chunk.subarray(0, remaining), final); }
            catch { outputError = true; void stop(); }
          };
          stream.on('data', consume); stream.once('end', () => consume(Buffer.alloc(0), true));
          stream.once('error', () => { outputError = true; void stop(); });
        }
        child.once('spawn', () => {
          if (!onStarted || abort.signal.aborted) return;
          active = true; barrier.status = 'running';
          Promise.resolve().then(() => { control(); return onStarted(api); }).then(() => {
            if (active) barrier.status = 'passed';
            active = false; barrier.settled = true;
          }, () => {
            const failed = active;
            active = false; barrier.settled = true;
            if (failed) { barrier.status = 'failed'; barrier.error = 'onStarted callback failed'; void stop(); }
          });
        });
      } catch { launchError = 'spawn-failed'; void stop(); }
      while (!closed || !barrier.settled) {
        if (stopPromise) { await stopPromise; break; }
        await delay(25);
      }
    }
  } finally {
    if (descendantDrain) await descendantDrain;
    if (groupAlive() || (pid && !closed)) await stop();
    if (stopPromise) await stopPromise;
    // Let pending local INT/TERM events run before sealing the cancellation fact.
    await new Promise(done => setImmediate(done)); await delay(0);
    if (stopPromise) await stopPromise;
    active = false; abort.abort(); clearTimeout(timer);
    if (cancellation) cancellation.removeEventListener('abort', onAbort);
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    if (fds.length !== 3) for (const fd of fds) closeSync(fd);
  }
  try {
    try { sandboxProfileUnchanged = hash(readFileSync(profilePath)) === profileSha256; } catch { /* fail closed */ }
    const groupAliveAfter = groupAlive(), directChildReaped = exited && closed && !launchError;
    const expectedTermination = expectedSignal === null ? code === 0 && exitSignal === null :
      code === null && exitSignal === expectedSignal && mainSignals.some(s => s.sent && s.signal === expectedSignal) && barrier.status === 'passed';
    const passed = !!(pid && directChildReaped && expectedTermination && !timedOut && !cancelled && !launchError &&
      !leftoverGroup && !groupAliveAfter && !terminationErrors.length && !outputLimitExceeded && !outputError && sandboxProfileUnchanged &&
      barrier.settled && ['passed', 'not-requested'].includes(barrier.status));
    const receipt = freeze({ schemaVersion: 'bank.truthsrc-runtime-process/v1', passed, status: passed ? 'passed' : 'failed',
      command, commandSha256: hash(JSON.stringify(command)), cwd, envKeys, sandboxProfile: profilePath, sandboxProfileSha256: profileSha256,
      sandboxProfileUnchanged, pid, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      timeoutMs, graceMs: GRACE_MS, reapMs: REAP_MS, descendantExitGraceMs, maxOutputBytes: MAX_OUTPUT, code, signal: exitSignal, expectedSignal,
      expectedTermination, launchError, timedOut, cancelled, barrier: { ...barrier }, mainSignals, groupSignals, terminationErrors,
      directChildClosed: closed, directChildReaped, leftoverGroup, groupAliveAfter, rawOutputBytes: rawBytes, outputLimitExceeded, outputError,
      paths, stdoutSha256: hash(readFileSync(paths.stdout)), stderrSha256: hash(readFileSync(paths.stderr)) });
    for (const fd of fds.slice(0, 2)) { fsyncSync(fd); fchmodSync(fd, 0o400); }
    fchmodSync(fds[2], 0o400);
    writeAll(fds[2], Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
    fsyncSync(fds[2]);
    return receipt;
  } catch {
    try { ftruncateSync(fds[2], 0); fsyncSync(fds[2]); } catch { /* caller still fails; partial evidence is never accepted */ }
    throw new Error('runtime evidence finalization failed');
  }
  finally { for (const fd of fds) closeSync(fd); }
}
