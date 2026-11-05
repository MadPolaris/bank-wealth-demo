import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRuntimeProcess } from '../tools/truthsrc-runtime-process.mjs';

const root = mkdtempSync(join(realpathSync(tmpdir()), 'truthsrc-runtime-process-'));
const node = realpathSync(process.execPath), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(done => setTimeout(done, ms));
const options = { skip: process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'), timeout: 25_000 };
const common = `import { existsSync, writeFileSync } from 'node:fs';
const root = process.env.FIXTURE_ROOT;
const mark = (name, text = '') => writeFileSync(root + '/' + name, text, {flag:'wx'});
`;
const idle = `mark('ready', String(process.pid)); setInterval(() => {}, 1000);`;
let sequence = 0;
function fixture(t, source = '') {
  const dir = join(root, String(++sequence)); mkdirSync(dir, { mode: 0o700 });
  const script = join(dir, 'child.mjs'), profile = join(dir, 'sandbox.sb'), base = join(dir, 'run');
  const text = '(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n' +
    '(allow file-write* (subpath ' + JSON.stringify(dir) + ') (literal "/dev/null"))\n' +
    '(deny file-write* ' + [profile, base + '.stdout.log', base + '.stderr.log', base + '.json'].map(p => '(literal ' + JSON.stringify(p) + ')').join(' ') + ')\n';
  writeFileSync(profile, text, { flag: 'wx', mode: 0o600 });
  writeFileSync(script, common + source, { flag: 'wx', mode: 0o600 });
  return { executable: node, args: [script], cwd: dir, env: { FIXTURE_ROOT: dir, HOME: dir, TMPDIR: dir, PATH: '/usr/bin:/bin' },
    base, timeoutMs: 3000, sandbox: { executable: '/usr/bin/sandbox-exec', profile, profileSha256: hash(text) }, signal: t.signal };
}
function checked(receipt) {
  assert.deepEqual(JSON.parse(readFileSync(receipt.paths.receipt, 'utf8')), receipt);
  assert.equal(receipt.commandSha256, hash(JSON.stringify(receipt.command)));
  assert.equal(receipt.stdoutSha256, hash(readFileSync(receipt.paths.stdout)));
  assert.equal(receipt.stderrSha256, hash(readFileSync(receipt.paths.stderr)));
  assert.equal(Object.hasOwn(receipt, 'env'), false);
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.command) && Object.isFrozen(receipt.barrier));
  assert.ok(Date.parse(receipt.endedAt) >= Date.parse(receipt.startedAt));
  assert.equal(receipt.groupAliveAfter, false);
  if (receipt.pid) {
    assert.equal(receipt.directChildClosed, true); assert.equal(receipt.directChildReaped, true);
    assert.throws(() => process.kill(-receipt.pid, 0), { code: 'ESRCH' });
  }
  for (const file of Object.values(receipt.paths)) assert.equal(statSync(file).mode & 0o777, 0o400);
  return receipt;
}

test('normal zero exit waits for the callback/barrier and seals immutable evidence', options, async t => {
  const f = fixture(t, `mark('ready', String(process.pid));
const tick = setInterval(() => { if (existsSync(root + '/stop')) { clearInterval(tick); console.log('normal done'); } }, 10);`);
  let handle;
  const receipt = checked(await runRuntimeProcess({ ...f, onStarted: async api => {
    handle = api; assert.equal(api.exited(), false);
    const ready = await api.waitForFile(join(f.cwd, 'ready'), 1500);
    assert.equal(Number(readFileSync(ready, 'utf8')), api.pid);
    assert.ok(Object.values({ stdout: f.base + '.stdout.log', stderr: f.base + '.stderr.log', receipt: f.base + '.json' }).every(existsSync));
    writeFileSync(join(f.cwd, 'stop'), '', { flag: 'wx' });
    await delay(100); // Main may close first; callback completion is still required.
  } }));
  assert.equal(receipt.passed, true); assert.equal(receipt.code, 0);
  assert.equal(receipt.barrier.status, 'passed'); assert.equal(receipt.barrier.settled, true);
  assert.deepEqual(receipt.groupSignals, []); assert.deepEqual(receipt.envKeys, [...Object.keys(f.env), 'NODE_V8_COVERAGE'].sort());
  assert.equal(readFileSync(receipt.paths.stdout, 'utf8'), 'normal done\n');
  assert.equal(handle.exited(), true); assert.throws(() => handle.killMain(), /control is closed/);
  assert.throws(() => receipt.command.push('changed'), TypeError);
});

test('nonzero exit cannot pass', options, async t => {
  const receipt = checked(await runRuntimeProcess(fixture(t, 'process.exitCode = 7;')));
  assert.equal(receipt.code, 7); assert.equal(receipt.passed, false); assert.equal(receipt.timedOut, false);
});

