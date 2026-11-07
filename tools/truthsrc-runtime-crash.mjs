import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { checkRuntimeWorker } from './truthsrc-worker-evidence.mjs';
export { checkRuntimeWorker } from './truthsrc-worker-evidence.mjs';
import { crashCases, sipCrashCases, validateChildReport, compareRecoveryEvidence } from './v1-crash-recovery.mjs';

export const CRASH_CASES = crashCases;
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const json = file => parseStrictJson(readFileSync(file));

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
