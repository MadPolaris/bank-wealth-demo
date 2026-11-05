import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { crashCases, sipCrashCases, validateChildReport, compareRecoveryEvidence } from './v1-crash-recovery.mjs';

export const CRASH_CASES = crashCases;
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const json = file => parseStrictJson(readFileSync(file));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};

export async function checkRuntimeWorker({ root, transcript, round, configSha256, fixtureSha256, crash = false }) {
  const bytes = readFileSync(transcript, 'utf8');
  assert.ok(bytes.endsWith('\n'), 'complete worker transcript required');
  const rows = bytes.trimEnd().split('\n').map(row => parseStrictJson(row));
  const starts = rows.filter(row => row.kind === 'worker-started'), exits = rows.filter(row => row.kind === 'worker-exited');
  assert.equal(starts.length, 1);
  const pid = starts[0].pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const deadline = Date.now() + 10_000;
  while (alive(pid) && Date.now() < deadline) await delay(100);
  assert.equal(alive(pid), false, 'TA worker remains alive; successor forbidden');
  assert.equal(existsSync(join(root, 'ta.jsonl.lock')), false, 'TA worker retained its lock; no forced removal');
  const receipt = json(join(root, `ta-worker-${pid}.json`));
  assert.equal(receipt.schemaVersion, 'bank.truthsrc-runtime-ta-worker/v1');
  assert.equal(receipt.closed, true);
  assert.equal(receipt.pid, pid);
  assert.equal(receipt.journalPath, join(root, 'ta.jsonl'));
  assert.equal(receipt.roundRoot, round);
  assert.equal(receipt.ownedRoot, root);
  assert.equal(receipt.configSha256, configSha256);
  assert.equal(receipt.fixtureSha256, fixtureSha256);
  if (!crash) {
    assert.equal(exits.length, 1); assert.equal(exits[0].pid, pid);
    assert.equal(exits[0].exitCode, 0); assert.equal(exits[0].waited, true);
    assert.ok(rows.some(row => row.op === 'close') && rows.some(row => row.result?.closed === true));
  } else assert.equal(exits.length, 0, 'killed JVM cannot report waiting for its worker');
  const stderr = transcript.replace(/\.jsonl$/, '.stderr.log');
  assert.equal(readFileSync(stderr).length, 0, 'worker stderr must be empty');
  return { pid, absent: true, cleanCloseReceipt: receipt, jvmWaited: !crash, transcriptSha256: sha(transcript) };
}

export async function runRuntimeCrashCases({ admitted, evidence, round, node, worker, taConfig, taConfigSha256,
  fixtureSha256, env, sandbox, runProcess, recheck }) {
  assert.equal(CRASH_CASES.length, 24);
  const results = [];
  for (const [index, caseName] of CRASH_CASES.entries()) {
    await recheck();
    const root = join(round, 'case-' + caseName), runs = join(root, 'runs');
    mkdirSync(root, { mode: 0o700 }); mkdirSync(runs, { mode: 0o700 });
    const namespace = 'crash_' + createHash('sha256').update(evidence).digest('hex').slice(0, 16) + '_' + index;
    const config = { caseName, namespace };
    const invocations = [];
    let failure;
    try {
      for (const mode of ['crash', 'recover', 'verify']) {
        const invocation = join(runs, mode); mkdirSync(invocation, { mode: 0o700 });
        const main = 'example.bankwealth.service.' + (sipCrashCases.includes(caseName) ? 'BankSipCrashRecoveryMain' : 'BankCrashRecoveryMain');
        let report;
        const process = await runProcess({ executable: admitted.java, args: ['-Xmx1G', '-XX:ActiveProcessorCount=2', '-XX:-UsePerfData',
          '-Duser.home=' + env.HOME, '-Djava.io.tmpdir=' + env.TMPDIR, '-cp', admitted.classpath.join(':'),
          main, mode, caseName, root, namespace, node, worker, invocation], cwd: admitted.actualRoot,
          env: { ...env, BANK_RUNTIME_TA_CONFIG: taConfig, BANK_RUNTIME_TA_CONFIG_SHA256: taConfigSha256 },
          base: join(invocation, 'process'), timeoutMs: 130_000, sandbox,
          expectedSignal: mode === 'crash' ? 'SIGKILL' : null, descendantExitGraceMs: mode === 'crash' ? 10_000 : 0,
          onStarted: async child => {
            if (mode !== 'crash') return;
            await child.waitForFile(join(invocation, 'barrier.json'), 120_000);
            report = validateChildReport(json(join(invocation, 'barrier.json')), mode, config, child.pid, true);
            child.killMain('SIGKILL');
          } });
        assert.equal(process.passed, true, 'runtime process failed: ' + caseName + '/' + mode);
        if (mode === 'crash') assert.equal(existsSync(join(invocation, 'closed.json')), false);
        else {
          report = validateChildReport(json(join(invocation, 'result.json')), mode, config, process.pid);
          assert.equal(json(join(invocation, 'closed.json')).pid, process.pid);
        }
        const workerReceipt = await checkRuntimeWorker({ root, transcript: join(invocation, 'worker.jsonl'), round,
          configSha256: taConfigSha256, fixtureSha256, crash: mode === 'crash' });
        invocations.push({ mode, pid: process.pid, process, worker: workerReceipt, report });
      }
      assert.equal(new Set(invocations.map(row => row.pid)).size, 3);
      compareRecoveryEvidence(invocations[1].report, invocations[2].report);
      await recheck();
    } catch (error) { failure = error.message; }
    const receipt = { schemaVersion: 'bank.truthsrc-runtime-crash-case/v1', caseName, namespace, passed: !failure,
      invocations, failure: failure ?? null, sourceBound: !failure, storage: 'owned LevelDB fsync and local snapshots; external TA JSONL',
      runtimeRetryBackoffDeadline: 'OPEN', release1134Resigned: false };
    save(join(root, 'runtime-receipt.json'), receipt);
    results.push(receipt);
    if (failure) throw new Error('crash window failed: ' + caseName + ': ' + failure);
  }
  return { passed: true, cases: results, count: results.length, jvms: results.length * 3,
    scope: '24 fixed three-JVM recovery windows; not Mongo fault injection, retry policy or multi-writer certification' };
}
