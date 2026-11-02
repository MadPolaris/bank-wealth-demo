import test from 'node:test';
import assert from 'node:assert/strict';
import { crashCases, sipCrashCases, taCrashCases, validateCrashConfiguration, validateChildReport, compareRecoveryEvidence } from '../tools/v1-crash-recovery.mjs';

const config = { synthetic: true, caseName: 'request-before-start', namespace: 'crash_unit' };
const hash = 'a'.repeat(64);
function proof() {
  const original = { principalId: 'alice', clientRequestId: 'crash-request', amount: '100.00' };
  const identities = { paymentTxId: 'original-payment' };
  const eventCounts = { source: 1, settlement: 1, paymentResult: 1, paymentParent: { RunStarted: 1, StageDone: 1, RunFailedEvt: 0 } };
  const streams = ['investor', 'collection', 'order'].map(persistenceId => ({ persistenceId, eventCount: 1, lastSequenceNr: 1,
    serializedSha256: hash, pbSha256: hash, events: [{ persistenceId, sequenceNr: 1, eventType: 'real.PB',
      serializerId: 1, manifest: 'pb', serializedSha256: hash, pbSha256: hash }] }));
  return { original, identities, eventCounts, state: {},
    journal: { persistenceIds: streams.map(s => s.persistenceId), streams, allDurableEventsSerializedSha256: hash, allPbEventsSha256: hash },
    financial: { original, identities, eventCounts, allPbEventsSha256: hash, durablePbVector: streams.flatMap(s => s.events) },
    recovery: { driver: 'BankRecoveryLoop', customerResubmissions: 0, preservedOriginalSerializedPrefix: true },
    storage: { provider: 'local', journal: 'akka.persistence.journal.leveldb', native: false, fsync: true, snapshotStore: 'akka.persistence.snapshot-store.local' } };
}
const report = (mode = 'recover') => ({ schemaVersion: 'bank-crash-result/v1', mode, caseName: config.caseName,
  namespace: config.namespace, pid: 10001, passed: true, evidence: proof() });

test('crash cases are explicit and unique', () => {
  assert.equal(new Set(crashCases).size, crashCases.length);
  assert.ok(crashCases.includes('request-before-start'));
  assert.ok(crashCases.includes('refund-before-assembly'));
});
for (const [name, change] of [
  ['unknown configuration key', { extra: 'ignored' }],
  ['production use', { synthetic: false }],
  ['unknown case', { caseName: 'kill-arbitrary-process' }],
  ['shared namespace', { namespace: 'production' }],
  ['parent traversal', { ownedRoot: '/tmp/../production' }],
  ['external evidence', { ownedRoot: '/tmp/crash-outside' }],
]) test('configuration refuses ' + name + ' before spawning or writing', () => {
  assert.throws(() => validateCrashConfiguration({ ...config, ...change }));
});

test('report must identify the actual child and selected experiment', () => {
  assert.equal(validateChildReport(report(), 'recover', config, 10001).passed, true);
  for (const change of [{ pid: 10002 }, { mode: 'crash' }, { namespace: 'crash_other' },
    { caseName: 'refund-prepare' }, { schemaVersion: 'invented' }, { evidence: null }, { evidence: {} }, { evidence: [] }, { passed: false }]) {
    assert.throws(() => validateChildReport({ ...report(), ...change }, 'recover', config, 10001));
  }
});

test('missing or incomplete durable vector cannot claim success', () => {
  for (const change of [{ financial: {} }, { journal: {} }, { eventCounts: {} }, { original: {} }, { recovery: {} }, { storage: {} }]) {
    assert.throws(() => validateChildReport({ ...report(), evidence: { ...proof(), ...change } }, 'recover', config, 10001));
  }
  const gap = report(); gap.evidence.journal.streams[0].events[0].sequenceNr = 2;
  assert.throws(() => validateChildReport(gap, 'recover', config, 10001));
});

test('durable barrier cannot be substituted with a successful result or advanced request', () => {
  assert.throws(() => validateChildReport(report('crash'), 'crash', config, 10001, true));
  const barrier = report('crash'); barrier.schemaVersion = 'bank-crash-barrier/v1';
  Object.assign(barrier.evidence, { barrierCondition: config.caseName, loopStarted: false, fault: { enabled: true, forwardBlocked: true } });
  assert.throws(() => validateChildReport(barrier, 'crash', config, 10001, true));
  barrier.evidence.eventCounts.settlement = 0;
  barrier.evidence.eventCounts.paymentParent.RunStarted = 0;
  assert.ok(validateChildReport(barrier, 'crash', config, 10001, true));
});