test('validated barrier can SIGKILL only the captured main child, with no group kill', options, async t => {
  const f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, expectedSignal: 'SIGKILL', onStarted: async api => {
    const ready = await api.waitForFile(join(f.cwd, 'ready'), 1500);
    assert.equal(Number(readFileSync(ready)), api.pid);
    assert.equal(api.killMain('SIGKILL'), true);
  } }));
  assert.equal(receipt.passed, true); assert.equal(receipt.signal, 'SIGKILL'); assert.equal(receipt.code, null);
  assert.equal(receipt.expectedTermination, true); assert.deepEqual(receipt.groupSignals, []);
  assert.deepEqual(receipt.mainSignals.map(s => [s.signal, s.sent]), [['SIGKILL', true]]);
});

for (const source of ['', "process.kill(process.pid, 'SIGKILL');"])
  test('missing targeted expected termination fails: ' + (source ? 'self-kill' : 'zero exit'), options, async t => {
    const receipt = checked(await runRuntimeProcess({ ...fixture(t, source), expectedSignal: 'SIGKILL', onStarted: () => {} }));
    assert.equal(receipt.passed, false); assert.equal(receipt.expectedTermination, false); assert.deepEqual(receipt.mainSignals, []);
  });

test('timeout interrupts a waiting barrier and reaps before returning', options, async t => {
  const f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, timeoutMs: 350, onStarted: api => api.waitForFile(join(f.cwd, 'absent'), 5000) }));
  assert.equal(receipt.passed, false); assert.equal(receipt.timedOut, true); assert.equal(receipt.barrier.status, 'aborted');
  assert.equal(receipt.barrier.settled, true); assert.equal(receipt.groupSignals[0].signal, 'SIGTERM');
});

test('TERM-resistant child escalates after 15 seconds; timeout SIGKILL is not expected success', options, async t => {
  const f = fixture(t, `process.on('SIGTERM', () => {}); ${idle}`);
  const receipt = checked(await runRuntimeProcess({ ...f, timeoutMs: 1000, expectedSignal: 'SIGKILL', onStarted: api => api.waitForFile(join(f.cwd, 'ready'), 750) }));
  assert.equal(receipt.timedOut, true); assert.equal(receipt.signal, 'SIGKILL'); assert.equal(receipt.passed, false);
  assert.equal(receipt.expectedTermination, false);
  assert.deepEqual(receipt.groupSignals.map(s => s.signal), ['SIGTERM', 'SIGKILL']);
  assert.ok(Date.parse(receipt.groupSignals[1].at) - Date.parse(receipt.groupSignals[0].at) >= 15_000);
  assert.ok(receipt.elapsedMs < 23_000);
});

test('callback failure is sanitized and terminates the group, even with secret error text', options, async t => {
  const secret = 'callback-only-sensitive-value-832957';
  const f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, secrets: [secret], onStarted: async api => {
    await api.waitForFile(join(f.cwd, 'ready'), 1500); throw new Error(secret);
  } }));
  assert.equal(receipt.passed, false); assert.equal(receipt.barrier.status, 'failed');
  assert.equal(receipt.barrier.error, 'onStarted callback failed'); assert.equal(receipt.timedOut, false);
  for (const file of Object.values(receipt.paths)) assert.ok(!readFileSync(file, 'utf8').includes(secret));
});

test('late callback failure after zero exit still fails', options, async t => {
  const receipt = checked(await runRuntimeProcess({ ...fixture(t), onStarted: async () => { await delay(150); throw new Error('late'); } }));
  assert.equal(receipt.code, 0); assert.equal(receipt.passed, false); assert.equal(receipt.barrier.status, 'failed');
});

test('uncooperative callback is revoked and recorded unsettled rather than hanging', options, async t => {
  const receipt = checked(await runRuntimeProcess({ ...fixture(t, idle), timeoutMs: 300, onStarted: () => new Promise(() => {}) }));
  assert.equal(receipt.timedOut, true); assert.equal(receipt.passed, false); assert.equal(receipt.barrier.settled, false);
});

