import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHttpAcceptance, verifyHttpReport } from '../tools/v1-http-acceptance.mjs';

test('HTTP integration refuses missing and unknown configuration rather than guessing defaults', () => {
  assert.throws(() => validateHttpAcceptance({}));
  assert.throws(() => validateHttpAcceptance({ buildReceipt: '/missing', java: '/missing', ownedRoot: '/missing', target: '/missing', allowNetwork: true }));
});

test('HTTP integration refuses relative, traversing and absent executable paths before creating evidence', () => {
  for (const java of ['java', '/tmp/../java', '/missing-bank-http-java', '/tmp/invalid\0java']) {
    assert.throws(() => validateHttpAcceptance({ buildReceipt: '/missing', java, ownedRoot: '/missing', target: '/missing' }));
  }
});

test('HTTP report rejects missing cases, forged status counts and changed rejection journals', () => {
  const before = { seed: [{ sequence: 1, bytes: 'actual-fixture' }] };
  const statuses = [['unauthenticated', 401], ['operator-cannot-purchase', 403], ['csrf', 403], ['customer-cannot-reconcile', 403]];
  const fields = ['principalId', 'roles', 'accountId', 'investorAccountId', 'fundCollectionAccountId', 'taReceipt', 'forcedResult', 'refundDestination', 'authorization', 'transactionId'];
  const report = { schemaVersion: 'bank-http-acceptance/v1', mode: 'exercise', paymentCount: 3,
    queries: { lost: {}, race: {}, same: {} }, journal: { a: [], b: [], c: [], d: [] }, replayBytesEqual: false,
    cases: [...statuses.map(([name, status]) => ({ case: name, status })), ...fields.map(name => ({ case: 'reject-' + name, status: 400 })),
      { case: 'all-rejections-zero-journal-events', before, after: structuredClone(before) },
      { case: 'actual-socket-response-loss', upstreamStatus: 200, clientResponseBytes: 0, noNewEvents: true, retriedAcknowledgement: {} },
      { case: 'eight-concurrent-identical', statuses: Array(8).fill(200) },
      { case: 'eight-concurrent-conflicting', statuses: [200, 200, 200, 200, 409, 409, 409, 409] }] };
  verifyHttpReport(report, 'exercise');
  for (const mutate of [
    r => r.cases.pop(),
    r => { r.cases.find(c => c.case === 'unauthenticated').status = 200; },
    r => { r.cases.find(c => c.case === 'all-rejections-zero-journal-events').after.seed.push({ sequence: 2 }); },
    r => { r.cases.find(c => c.case === 'actual-socket-response-loss').clientResponseBytes = 10; },
    r => { r.cases.find(c => c.case === 'eight-concurrent-conflicting').statuses = Array(8).fill(200); },
    r => { r.replayBytesEqual = true; }
  ]) {
    const changed = structuredClone(report); mutate(changed);
    assert.throws(() => verifyHttpReport(changed, 'exercise'));
  }
  verifyHttpReport({ ...report, mode: 'replay', cases: [], replayBytesEqual: true }, 'replay');
});
