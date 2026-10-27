import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, loadBindings, declarationIndex, sourceGates, roundtripLocal, assertSnapshotStable, protectionReport } from '../tools/truth-source.mjs';
import { extractArtifacts, validateDeclarations, validateArtifacts } from '../tools/artifacts.mjs';
import { CASH_RESULT_KINDS, validateCashContract } from '../tools/cash-contract.mjs';

const snapshot = loadSnapshot();
const bindings = loadBindings();
const artifacts = extractArtifacts(snapshot);
const index = declarationIndex(snapshot.canonical);
const command = (name) => index.get(`command:FundOrder.${name}`);
const event = (name) => index.get(`event:FundOrder.${name}`);
const guard = (name, ref) => command(name).guards.find((g) => (g.ref || g.ruleId) === ref);
const suffixes = ['Succeeded', 'RejectedBeforeEffects', 'Compensated', 'RecoveryRequired', 'OutcomeUnknown'];
const refundNames = ['RecordFundRefundCompleted', 'RecordFundPurchaseRefundRejected', 'RecordFundPurchaseRefundCompensated', 'RecordFundPurchaseRefundRecoveryRequired', 'RecordFundPurchaseRefundOutcomeUnknown'];
const cashName = (kind) => `RecordFundCashPayment${suffixes[CASH_RESULT_KINDS.indexOf(kind)]}`;
const cashBody = (rows) => rows.find((a) => a.id === 'contract.cash-purchase-v2').body;

// Test-only interpretation of isolated existing invariant expressions. No command dispatch,
// journal, auth, phase engine, full guard runner or production fold implementation exists here.
// These assertions prove the authored declarations, NOT a generated handler or runtime.
function scalaMap(rows = []) {
  const map = new Map(rows);
  const callable = (key) => map.get(key);
  callable.contains = (key) => map.has(key);
  callable.get = (key) => ({ contains: (value) => map.has(key) && map.get(key) === value });
  callable.isEmpty = map.size === 0;
  callable.keys = { forall: (predicate) => [...map.keys()].every(predicate) };
  return callable;
}
function declaredCondition(g, state, param = {}) {
  assert.equal(g.kind, 'invariantRef');
  const cond = g.cond.replaceAll('.forall(_ == param.txid)', '.forall(key => key === param.txid)');
  return Function('state', 'param', `"use strict"; return (${cond});`)(state, param);
}
function cashState(current, final, committed = []) {
  return {
    contractVersion: 'cash-purchase-v2',
    cashPaymentResults: scalaMap(current === undefined ? [] : [['pay-1', current]]),
    cashPaymentFinalResults: scalaMap(final === undefined ? [] : [['pay-1', final]]),
    reservedSubscriptions: scalaMap(), committedSubscriptions: scalaMap(committed), compensatedSubscriptions: scalaMap(),
    amount: 'exact-original-money',
  };
}
function refundState(outcome, final, receiptKind, body = 'exact-body') {
  return {
    status: 'REFUND_REQUESTED', taStatus: 'TA_REJECTED', refundOutcome: outcome,
    refundFinalResults: scalaMap(final === undefined ? [] : [['refund-1', final]]),
    refundResultReceipts: scalaMap(receiptKind === undefined ? [] : [['receipt-1', body]]),
    refundResultReceiptKinds: scalaMap(receiptKind === undefined ? [] : [['receipt-1', receiptKind]]),
  };
}
const cashParam = { txid: 'pay-1' };
const refundParam = { refundTxId: 'refund-1', receiptId: 'receipt-1', receiptBody: 'exact-body' };

test('current canonical and nested source bridges close the cash semantic contract', () => {
  const result = validateCashContract({ ...snapshot, bindings }, artifacts);
  assert.deepEqual(result.errors, []);
  assert.equal(result.readiness, 'declaration-only');
  assert.equal(result.runnable, false);
  assert.equal(result.runtimeBindingVerified, false);
  assert.deepEqual(result.checkedResultKinds, [...CASH_RESULT_KINDS]);
  assert.deepEqual(validateDeclarations(snapshot).errors, []);
  assert.deepEqual(validateArtifacts(snapshot).errors, []);
});

