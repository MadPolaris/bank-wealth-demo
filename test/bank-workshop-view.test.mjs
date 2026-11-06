import test from 'node:test';
import assert from 'node:assert/strict';
import { attachWorkshopEvidence } from '../tools/bank-workshop-view.mjs';

const view = { snapshot: { source: 'source-a', codeDigest: 'code-a' }, verification: { counts: { files: 229, spans: 669 } }, limitations: [] };
const report = { schemaVersion: 'bank.workshop-report/v1', snapshot: 'source-a', codeDigest: 'code-a', through: 'code', executionKind: 'real',
  fullPipelinePassed: false, checkedAt: 'fixture-only', diagnostics: [], stages: [
    { id: 'source', status: 'passed', rechecked: true }, { id: 'anchors', status: 'passed', rechecked: true },
    { id: 'code', status: 'passed', rechecked: true }, { id: 'service', status: 'skipped', rechecked: false } ] };

test('code acceptance overlay never upgrades unexecuted bank services', () => {
  const result = attachWorkshopEvidence(view, report);
  assert.equal(result.evidence.find(row => row.id === 'code').status, 'passed');
  assert.equal(result.evidence.find(row => row.id === 'service').status, 'not-run');
  assert.equal(result.receipt.fullPipelinePassed, false);
});

test('stale checks and mismatched source/code cannot become green evidence', () => {
  assert.throws(() => attachWorkshopEvidence(view, { ...report, snapshot: 'other' }), /another author/);
  assert.throws(() => attachWorkshopEvidence(view, { ...report, codeDigest: 'other' }), /another generated/);
  const stale = attachWorkshopEvidence(view, { ...report, stages: report.stages.map(row => ({ ...row, rechecked: false })) });
  assert.equal(stale.evidence.find(row => row.id === 'code').status, 'blocked');
});