test('third JVM comparison includes original, effect counts and durable event bytes', () => {
  compareRecoveryEvidence(report(), report('verify'));
  for (const field of ['original', 'eventCounts', 'durablePbVector']) {
    const changed = report('verify'); changed.evidence.financial[field] = {};
    assert.throws(() => compareRecoveryEvidence(report(), changed));
  }
});

test('third JVM rejects new business events, changed prefixes, graphs or parent checkpoints', () => {
  for (const type of ['real.PB', 'net.imadz.monarch.persistence.PersistentMonarch$RunStarted', 'net.imadz.monarch.persistence.PersistentMonarch$StageDone']) {
    const changed = report('verify'); const stream = changed.evidence.journal.streams[0];
    stream.events.push({ ...stream.events[0], sequenceNr: 2, eventType: type, pbSha256: null });
    assert.throws(() => compareRecoveryEvidence(report(), changed));
  }
  const changed = report('verify'); changed.evidence.journal.streams[0].events[0].serializedSha256 = 'b'.repeat(64);
  assert.throws(() => compareRecoveryEvidence(report(), changed));
});

function sipReport(caseName, barrier = false) {
  const r = report(barrier ? 'crash' : 'recover');
  r.caseName = caseName;
  r.evidence.original.clientRequestId = 'crash-sip-request';
  r.evidence.identities.planId = 'original-plan';
  const creation = sipCrashCases.slice(0, 4).includes(caseName), terminal = caseName.startsWith('sip-terminal-');
  const index = sipCrashCases.indexOf(caseName);
  const occurrences = barrier && (creation || caseName === 'sip-tick-before-catchup') ? 0 : creation ? 0 : terminal ? 1 : 2;
  const completed = !barrier || terminal ? occurrences : 0;
  const counted = terminal && (!barrier || caseName === 'sip-terminal-ack-lost') ? 1 : 0;
  const parents = Array.from({ length: completed }, () => ({ RunStarted: 1, StageDone: 1, RunFailedEvt: 0 }));
  Object.assign(r.evidence.eventCounts, { createIntent: 1, created: barrier && index === 0 ? 0 : 1,
    appended: !barrier ? 2 : index < 2 ? 0 : index === 2 ? 1 : 2, sealed: barrier && creation ? 0 : 1,
    clockAdvanced: creation ? 0 : 1, occurrences, successTotal: counted, failureTotal: 0,
    terminalSucceeded: counted, terminalFailed: 0, cashSettlements: completed, paymentResults: completed,
    sipParents: parents, paymentParents: structuredClone(parents), taParents: structuredClone(parents) });
  Object.assign(r.evidence.financial, { plan: { id: 'original-plan' }, orders: Array.from({ length: completed }, (_, index) => ({ id: `order-${index}` })) });
  if (barrier) {
    r.schemaVersion = 'bank-crash-barrier/v1';
    Object.assign(r.evidence, { barrierCondition: caseName, loopStarted: false,
      fault: { enabled: true, forwardBlocked: true, withheldAcks: counted } });
  }
  return r;
}

for (const caseName of sipCrashCases) test('SIP proof is closed and case-specific: ' + caseName, () => {
  const selected = { ...config, caseName };
  for (const barrier of [false, true]) {
    const r = sipReport(caseName, barrier);
    validateChildReport(r, r.mode, selected, r.pid, barrier);
    for (const field of ['createIntent', 'appended', 'occurrences', 'successTotal', 'paymentResults']) {
      const bad = structuredClone(r); bad.evidence.eventCounts[field] += 1;
      bad.evidence.financial.eventCounts[field] += 1;
      assert.throws(() => validateChildReport(bad, bad.mode, selected, bad.pid, barrier));
    }
  }
});

test('SIP terminal ACK window cannot be fabricated from a blocked command', () => {
  const r = sipReport('sip-terminal-ack-lost', true); r.evidence.fault.withheldAcks = 0;
  assert.throws(() => validateChildReport(r, r.mode, { ...config, caseName: r.caseName }, r.pid, true));
});