test('leftover child inheriting stdout is terminated without waiting for pipe close', options, async t => {
  const f = fixture(t, `import { spawn } from 'node:child_process';
const worker = "const fs = require('fs'); const root = process.env.FIXTURE_ROOT; process.on('SIGTERM', () => { fs.writeFileSync(root + '/worker-term', 'yes', {flag:'wx'}); process.exit(0); }); fs.writeFileSync(root + '/worker-ready', String(process.pid), {flag:'wx'}); setInterval(() => {}, 1000);";
spawn(process.execPath, ['-e', worker], { env: process.env, stdio: 'inherit' });
setInterval(() => { if (existsSync(root + '/worker-ready')) process.exit(0); }, 10);`);
  const receipt = checked(await runRuntimeProcess(f));
  assert.equal(receipt.code, 0); assert.equal(receipt.passed, false); assert.equal(receipt.leftoverGroup, true);
  assert.equal(receipt.timedOut, false); assert.deepEqual(receipt.groupSignals.map(s => s.signal), ['SIGTERM']);
  assert.equal(readFileSync(join(f.cwd, 'worker-term'), 'utf8'), 'yes');
});

for (const kind of ['executable', 'cwd']) test('missing launch ' + kind + ' produces failing evidence', options, async t => {
  const f = fixture(t); f[kind] = join(f.cwd, 'missing');
  const receipt = checked(await runRuntimeProcess(f));
  assert.equal(receipt.passed, false);
  if (kind === 'cwd') assert.equal(receipt.launchError, 'spawn-failed');
  else assert.notEqual(receipt.code, 0);
});

test('stream redaction precedes disk, spans chunks/UTF-8/overlaps, and hides truncated EOF', options, async t => {
  const secret = 'SENSITIVE_秘密_alpha_beta_928357';
  const f = fixture(t, `const bytes = Buffer.from(process.env.TOKEN), cut = 12;
await new Promise(done => process.stdout.write(Buffer.concat([Buffer.from('before\\n'), bytes.subarray(0, cut)]), done));
await new Promise(done => process.stderr.write(bytes.subarray(0, cut), done)); mark('prefix');
await new Promise(done => { const tick = setInterval(() => { if (existsSync(root + '/continue')) { clearInterval(tick); done(); } }, 10); });
process.stdout.write(Buffer.concat([bytes.subarray(cut), Buffer.from(' suffix\\nabcdefghi\\n')]));
process.stderr.write(Buffer.concat([bytes.subarray(cut), Buffer.from(' suffix\\n')]));
process.stdout.write(bytes.subarray(0, cut));`);
  f.env.TOKEN = secret; f.env.UNLOGGED = 'unlogged-env-value-319837';
  const receipt = checked(await runRuntimeProcess({ ...f, secrets: [secret, 'abcdef', 'defghi'], onStarted: async api => {
    await api.waitForFile(join(f.cwd, 'prefix'), 1500); await delay(60);
    for (const path of [f.base + '.stdout.log', f.base + '.stderr.log']) assert.ok(!readFileSync(path, 'utf8').includes('SENSITIVE_'));
    writeFileSync(join(f.cwd, 'continue'), '', { flag: 'wx' });
  } }));
  assert.equal(receipt.passed, true);
  for (const file of Object.values(receipt.paths)) {
    const text = readFileSync(file, 'utf8');
    for (const value of [secret, f.env.UNLOGGED, 'SENSITIVE_']) assert.ok(!text.includes(value));
  }
  for (const file of [receipt.paths.stdout, receipt.paths.stderr]) {
    const text = readFileSync(file, 'utf8'); assert.match(text, /\[REDACTED\]/); assert.match(text, / suffix\n/);
    for (const fragment of ['秘密', 'alpha_beta', '928357', 'abc', 'def', 'ghi']) assert.ok(!text.includes(fragment));
  }
});

for (const stream of ['stdout', 'stderr']) test(stream + ' output cap fails and terminates instead of storing unlimited output', options, async t => {
  const f = fixture(t, `import { once } from 'node:events';
const bytes = Buffer.alloc(65536, 120);
for (let i = 0; i < 300; i++) if (!process.${stream}.write(bytes)) await once(process.${stream}, 'drain');
setInterval(() => {}, 1000);`);
  const receipt = checked(await runRuntimeProcess(f));
  assert.equal(receipt.passed, false); assert.equal(receipt.outputLimitExceeded, true); assert.equal(receipt.timedOut, false);
  assert.ok(statSync(receipt.paths.stdout).size + statSync(receipt.paths.stderr).size <= 16 * 1024 * 1024);
});

test('AbortSignal cancellation is local and never records its reason', options, async t => {
  const controller = new AbortController(), secret = 'abort-reason-sensitive-123874';
  const f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, signal: controller.signal, secrets: [secret], onStarted: async api => {
    await api.waitForFile(join(f.cwd, 'ready'), 1500); controller.abort(new Error(secret));
  } }));
  assert.equal(receipt.passed, false); assert.equal(receipt.cancelled, 'AbortSignal'); assert.equal(receipt.timedOut, false);
  assert.ok(!JSON.stringify(receipt).includes(secret));
  assert.equal(checked(await runRuntimeProcess(fixture(t))).passed, true);
});