test('local imports admit structure, all Saga/Execution contracts and runtime-v3 lowering', () => {
  const result = sourceGates(snapshot);
  assert.deepEqual(result.structure.hard, []);
  for (const family of ['saga', 'execution', 'lowering']) {
    assert.equal(result[family].ok, true, JSON.stringify(result[family]));
    assert.deepEqual(result[family].diagnostics, []);
  }
  assert.equal(result.lowering.readiness, 'lowered-contract-only');
  assert.equal(result.lowering.runnable, false);
  assert.equal(protectionReport().ok, true);
});

test('canonical, exact atom paths and bytes roundtrip locally', () => {
  assert.deepEqual(roundtripLocal(snapshot), { ok: true, atoms: snapshot.atoms.length });
  assertSnapshotStable(snapshot);
});

for (const from of ['recovery-required', 'outcome-unknown']) {
  test(`declaration: cash ${from} does not block later succeeded`, () => {
    const nonterminal = event(`FundCashPayment${suffixes[CASH_RESULT_KINDS.indexOf(from)]}`);
    assert.ok(!nonterminal.foldAssignments.some((f) => f.slot === 'cashPaymentFinalResults'));
    const state = cashState(from, undefined, [['pay-1', 'exact-original-money']]);
    assert.equal(declaredCondition(guard(cashName('succeeded'), 'IR-FO-CASH-RESULT-ASSOCIATION'), state, cashParam), true);
    assert.equal(declaredCondition(guard(cashName('succeeded'), 'IR-FO-CASH-RESULT-FINAL-CONFLICT'), state, cashParam), true);
    assert.equal(state.cashPaymentFinalResults.contains('pay-1'), false, 'terminal-only duplicate guard does not short-circuit');
    assert.equal(declaredCondition(guard(cashName('succeeded'), 'IR-FO-CASH-RESULT-SUCCESS-EVIDENCE'), state, cashParam), true);
    assert.ok(event('FundCashPaymentSucceeded').foldAssignments.some((f) => f.slot === 'cashPaymentFinalResults' && f.value === 'literal:succeeded'));
  });
  for (const final of CASH_RESULT_KINDS.slice(0, 3)) test(`declaration: refund ${from} can reconcile to ${final}`, () => {
    const state = refundState(from, undefined);
    const name = refundNames[CASH_RESULT_KINDS.indexOf(final)];
    assert.equal(declaredCondition(guard(name, 'IR-FO-REFUND-FINAL-CONFLICT'), state, refundParam), true);
    assert.equal(declaredCondition(guard(name, 'IR-FO-REFUND-RESULT-PHASE'), state, refundParam), true);
    assert.equal(state.refundFinalResults.contains('refund-1'), false);
    assert.ok(event(command(name).produces[0]).foldAssignments.some((f) => f.slot === 'refundFinalResults'));
  });
}
for (const final of CASH_RESULT_KINDS.slice(0, 3)) {
  test(`declaration: cash same final ${final} is empty success; other finals/nonterminals reject`, () => {
    const state = cashState(final, final, final === 'succeeded' ? [['pay-1', 'exact-original-money']] : []);
    assert.equal(declaredCondition(guard(cashName(final), 'IR-FO-CASH-RESULT-FINAL-CONFLICT'), state, cashParam), true);
    assert.equal(guard(cashName(final), 'IR-FO-CASH-RESULT-FINAL-ONCE').onFail, 'succeed-empty');
    assert.equal(state.cashPaymentFinalResults.contains('pay-1'), true);
    for (const other of CASH_RESULT_KINDS.filter((kind) => kind !== final)) assert.equal(declaredCondition(guard(cashName(other), 'IR-FO-CASH-RESULT-FINAL-CONFLICT'), state, cashParam), false, other);
  });
  test(`declaration: refund same final ${final} empty success works across receipt IDs; other finals reject`, () => {
    const state = refundState(final, final);
    state.status = final === 'succeeded' ? 'REFUNDED' : 'REFUND_FAILED';
    const name = refundNames[CASH_RESULT_KINDS.indexOf(final)];
    assert.equal(declaredCondition(guard(name, 'IR-FO-REFUND-FINAL-CONFLICT'), state, refundParam), true);
    assert.equal(guard(name, 'IR-FO-REFUND-FINAL-ONCE').onFail, 'succeed-empty');
    assert.equal(state.refundFinalResults.contains('refund-1'), true);
    for (const other of CASH_RESULT_KINDS.filter((kind) => kind !== final)) assert.equal(declaredCondition(guard(refundNames[CASH_RESULT_KINDS.indexOf(other)], 'IR-FO-REFUND-FINAL-CONFLICT'), state, refundParam), false, other);
  });
}