function taReport(caseName, barrier = false) {
  const r = report(barrier ? 'crash' : 'recover'); r.caseName = caseName;
  const refund = caseName.startsWith('refund-') || caseName === 'ta-rejected-after-ingest-before-ack';
  const paymentAck = barrier && caseName === 'payment-succeeded-before-delivery-ack';
  const beforeSubmit = barrier && ['ta-register-before-assembly', 'ta-intent-before-submit'].includes(caseName);
  const beforeAccept = barrier && (beforeSubmit || paymentAck || caseName === 'ta-submitted-before-bank-accept');
  const refundIntent = refund && (!barrier || caseName !== 'ta-rejected-after-ingest-before-ack') ? 1 : 0;
  const taStarted = barrier && (paymentAck || caseName === 'ta-register-before-assembly') ? 0 : 1;
  Object.assign(r.evidence.eventCounts, { taAccepted: beforeAccept ? 0 : 1,
    taConfirmed: !barrier && caseName === 'ta-confirmed-before-ingest' ? 1 : 0,
    taRegistration: paymentAck ? 0 : 1, taRejection: refund ? 1 : 0,
    taHostIntent: taStarted, taHostObservations: barrier && (beforeAccept || caseName === 'ta-accepted-before-effect-reply') ? 0 : 1,
    paymentDeliveryAcknowledged: paymentAck ? 0 : 1, refundDeliveryAcknowledged: !barrier && refund ? 1 : 0,
    refundIntent, refundResult: refundIntent,
    taParent: { RunStarted: taStarted, StageDone: barrier && (beforeAccept || caseName === 'ta-accepted-before-effect-reply') ? 0 : 1, RunFailedEvt: 0 },
    refundParent: refund ? { RunStarted: refundIntent, StageDone: barrier ? 0 : 1, RunFailedEvt: 0 } : null });
  r.evidence.eventCounts.paymentParent.StageDone = paymentAck ? 0 : 1;
  r.evidence.financial.ta = { journal: { submissionCount: beforeSubmit || paymentAck ? 0 : 1 } };
  if (barrier) {
    r.schemaVersion = 'bank-crash-barrier/v1';
    Object.assign(r.evidence, { barrierCondition: caseName, loopStarted: false,
      fault: { enabled: true, forwardBlocked: true, withheldAcks: caseName.endsWith('-ack') ? 1 : 0 } });
  }
  return r;
}
for (const caseName of taCrashCases) test('TA and delivery proof is case-specific: ' + caseName, () => {
  const selected = { ...config, caseName };
  for (const barrier of [false, true]) {
    const r = taReport(caseName, barrier);
    validateChildReport(r, r.mode, selected, r.pid, barrier);
    for (const field of ['taHostIntent', 'paymentDeliveryAcknowledged', 'taAccepted']) {
      const bad = structuredClone(r); delete bad.evidence.eventCounts[field];
      assert.throws(() => validateChildReport(bad, bad.mode, selected, bad.pid, barrier));
    }
  }
});

test('new TA and SIP cases reject additional technical journal events', () => {
  for (const recovered of [taReport('ta-register-before-assembly'), sipReport('sip-tick-before-catchup')]) {
    const verified = structuredClone(recovered);
    const stream = verified.evidence.journal.streams[0];
    stream.events.push({ ...stream.events[0], sequenceNr: 2, eventType: 'example.bankwealth.application.bank_ta_effectEffectHost$ObservationStored', pbSha256: null });
    assert.throws(() => compareRecoveryEvidence(recovered, verified));
  }
});

test('SIP actual occurrence orders cannot be replaced with an empty list', () => {
  const r = sipReport('sip-tick-before-catchup'); r.evidence.financial.orders = [];
  assert.throws(() => validateChildReport(r, r.mode, { ...config, caseName: r.caseName }, r.pid));
});

test('result already persisted is not proof of lost delivery ACK', () => {
  for (const caseName of ['payment-succeeded-before-delivery-ack', 'refund-succeeded-before-delivery-ack']) {
    const r = taReport(caseName, true); r.evidence.fault.withheldAcks = 0;
    assert.throws(() => validateChildReport(r, r.mode, { ...config, caseName }, r.pid, true));
  }
});
