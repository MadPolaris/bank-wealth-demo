import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInventory, verifyReleaseBuild } from './v1-release-build-evidence.mjs';
import { crashCases, validateChildReport, compareRecoveryEvidence } from './v1-crash-recovery.mjs';
import { verifyHttpReport } from './v1-http-acceptance.mjs';
import { verifyGeneratedProvenance, verifyStableGeneration, verifyHandwrittenProvenance } from './v1-release-provenance.mjs';

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const counts = [3, 5, 3, 3, 4, 4, 3];
export async function certifyRelease({ bundle, work }) {
  const slots = counts.flatMap((count, phase) => Array.from({ length: count }, (_, i) => ({ index: `P${phase + 26}:${i + 1}`, status: 'blocked', evidence: [], reason: 'Full original requirement has not been certified.' })));
  const results = [], problems = [];
  async function check(name, fn) {
    try { const evidence = await fn(); results.push({ name, status: 'verified', evidence }); }
    catch (e) { results.push({ name, status: 'blocked', reason: e.message }); problems.push({ name, reason: e.message }); }
  }
  for (const chain of ['js', 'bc']) {
    const buildFile = join(work, 'builds', chain, 'BUILD.json');
    const target = existsSync(buildFile) ? json(buildFile).target : join(bundle, 'bank/target/missing-' + chain);
    await check(chain + '-build', () => verifyReleaseBuild(buildFile, target));
    await check(chain + '-http', () => {
      const root = join(work, 'http-' + chain), r = json(join(root, 'result.json'));
      assert.equal(r.buildSha, sha(buildFile));
      assert.equal(r.modes.length, 2);
      for (const [i, mode] of ['exercise', 'replay'].entries()) {
        const entry = r.modes[i], p = entry.process;
        assert.equal(p.code, 0); assert.equal(p.waited, true); assert.equal(p.timedOut, false); assert.equal(p.cancelled, null);
        assert.equal(sha(join(entry.invocation, 'stdout.log')), p.stdoutSha);
        assert.equal(sha(join(entry.invocation, 'stderr.log')), p.stderrSha);
        assert.deepEqual(json(join(entry.invocation, 'result.json')), entry.report);
        verifyHttpReport(entry.report, mode);
      }
      assert.notEqual(r.modes[0].process.pid, r.modes[1].process.pid);
      for (const key of ['journal', 'queries', 'acknowledgements']) assert.deepEqual(r.modes[0].report[key], r.modes[1].report[key]);
      return { file: join(root, 'result.json'), sha256: sha(join(root, 'result.json')) };
    });
    for (const caseName of crashCases) await check(chain + '-' + caseName, () => {
      const root = join(work, 'crash-' + chain + '-' + caseName), file = join(root, 'receipt.json'), r = json(file);
      assert.equal(r.passed, true); assert.equal(r.inputUnchanged, true); assert.equal(r.caseName, caseName); assert.equal(r.target, target);
      assert.equal(sha(join(root, 'inputs.json')), r.inputsSHA);
      assert.equal(json(join(root, 'inputs.json')).buildReceipt, sha(buildFile));
      assert.equal(r.results.length, 3); assert.equal(new Set(r.results.map(row => row.pid)).size, 3);
      for (const [i, mode] of ['crash', 'recover', 'verify'].entries()) {
        const dir = join(root, 'runs', mode), exit = json(join(dir, 'exit.json')), row = r.results[i];
        assert.equal(exit.passed, true); assert.equal(exit.waited, true); assert.equal(exit.timedOut, false);
        assert.equal(exit.pid, row.pid); assert.equal(sha(join(dir, 'stdout.log')), exit.stdoutSHA); assert.equal(sha(join(dir, 'stderr.log')), exit.stderrSHA);
        if (i === 0) { assert.equal(exit.signal, 'SIGKILL'); assert.equal(existsSync(join(dir, 'closed.json')), false); }
        else { assert.equal(exit.exitCode, 0); assert.equal(json(join(dir, 'closed.json')).pid, row.pid); }
        const report = json(join(dir, i === 0 ? 'barrier.json' : 'result.json'));
        assert.deepEqual(report, row.report);
        validateChildReport(report, mode, { caseName, namespace: r.namespace }, row.pid, i === 0);
      }
      compareRecoveryEvidence(r.results[1].report, r.results[2].report);
      return { file, sha256: sha(file) };
    });
    await check(chain + '-runtime', () => {
      const file = join(work, 'runtime', chain, 'RESULT.json'), r = json(file);
      assert.equal(r.passed, true); assert.equal(r.buildReceipt.sha256, sha(buildFile));
      assert.equal(r.runs.length, 4); assert.deepEqual(r.runs.map(row => row.mode), ['initial', 'restart', 'refund', 'replay']);
      for (const row of r.runs) {
        assert.equal(sha(row.serverReceipt.file), row.serverReceipt.sha256);
        const server = json(row.serverReceipt.file);
        assert.equal(server.exitCode, 0); assert.equal(server.waited, true); assert.equal(server.closed, true);
        assert.equal(row.process.exitCode, 0); assert.equal(row.process.waited, true); assert.equal(row.process.timedOut, false);
        for (const log of [...Object.values(server.logs), ...Object.values(row.process.logs)]) assert.equal(sha(log.file), log.sha256);
        assert.deepEqual(json(row.process.logs['stdout.log'].file), row.report);
        assert.equal(row.report.completed, true);
        assert.equal(sha(row.workerLog.file), row.workerLog.sha256);
        const workers = readFileSync(row.workerLog.file, 'utf8').trim().split('\n').map(JSON.parse);
        const start = workers.filter(r => r.kind === 'worker-started'), exit = workers.filter(r => r.kind === 'worker-exited');
        assert.equal(start.length, 1); assert.equal(exit.length, 1); assert.equal(start[0].pid, exit[0].pid); assert.equal(exit[0].exitCode, 0); assert.equal(exit[0].waited, true);
      }
      const [initial, restart, refund, replay] = r.runs.map(row => row.report);
      assert.deepEqual(initial.original, restart.original); assert.deepEqual(initial.original, replay.orders[0].original); assert.deepEqual(refund.original, replay.orders[1].original);
      assert.deepEqual(initial.terminal.taShares, { fundCode: 'fund', shares: '80.0000', nav: '1.2345' });
      assert.equal(replay.plan.plan.successTotal, '2'); assert.equal(replay.plan.plan.failureTotal, '0');
      assert.equal(replay.occurrences.occurrences.length, 2);
      for (const [role, amount] of [['customer', '88000'], ['collection', '12000']]) {
        assert.equal(replay.accounts[role].account.available.minorUnits, amount); assert.equal(replay.accounts[role].account.reserved.minorUnits, '0');
        assert.deepEqual(initial.accounts[role].account, refund.accounts[role].account); assert.deepEqual(initial.accounts[role].account, replay.accounts[role].account);
      }
      assert.equal(r.mysqlProcess.exitCode, 0); assert.equal(r.mysqlProcess.waited, true); assert.equal(r.mysqlProcess.timedOut, false);
      for (const log of Object.values(r.mysqlProcess.logs)) assert.equal(sha(log.file), log.sha256);
      assert.deepEqual(json(join(work, 'runtime', chain, 'mysql-negative/result.json')), r.mysqlNegative);
      assert.equal(r.mysqlNegative.scenarios.length, 5); assert.ok(r.mysqlNegative.scenarios.every(row => row.status === 'passed'));
      if (r.mysqlEvidence) for (const [path, expected] of Object.entries(r.mysqlEvidence)) assert.equal(sha(join(work, 'runtime', chain, 'mysql-negative', path)), expected);
      for (const scenario of r.mysqlNegative.scenarios) {
        const dir = join(work, 'runtime', chain, 'mysql-negative', scenario.scenario);
        assert.equal(json(join(dir, 'closed.json')).actorSystemTerminated, true);
        const unchanged = { 'mysql-duplicate-zero-effect': ['after'], 'mysql-conflict-and-identity-rejected': ['after-conflict', 'after-identity'], 'mysql-gap-holds-watermark': ['after-gap'], 'mysql-index-failure-rolls-back': ['after-failure'] }[scenario.scenario] ?? [];
        for (const name of unchanged) assert.deepEqual(json(join(dir, 'before.json')), json(join(dir, name + '.json')));
        if (scenario.scenario === 'mysql-early-occurrence-retryable-join') assert.deepEqual(json(join(dir, 'after-order.json')), json(join(dir, 'after-duplicates.json')));
      }
      assert.equal(r.cleanup.length, 2); assert.ok(r.cleanup.every(row => row.stopped && row.stopExit === 0));
      return { file, sha256: sha(file) };
    });
  }
  await check('final-provenance', async () => {
    const file = join(work, 'provenance/RESULT.json'), r = json(file), request = json(join(bundle, 'inputs/request.json'));
    for (const chain of ['js', 'bc']) {
      const p = r.chains[chain];
      assert.deepEqual(await verifyGeneratedProvenance(p.generated.target, request, { afterBuild: true }), p.generated);
      assert.deepEqual(verifyStableGeneration(p.stable.left, p.stable.right, { afterBuild: true }), p.stable);
    }
    assert.deepEqual(await verifyHandwrittenProvenance(join(bundle, 'bank/v1/handwritten'), request, json(join(bundle, 'bank/v1/integration/HANDWRITTEN-SOURCE-MAP.json'))), r.handwritten);
    assert.equal(r.legalIncrement.beforeAbsent, true); assert.equal(r.legalIncrement.inheritedAuthoredIncrement, true);
    return { file, sha256: sha(file) };
  });
  await check('independent-admission', () => {
    const root = join(work, 'admission'), r = json(join(root, 'RESULT.json'));
    assert.equal(r.passed, true); assert.equal(r.fixtureSha256, sha(join(bundle, 'admission/compiled.json')));
    assert.equal(r.js.nonfinancialTypedProductAccepted, true); assert.equal(r.bc.nonfinancialTypedProductAccepted, true);
    assert.equal(r.js.rejected.length, 2); assert.equal(r.bc.rejected.length, 2);
    for (const row of [...r.js.rejected, ...r.bc.rejected]) assert.equal(existsSync(row.target), false);
    for (const chain of ['js', 'bc']) {
      assert.equal(r[chain].nonfinancialPublicGeneration, join(root, 'nonfinancial-' + chain));
      assert.deepEqual(buildInventory(r[chain].nonfinancialPublicGeneration), r.nonfinancialOutputs[chain]);
      assert.ok(Object.keys(r.nonfinancialOutputs[chain]).some(f => f.endsWith('InventoryServiceService.scala')));
    }
    for (const name of ['js', 'javac', 'typed', 'nonfinancial-bc-execute', 'bc-0', 'bc-1']) {
      const process = json(join(root, name, 'result.json'));
      assert.equal(process.exitCode, name.startsWith('bc-') ? 1 : 0); assert.equal(process.waited, true); assert.equal(process.timedOut, false);
      for (const log of Object.values(process.logs)) assert.equal(sha(log.file), log.sha256);
    }
    return { file: join(root, 'RESULT.json'), sha256: sha(join(root, 'RESULT.json')) };
  });
  const requirements = Object.fromEntries(readFileSync(join(bundle, 'bank/v1/integration/ACCEPTANCE-MATRIX.md'), 'utf8').split('\n').flatMap(line => {
    const m = /^\| (P\d+)-(\d+) \| ([^|]+) \|/.exec(line); return m ? [[m[1] + ':' + m[2], m[3].trim()]] : [];
  }));
  const suitesBySlot = {
    'P26:1': ['BankSeedAuthoritySpec', 'BankSeedConcurrencySpec'], 'P26:2': ['BankRequestHttpSpec', 'BankQueryAuthorizationSpec', 'BankPageRouterSpec'], 'P26:3': ['BankApplicationAssemblySpec', 'BankRequestHttpSpec'],
    'P27:1': ['BankSinglePaymentOracleSpec'], 'P27:2': ['BankPaymentDeliveryAcceptanceSpec'], 'P27:3': ['BankOrderCancelSpec', 'BankPaymentJointSpec'], 'P27:4': ['BankPaymentRecoverySpec', 'BankPaymentJointSpec'], 'P27:5': ['BankPaymentJointSpec'],
    'P28:1': ['BankTaApplicationSpec'], 'P28:2': ['BankTaApplicationSpec', 'BankPaymentJointSpec'], 'P28:3': ['BankTaApplicationSpec'],
    'P29:1': ['BankRefundApplicationSpec'], 'P29:2': ['BankRefundApplicationSpec'], 'P29:3': ['BankAutomaticRecoverySpec', 'BankRefundApplicationSpec'],
    'P30:1': ['BankSipRecoverySpec'], 'P30:2': ['BankSipApplicationSpec', 'BankSipStateSpec'], 'P30:3': ['BankSipCatchupJointSpec'], 'P30:4': ['BankSipApplicationSpec', 'BankSipRecoverySpec'],
    'P31:1': ['BankAutomaticRecoverySpec'], 'P31:2': ['BankReadsideProjectionSpec', 'BankReadsideShutdownSpec', 'BankQueryAuthorizationSpec'], 'P31:3': ['GeneratedServiceConfigurationSpec'], 'P31:4': ['BankBrowserPagesSpec'],
  };
  const verified = name => results.some(r => r.name === name && r.status === 'verified');
  const businessNames = ['js', 'bc'].flatMap(chain => [chain + '-build', chain + '-http', chain + '-runtime', ...crashCases.map(c => chain + '-' + c)]);
  const businessReady = businessNames.every(verified);
  for (const slot of slots) {
    slot.requirement = requirements[slot.index];
    if (!slot.requirement) { slot.status = 'failed'; slot.reason = 'Original requirement missing from immutable bundle contract'; continue; }
    const requiredSuites = suitesBySlot[slot.index];
    if (!requiredSuites) continue;
    const suitesPresent = ['js', 'bc'].every(chain => {
      const file = join(work, 'builds', chain, 'BUILD.json');
      return existsSync(file) && requiredSuites.every(name => json(file).tests.suites?.[name]?.length > 0);
    });
    const extra = slot.index === 'P31:3' ? verified('independent-admission') && verified('final-provenance') : slot.index === 'P31:4' ? verified('final-provenance') : true;
    if (businessReady && suitesPresent && extra) {
      slot.status = 'proven'; slot.reason = 'Original demo requirement mapped to concrete same-source suites, independently checked cross-JVM/HTTP evidence and real database/browser execution; no production multiwriter or modern Mongo certification inferred.';
      slot.evidence = results.filter(r => r.status === 'verified').map(r => r.name);
    } else slot.reason = 'Required same-source business execution, suite coverage or provenance/admission evidence is incomplete.';
  }
  return { schemaVersion: 'bank-v1-certification/v2', slots, results, problems, accepted: false, allOriginalRequiredProven: false,
    reason: 'P32 requires separately verified portable distribution and actual promotion/replay; business certification alone cannot close release.' };
}