test('declaration: rejected/compensated can associate before order selectedPaymentTxId/Prepare/Commit', () => {
  const state = cashState();
  for (const kind of ['rejected-before-effects', 'compensated', 'recovery-required', 'outcome-unknown']) {
    assert.equal(declaredCondition(guard(cashName(kind), 'IR-FO-CASH-RESULT-ASSOCIATION'), state, cashParam), true);
    assert.ok(!command(cashName(kind)).guards.some((g) => g.cond?.includes('state.selectedPaymentTxId')));
  }
  assert.equal(declaredCondition(guard(cashName('succeeded'), 'IR-FO-CASH-RESULT-SUCCESS-EVIDENCE'), state, cashParam), false);
  const bridge = cashBody(artifacts).paymentResultBridge;
  assert.equal(bridge.association.requiresCommitForEveryKind, false);
  assert.equal(bridge.association.evidence, 'persisted-authorized-source-event-and-durable-saga-start');
  assert.equal(bridge.browserMayPublish, false);
  assert.equal(bridge.status, 'bridge-pending', 'true guard on empty state is not authenticated evidence');
});

test('declaration: recovery/unknown and legacy succeeded evidence cannot authorize TA or refund', () => {
  for (const observed of ['recovery-required', 'outcome-unknown']) {
    const state = cashState(observed, undefined, [['pay-1', 'exact-original-money']]);
    state.sagaResults = scalaMap([['pay-1', 'succeeded']]);
    state.selectedPaymentTxId = 'pay-1';
    assert.equal(declaredCondition(guard('RegisterFundTASubmission', 'IR-FO-CASH-SUCCEEDED'), state, { paymentTxId: 'pay-1' }), false);
    assert.equal(declaredCondition(guard('RequestFundPurchaseRefund', 'IR-FO-REFUND-PAYMENT-EVIDENCE'), state), false);
  }
});

test('declaration: established cash final fences subsequent order TCC phases', () => {
  for (const final of CASH_RESULT_KINDS.slice(0, 3)) {
    const state = cashState(final, final);
    Object.assign(state, { id: 'order-1', status: 'REQUESTED' });
    const params = { txid: 'pay-1', resource: 'order-1', amount: 'exact-original-money' };
    assert.equal(declaredCondition(guard('ReserveFundSubscription', 'IR-FO-CASH-TCC-PREPARE'), state, params), false);
    assert.equal(declaredCondition(guard('ConfirmFundSubscriptionPayment', 'IR-FO-CASH-TCC-COMMIT'), state, params), false);
    assert.equal(declaredCondition(guard('CancelFundSubscription', 'IR-FO-CASH-TCC-COMPENSATE'), state, params), false);
  }
});

test('declaration: a different payment txid is rejected after result or phase evidence', () => {
  for (const source of ['cashPaymentResults', 'cashPaymentFinalResults', 'reservedSubscriptions', 'committedSubscriptions', 'compensatedSubscriptions']) {
    const state = cashState(); state[source] = scalaMap([['other-pay', 'evidence']]);
    for (const kind of CASH_RESULT_KINDS) assert.equal(declaredCondition(guard(cashName(kind), 'IR-FO-CASH-RESULT-ASSOCIATION'), state, cashParam), false, source);
  }
});