test('pre-aborted invocation reserves evidence but launches nothing', options, async t => {
  const controller = new AbortController(); controller.abort();
  const f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, signal: controller.signal }));
  assert.equal(receipt.passed, false); assert.equal(receipt.pid, null); assert.equal(receipt.cancelled, 'AbortSignal');
  assert.equal(existsSync(join(f.cwd, 'ready')), false);
});

for (const sig of ['SIGINT', 'SIGTERM']) test('local ' + sig + ' handler cancels and is removed afterwards', options, async t => {
  const before = process.listeners(sig), f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, signal: undefined, onStarted: async api => {
    await api.waitForFile(join(f.cwd, 'ready'), 1500); process.kill(process.pid, sig);
  } }));
  assert.equal(receipt.passed, false); assert.equal(receipt.cancelled, sig);
  assert.deepEqual(process.listeners(sig), before);
});

test('profile hash mismatch and non-sandbox wrapper are rejected before creating output', options, async t => {
  for (const change of [s => { s.profileSha256 = '0'.repeat(64); }, s => { s.executable = node; }]) {
    const f = fixture(t, idle); change(f.sandbox);
    await assert.rejects(runRuntimeProcess(f), /sandbox/);
    assert.equal(existsSync(f.base + '.stdout.log'), false); assert.equal(existsSync(join(f.cwd, 'ready')), false);
  }
});

test('argv secrets are rejected without exposing their value or creating evidence', options, async t => {
  const f = fixture(t, idle), secret = 'argv-sensitive-293875'; f.args.push(secret);
  await assert.rejects(runRuntimeProcess({ ...f, secrets: [secret] }), error => {
    assert.match(error.message, /secret forbidden/); assert.ok(!error.message.includes(secret)); return true;
  });
  assert.equal(existsSync(f.base + '.json'), false);
});

test('profile mutation fails final checks; caller mutation cannot change command/envKeys snapshots', options, async t => {
  const f = fixture(t), originalArgs = [...f.args], originalKeys = [...Object.keys(f.env), 'NODE_V8_COVERAGE'].sort();
  const receipt = checked(await runRuntimeProcess({ ...f, onStarted: () => {
    f.args.push('changed'); f.env.ADDED = 'never recorded'; f.sandbox.profileSha256 = 'changed';
    writeFileSync(f.sandbox.profile, '\n', { flag: 'a' });
  } }));
  assert.equal(receipt.passed, false); assert.equal(receipt.sandboxProfileUnchanged, false);
  assert.deepEqual(receipt.command.slice(4), originalArgs); assert.deepEqual(receipt.envKeys, originalKeys);
  assert.equal(hash(receipt.command[2]), receipt.sandboxProfileSha256); assert.equal(receipt.command[1], '-p');
});

for (const suffix of ['.stdout.log', '.stderr.log', '.json']) test('reserves entire new evidence set before spawn: collision on ' + suffix, options, async t => {
  const f = fixture(t, idle), file = f.base + suffix;
  writeFileSync(file, 'preserve me', { flag: 'wx', mode: 0o600 });
  await assert.rejects(runRuntimeProcess(f), /evidence reservation failed/);
  assert.equal(readFileSync(file, 'utf8'), 'preserve me'); assert.equal(existsSync(join(f.cwd, 'ready')), false);
});

test('crash-only descendant grace lets a pipe worker close naturally without a group signal', options, async t => {
  const f = fixture(t, `import { spawn } from 'node:child_process';
const worker = spawn(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => { setTimeout(() => process.exit(0), 80); });"], {env:process.env,stdio:['pipe','ignore','ignore']});
mark('ready', String(process.pid)); setInterval(() => {}, 1000);`);
  const receipt = checked(await runRuntimeProcess({ ...f, expectedSignal: 'SIGKILL', descendantExitGraceMs: 1000,
    onStarted: async api => { await api.waitForFile(join(f.cwd, 'ready'), 1500); await delay(150); api.killMain(); } }));
  assert.equal(receipt.passed, true); assert.deepEqual(receipt.groupSignals, []); assert.equal(receipt.leftoverGroup, false);
});

for (const sig of ['SIGINT', 'SIGTERM']) test('OS ' + sig + ' still supervises a run with an explicit AbortSignal', options, async t => {
  const controller = new AbortController(), f = fixture(t, idle);
  const receipt = checked(await runRuntimeProcess({ ...f, signal: controller.signal, onStarted: async api => {
    await api.waitForFile(join(f.cwd, 'ready'), 1500); process.kill(process.pid, sig);
  } }));
  assert.equal(receipt.passed, false); assert.equal(receipt.cancelled, sig);
});

test.after(() => { console.log('Owned runtime-process evidence retained at ' + root); });