test('declaration: refund receipt exact-body and cross-kind conflicts precede duplicate success', () => {
  for (const kind of CASH_RESULT_KINDS) {
    const name = refundNames[CASH_RESULT_KINDS.indexOf(kind)];
    const same = refundState('requested', undefined, kind);
    assert.equal(declaredCondition(guard(name, 'IR-FO-REFUND-RECEIPT-KIND'), same, refundParam), true);
    assert.equal(declaredCondition(guard(name, 'IR-FO-REFUND-RECEIPT-CONFLICT'), same, refundParam), true);
    assert.equal(declaredCondition(guard(name, 'IR-FO-REFUND-RECEIPT-CONFLICT'), same, { ...refundParam, receiptBody: 'different' }), false);
    for (const other of CASH_RESULT_KINDS.filter((k) => k !== kind)) assert.equal(declaredCondition(guard(refundNames[CASH_RESULT_KINDS.indexOf(other)], 'IR-FO-REFUND-RECEIPT-KIND'), same, refundParam), false, `${kind} receipt reused as ${other}`);
  }
});

test('declaration: UNKNOWN or arbitrary outcome cannot authorize refund result or new refund', () => {
  const c = command('RequestFundPurchaseRefund');
  for (const state of [
    { status: 'TA_ACCEPTED', taStatus: 'TA_ACCEPTED', taRejectionReason: '' },
    { status: 'TA_REJECTED', taStatus: 'UNKNOWN', taRejectionReason: 'unknown' },
  ]) assert.equal(declaredCondition(guard(c.name, 'IR-FO-REFUND-TA-REJECTED'), state), false);
  for (const invalid of ['', 'garbage', 'UNKNOWN', 'succeeded', 'rejected-before-effects', 'compensated']) assert.equal(declaredCondition(guard('RecordFundRefundCompleted', 'IR-FO-REFUND-RESULT-PHASE'), refundState(invalid), refundParam), false);
  assert.ok(!event('FundTAOutcomeUnknownObserved').foldAssignments.some((f) => ['status', 'taStatus', 'refundOutcome'].includes(f.slot)));
});

const canonicalMutations = [
  ['cash cancels through legacy no-reservation rejection', (s) => { s.canonical.sagas.find((row) => row.id === 'fund-purchase-payment-v2').payload.steps[2].phases.compensate.commandRef.name = 'CancelFundSubscription'; }],
  ['creation guard missing', (s) => { const c = s.canonical.aggregates.find(a => a.name === 'FundOrder').commands.find(c => c.name === 'RequestFundPurchaseSettlement'); c.guards = c.guards.filter(g => g.ref !== 'IR-FO-CASH-NO-RECREATE'); }],
  ['cash extra nonterminal write-once short circuit', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RecordFundCashPaymentSucceeded').guards.push({ ruleId: 'IR-FO-RESULT-001', errCode: '62010', onFail: 'succeed-empty', when: { form: 'map-absent', map: 'cashPaymentResults', key: 'param.txid' } }); }],
  ['cash extra final ledger removal', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundCashPaymentSucceeded').foldAssignments.push({ slot: 'cashPaymentFinalResults', op: 'remove', key: 'event.txid' }); }],
  ['cash success erases committed evidence', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundCashPaymentSucceeded').foldAssignments.push({ slot: 'committedSubscriptions', op: 'remove', key: 'event.txid' }); }],
  ['nonterminal adds order commit prerequisite', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RecordFundCashPaymentRecoveryRequired').guards.push({ ruleId: 'IR-FO-CASH-COMMITTED', errCode: '62107', onFail: 'reject', when: { form: 'map-contains', map: 'committedSubscriptions', key: 'param.txid' } }); }],
  ['cash positive failure becomes empty success', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RequestFundPurchaseSettlement').guards.find(g => g.ruleId === 'IR-FO-RESERVE-002').onFail = 'succeed-empty'; }],
  ['TA committed failure becomes empty success', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RegisterFundTASubmission').guards.find(g => g.ruleId === 'IR-FO-CASH-COMMITTED').onFail = 'succeed-empty'; }],
  ['TA UNKNOWN produces rejection', (s) => { s.canonical.aggregates.find(a => a.name === 'FundOrder').commands.find(c => c.name === 'RecordFundTAUnknown').produces = ['FundTARejected']; }],
  ['TA registration type disagrees with event', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RegisterFundTASubmission').parameters.find(p => p.name === 'paymentTxId').dataType = 'String'; }],
  ['TA registration missing source binding', (s) => { const e = s.canonical.aggregates.find(a => a.name === 'FundOrder').events.find(e => e.name === 'FundTASubmissionRegistered'); e.bindings = e.bindings.filter(b => b.slot !== 'taRequestId'); }],
  ['TA UNKNOWN overwrites request identity', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundTAOutcomeUnknownObserved').foldAssignments.push({ slot: 'taRequestId', expr: 'event.receiptId' }); }],
  ['TA UNKNOWN manufactures payment success', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundTAOutcomeUnknownObserved').foldAssignments.push({ slot: 'cashPaymentFinalResults', op: 'put', key: 'event.paymentTxId', value: 'literal:succeeded' }); }],
  ['FundShare NAV field disappears', (s) => { s.canonical.valueObjects.find(v => v.name === 'FundShare').fields = s.canonical.valueObjects.find(v => v.name === 'FundShare').fields.filter(f => f.name !== 'nav'); }],
  ['FundShare exact decimal becomes string', (s) => { s.canonical.valueObjects.find(v => v.name === 'FundShare').fields.find(f => f.name === 'shares').dataType = 'String'; }],
  ['refund operation reuses old payment binding', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundPurchaseRefundRequested').bindings.find(b => b.slot === 'refundOperationId').expr = 'state.operationId'; }],
  ['refund UNKNOWN fold declares success', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundPurchaseRefundOutcomeUnknownObserved').foldAssignments.find(f => f.slot === 'refundOutcome').expr = 'literal:succeeded'; }],
  ['refund duplicate terminal fold overwrites final', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundRefundCompleted').foldAssignments.push({ slot: 'refundFinalResults', op: 'put', key: 'event.refundTxId', value: 'literal:outcome-unknown' }); }],
  ['collection recipient', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-payment-v2').payload.participants[1].resourceRef.ref = 'args:investorAccountId'; }],
  ['order omitted', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-payment-v2').payload.steps.pop(); }],
  ['barrier bypass', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-payment-v2').payload.groups[2].dependsOn = [1]; }],
  ['amount from wrong slot', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-payment-v2').payload.steps[1].phases.prepare.bindings[2].ref = 'txid'; }],
  ['refund reverses direction', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-refund').payload.steps[0].phases.prepare.bindings[1].ref = 'args:investorAccountId'; }],
  ['refund reuses payment operation', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-refund').payload.triggers[0].idempotency.ref = 'source:paymentTxId'; }],
  ['cash completion uses old write-once ledger', (s) => { s.canonical.sagas.find((r) => r.id === 'fund-purchase-payment-v2').payload.completions[0].eventRef.name = 'result-succeeded'; }],
  ['cash nonterminal occupies final map', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundCashPaymentOutcomeUnknown').foldAssignments.push({ slot: 'cashPaymentFinalResults', op: 'put', key: 'event.txid', value: 'literal:outcome-unknown' }); }],
  ['cash final conflict absent', (s) => { const c = s.canonical.aggregates.find(a => a.name === 'FundOrder').commands.find(c => c.name === 'RecordFundCashPaymentSucceeded'); c.guards = c.guards.filter((g) => g.ref !== 'IR-FO-CASH-RESULT-FINAL-CONFLICT'); }],
  ['cash succeeds-empty on current nonterminal ledger', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RecordFundCashPaymentSucceeded').guards.find((g) => g.ruleId === 'IR-FO-CASH-RESULT-FINAL-ONCE').when.map = 'cashPaymentResults'; }],
  ['TA success accepts old sagaResults', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RegisterFundTASubmission').guards.find((g) => g.ref === 'IR-FO-CASH-SUCCEEDED').cond = 'state.sagaResults.get(param.paymentTxId).contains("succeeded")'; }],
  ['TA request/payment association removed', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RecordFundTAConfirmed').guards.find((g) => g.ref === 'IR-FO-TA-CORRELATION').cond = 'param.fundCode == state.fundCode'; }],
  ['TA typed shares invented', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RecordFundTAConfirmed').parameters.find((p) => p.name === 'shares').dataType = 'Money'; }],
  ['refund amount caller controlled', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundPurchaseRefundRequested').bindings.find((r) => r.slot === 'amount').expr = 'param.amount'; }],
  ['UNKNOWN permits refund', (s) => { declarationIndex(s.canonical).get('command:FundOrder.RequestFundPurchaseRefund').guards.find((g) => g.ref === 'IR-FO-REFUND-TA-REJECTED').cond = 'state.taObservation == "UNKNOWN"'; }],
  ['refund same receipt bypasses final conflict', (s) => { const c = declarationIndex(s.canonical).get('command:FundOrder.RecordFundRefundCompleted'); const i = c.guards.findIndex((g) => g.ref === 'IR-FO-REFUND-FINAL-CONFLICT'); c.guards.push(c.guards.splice(i, 1)[0]); }],
  ['refund receipt kind omitted', (s) => { const c = s.canonical.aggregates.find(a => a.name === 'FundOrder').commands.find(c => c.name === 'RecordFundRefundCompleted'); c.guards = c.guards.filter((g) => g.ref !== 'IR-FO-REFUND-RECEIPT-KIND'); }],
  ['refund result kind slot missing', (s) => { const e = s.canonical.aggregates.find(a => a.name === 'FundOrder').events.find(e => e.name === 'FundRefundCompleted'); e.payloads = e.payloads.filter((p) => p.name !== 'resultKind'); }],
  ['TA registered bridge source slot missing', (s) => { const e = s.canonical.aggregates.find(a => a.name === 'FundOrder').events.find(e => e.name === 'FundTASubmissionRegistered'); e.payloads = e.payloads.filter((p) => p.name !== 'taRequestId'); }],
  ['TA receipt typed slot missing', (s) => { const e = s.canonical.aggregates.find(a => a.name === 'FundOrder').events.find(e => e.name === 'FundTASharesConfirmed'); e.payloads = e.payloads.filter((p) => p.name !== 'taRequestId'); }],
  ['refund nonterminal overwrites status', (s) => { declarationIndex(s.canonical).get('event:FundOrder.FundPurchaseRefundOutcomeUnknownObserved').foldAssignments.push({ slot: 'status', expr: 'literal:REFUNDED' }); }],
  ['supplemental completion mapper wrong command', (s) => { s.bindings.saga.sagas.find((b) => b.sagaId === 'fund-purchase-payment-v2').completionMappers[0].mapper = 'fixture.old.RecordResultSucceeded'; }],
];
for (const [label, mutation] of canonicalMutations) test(`negative canonical: ${label}`, () => {
  const s = structuredClone({ ...snapshot, bindings }); mutation(s);
  assert.ok(validateCashContract(s, artifacts).errors.length, label);
});
const foldDependencies = [
  ['ReserveFundSubscriptionConfirmed', 'reservedSubscriptions'], ['ReserveFundSubscriptionConfirmed', 'status'],
  ['FundSubscriptionPaymentConfirmed', 'status'], ['FundSubscriptionPaymentConfirmed', 'reservedSubscriptions'],
  ['FundTASubmissionRegistered', 'taRequestId'], ['FundTASubmissionRegistered', 'status'], ['FundTASubmissionRegistered', 'taStatus'],
  ['FundTAAccepted', 'taReference'], ['FundTASharesConfirmed', 'status'], ['FundTASharesConfirmed', 'taStatus'], ['FundTASharesConfirmed', 'taConfirmedShares'], ['FundTARejected', 'taRejectionReason'],
  ['FundPurchaseRefundRequested', 'refundOperationId'], ['FundPurchaseRefundRequested', 'status'],
  ['FundRefundCompleted', 'status'], ['FundCashSubscriptionCanceled', 'compensatedSubscriptions'], ['FundCashSubscriptionCanceled', 'status'],
];
for (const [name, slot] of foldDependencies) test(`negative dependent fold: ${name}.${slot} cannot disappear`, () => {
  const s = structuredClone({ ...snapshot, bindings });
  const e = s.canonical.aggregates.find(a => a.name === 'FundOrder').events.find(e => e.name === name);
  e.foldAssignments = e.foldAssignments.filter(f => f.slot !== slot);
  assert.ok(validateCashContract(s, artifacts).errors.length);
});
for (const [name, rule] of [['RegisterFundTASubmission', 'IR-FO-CASH-RESOURCE'], ['RecordFundTARejected', 'IR-FO-CASH-SUCCEEDED'], ['RecordFundRefundCompleted', 'IR-FO-REFUND-CORRELATION'], ['RecordFundRefundCompleted', 'IR-FO-REFUND-RECEIPT-CONFLICT']]) test(`negative authored order: ${name}/${rule} cannot follow duplicate success`, () => {
  const s = structuredClone({ ...snapshot, bindings });
  const c = declarationIndex(s.canonical).get(`command:FundOrder.${name}`);
  const at = c.guards.findIndex(g => (g.ref || g.ruleId) === rule);
  c.guards.push(c.guards.splice(at, 1)[0]);
  assert.ok(validateCashContract(s, artifacts).errors.length);
});
test('declaration: cash cancel before Prepare emits an empty-release fence and rejects late Prepare', () => {
  const state = { ...cashState(), id: 'order-1', status: 'REQUESTED' };
  const params = { txid: 'pay-1', resource: 'order-1', amount: state.amount };
  for (const rule of ['IR-FO-CASH-CANCEL-RESOURCE', 'IR-FO-CASH-CANCEL-ASSOCIATION', 'IR-FO-CASH-CANCEL-NO-COMMIT', 'IR-FO-CASH-CANCEL-PHASE']) assert.equal(declaredCondition(guard('CancelCashFundSubscription', rule), state, params), true);
  assert.equal(guard('CancelCashFundSubscription', 'IR-FO-CASH-CANCEL-ONCE').when.map, 'compensatedSubscriptions');
  assert.ok(!command('CancelCashFundSubscription').guards.some(g => g.when?.form === 'map-contains' && g.when.map === 'reservedSubscriptions'));
  const fence = event('FundCashSubscriptionCanceled');
  assert.ok(fence.foldAssignments.some(f => f.slot === 'compensatedSubscriptions' && f.value === 'state.amount'));
  state.status = 'CANCELED';
  state.compensatedSubscriptions = scalaMap([['pay-1', state.amount]]);
  assert.equal(declaredCondition(guard('ReserveFundSubscription', 'IR-FO-CASH-TCC-PREPARE'), state, params), false);
  assert.equal(declaredCondition(guard('CancelCashFundSubscription', 'IR-FO-CASH-CANCEL-ASSOCIATION'), state, params), true);
  assert.equal(state.compensatedSubscriptions.contains('pay-1'), true, 'duplicate fence succeeds before phase');
  assert.equal(declaredCondition(guard('CancelCashFundSubscription', 'IR-FO-CASH-CANCEL-ASSOCIATION'), state, { ...params, txid: 'other' }), false);
});
const bridgeMutations = [
  ['mock scenario list malformed', (b) => { b.mockConfiguration.scenarios = {}; }],
  ['mock currency drifts from CNY', (b) => { b.mockConfiguration.currency = 'USD'; }],
  ['mock fee drifts from zero', (b) => { b.mockConfiguration.feesMinorUnits = '1'; }],
  ['mock confirmation fixture missing', (b) => { delete b.mockConfiguration.scenarios.find((scenario) => scenario.id === 'confirmed').fixture; }],
  ['mock conflict scenario missing', (b) => { b.mockConfiguration.scenarios = b.mockConfiguration.scenarios.filter((scenario) => scenario.id !== 'duplicate-conflicting'); }],
  ['mock delayed confirmation immediate', (b) => { b.mockConfiguration.scenarios.find((scenario) => scenario.id === 'delayed').delayTicks = 0; }],
  ['browser may publish', (b) => { b.paymentResultBridge.browserMayPublish = true; }],
  ['pre-commit result requires commit', (b) => { b.paymentResultBridge.association.requiresCommitForEveryKind = true; }],
  ['payment targets spoofed order', (b) => { b.paymentResultBridge.association.target.sourceEventFieldRef = 'FundOrder.FundPurchaseSettlementRequested.investorAccountId'; }],
  ['payment source amount nonexistent', (b) => { b.paymentResultBridge.association.sourceFields.find((r) => r.stateFieldRef === 'FundOrder.amount').sourceEventFieldRef = 'FundOrder.FundPurchaseSettlementRequested.fake'; }],
  ['cash completion command is legacy', (b) => { b.paymentResultBridge.mapping[0].commandRef = 'FundOrder.RecordResultSucceeded'; }],
  ['cash missing unknown completion', (b) => { b.paymentResultBridge.mapping.pop(); }],
  ['recoverable declared terminal', (b) => { b.paymentResultBridge.terminalPolicy.terminalKinds.push('outcome-unknown'); }],
  ['terminal conflict silently accepted', (b) => { b.paymentResultBridge.terminalPolicy.conflictingFinal = 'succeed-empty'; }],
  ['TA requestId uses payment slot', (b) => { b.sourceRuntimeBoundaries.taTypedSlotBridge.requestMapping[0].sourceEventFieldRef = 'FundOrder.FundTASubmissionRegistered.paymentTxId'; }],
  ['TA receipt request from wrong wire field', (b) => { b.sourceRuntimeBoundaries.taTypedSlotBridge.receiptMapping[0].parameters.find((p) => p.commandParameter === 'taRequestId').wireField = 'receiptId'; }],
  ['TA exact body replaced', (b) => { b.sourceRuntimeBoundaries.taTypedSlotBridge.receiptMapping[1].parameters.find((p) => p.commandParameter === 'receiptBody').wireField = 'parsed-reformatted-body'; }],
  ['refund operation source wrong', (b) => { b.sourceRuntimeBoundaries.refundResultReconciliation.identityMapping[2].sourceEventFieldRef = 'FundOrder.FundPurchaseSettlementRequested.operationId'; }],
  ['refund amount association nonexistent', (b) => { b.sourceRuntimeBoundaries.refundResultReconciliation.exactArgs[2].stateFieldRef = 'FundOrder.refundAmount'; }],
  ['refund waits on write-once generic ledger', (b) => { b.sourceRuntimeBoundaries.refundResultReconciliation.genericCompletionIsSoleAuthority = true; }],
  ['refund kind mapping swapped', (b) => { b.sourceRuntimeBoundaries.refundResultReconciliation.mapping[0].commandRef = 'FundOrder.RecordFundPurchaseRefundOutcomeUnknown'; }],
  ['refund missing fifth mapping', (b) => { b.refundResultBridge.mapping.pop(); }],
  ['refund unknown becomes final', (b) => { b.sourceRuntimeBoundaries.refundResultReconciliation.terminalPolicy.recoverableKinds = ['recovery-required']; }],
];
for (const [label, mutation] of bridgeMutations) test(`negative source bridge: ${label}`, () => {
  const rows = structuredClone(artifacts); mutation(cashBody(rows));
  assert.ok(validateCashContract({ ...snapshot, bindings }, rows).errors.length, label);
});
