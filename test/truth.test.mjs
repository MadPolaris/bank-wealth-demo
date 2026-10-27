import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot, sourceGates, loadBindings, mergeBindings, protectedFiles, protectionReport, roundtripLocal, declarationIndex, assertSnapshotStable } from '../tools/truth-source.mjs';
import { validateDeclarations, validateArtifacts, extractArtifacts } from '../tools/artifacts.mjs';

const snapshot = loadSnapshot();
const mutate = () => structuredClone(snapshot);

test('portable structure, strict Saga and strict Execution admit the current truth', () => {
  const result = sourceGates(snapshot);
  assert.deepEqual(result.structure.hard, []);
  assert.equal(result.saga.ok, true, JSON.stringify(result.saga.diagnostics));
  assert.equal(result.execution.ok, true, JSON.stringify(result.execution.diagnostics));
  assert.equal(result.lowering.ok, true, JSON.stringify(result.lowering.diagnostics));
  assert.equal(result.lowering.readiness, 'lowered-contract-only');
  assert.equal(result.lowering.runnable, false);
  assert.equal(result.lowering.runtimeBindingVerified, false);
});
test('owned declarations and proposal references close without invented fields', () => {
  assert.deepEqual(validateDeclarations(snapshot).errors, []);
  assert.deepEqual(validateArtifacts(snapshot).errors, []);
});
test('protected contracts and historical examples remain byte-identical', () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, 'docs/BASELINE.json'), 'utf8'));
  assert.deepEqual(protectedFiles(ROOT, baseline.protectedFiles), baseline.protectedFiles);
  assert.equal(protectionReport().ok, true, JSON.stringify(protectionReport()));
});
test('original numerical capture positions survive address correction', () => {
  let originals = 0;
  for (const { doc } of snapshot.atoms) {
    const source = doc.payload?.sourceCapture?.atom;
    if (source?.origin) { assert.equal(doc.origin.seq, source.origin.seq); originals++; }
  }
  assert.ok(originals >= 10, 'colliding imported notes must retain their original capture');
});
test('canonical, relative paths and atom bytes roundtrip in owned scratch', () => {
  assert.deepEqual(roundtripLocal(snapshot), { ok: true, atoms: snapshot.atoms.length });
});
test('new request state is retained by event fields, not vanished command inputs', () => {
  const index = declarationIndex(snapshot.canonical);
  for (const [aggregate, eventName, names] of [
    ['FundOrder', 'FundPurchaseRequested', ['operationId', 'investorAccountId', 'fundCode', 'amount']],
    ['SipPlan', 'SipPlanCreated', ['investorAccountId', 'externalOrderId', 'fundCode', 'cronExpr', 'deductionAmount']],
  ]) {
    const event = index.get(`event:${aggregate}.${eventName}`);
    for (const name of names) {
      assert.ok(index.has(`state-field:${aggregate}.${name}`));
      assert.ok(event.foldAssignments.some((fold) => fold.slot === name && fold.expr === `event.${name}`));
    }
  }
});
test('SIP duplicate handling precedes ACTIVE gate; TA confirmation is payment-gated', () => {
  const index = declarationIndex(snapshot.canonical);
  const trigger = index.get('command:SipPlan.TriggerSipInstallment');
  const duplicate = trigger.guards.findIndex((guard) => guard.onFail === 'succeed-empty');
  const active = trigger.guards.findIndex((guard) => (guard.ruleId || guard.ref) === 'IR-SIP-TRIGGER-002');
  assert.ok(duplicate >= 0 && active > duplicate);
  assert.deepEqual(trigger.guards[active].from, ['ACTIVE']);
  const confirm = index.get('command:FundOrder.RecordTAShareConfirmation');
  assert.ok(confirm.guards.some((guard) => guard.kind === 'statusTransition' && guard.from?.includes('PAYMENT_SETTLED')));
});
test('unconditional three-failure policy is not retained as an executable invocation', () => {
  assert.ok(!snapshot.atoms.some(({ doc }) => doc.kind === 'policy' && doc.name === 'AutoPauseSipOnThreeFailures'));
});
test('artifact inspection returns detached data without mutating the verified snapshot', () => {
  const before = JSON.stringify(snapshot.atoms);
  const artifacts = extractArtifacts(snapshot);
  artifacts.find((artifact) => artifact.id === 'ux.cash-v2').body.states[0].evidence.eventRef = 'invented';
  assert.equal(JSON.stringify(snapshot.atoms), before);
});
test('negative: nonexistent read-model event slot is rejected', () => {
  const broken = mutate();
  broken.canonical.readModels[0].fields[0].source = 'eventField:FundSubscriptionPaymentConfirmed.status';
  assert.ok(validateDeclarations(broken).errors.some((error) => error.includes('missing actual event slot')));
});
test('negative: unconsumed field source and mismatched rule code are rejected', () => {
  const broken = mutate();
  broken.canonical.readModels[0].consumesEvents = [];
  broken.canonical.aggregates[0].commands[0].guards[0].errCode = 'WRONG';
  const errors = validateDeclarations(broken).errors;
  assert.ok(errors.some((error) => error.includes('is not consumed')));
  assert.ok(errors.some((error) => error.includes('rule/error mismatch')));
});
test('negative: duplicate capture address and unknown atom kind are rejected', () => {
  const broken = mutate();
  const note = broken.atoms.find(({ doc }) => doc.kind === 'note');
  broken.atoms.push(structuredClone(note));
  broken.atoms.push({ file: 'unsupported.yaml', doc: { kind: 'ui-screen' } });
  const errors = validateDeclarations(broken).errors;
  assert.ok(errors.some((error) => error.includes('duplicate capture address')));
  assert.ok(errors.some((error) => error.includes('unsupported atom kind')));
});
test('negative: duplicate proposal ID, broken entity edge and runtime claims are rejected', () => {
  const artifacts = extractArtifacts(snapshot);
  artifacts.push(structuredClone(artifacts[0]));
  artifacts[0].status = 'runtime-certified';
  artifacts[0].body.edges = [{ from: 'invented-screen', to: 'missing-status' }];
  const errors = validateArtifacts(snapshot, artifacts).errors;
  assert.ok(errors.some((error) => error.includes('Duplicate artifact')));
  assert.ok(errors.some((error) => error.includes('cannot be certified')));
  assert.ok(errors.some((error) => error.includes('edge source missing')));
});
test('negative: proposal command reference and form authority must be explicit', () => {
  const artifacts = extractArtifacts(snapshot);
  artifacts[0].references.push({ kind: 'command', id: 'SipPlan.CancelSipPlan' });
  artifacts[0].body.testAction = { commandRef: 'FundOrder.RequestFundPurchase', parameters: [{ name: 'txid', source: 'auto-from-origin' }] };
  const errors = validateArtifacts(snapshot, artifacts).errors;
  assert.ok(errors.some((error) => error.includes('SipPlan.CancelSipPlan')));
  assert.ok(errors.some((error) => error.includes('unknown parameter txid')));
  assert.ok(errors.some((error) => error.includes('input authority')));
});
test('negative: money delta cannot reference missing event or vanished command input', () => {
  for (const delta of ['event.missingAmount', 'param.amount']) {
    const broken = mutate();
    const event = broken.canonical.aggregates.find((aggregate) => aggregate.name === 'CreditBalance').events.find((entry) => entry.name === 'ReserveFundsConfirmed');
    event.foldAssignments.find((fold) => fold.op === 'money-apply').delta = delta;
    assert.ok(validateDeclarations(broken).errors.some((error) => error.includes('missing event slot') || error.includes('vanished command input')));
  }
});
test('negative: incomplete, duplicate and object-form command mappings are rejected', () => {
  for (const mode of ['incomplete', 'duplicate', 'object']) {
    const artifacts = extractArtifacts(snapshot);
    const skeleton = artifacts.find((artifact) => artifact.id === 'ux.skeleton');
    const action = skeleton.body.screens.find((screen) => screen.id === 'screen.purchase').actions[0];
    if (mode === 'incomplete') action.parameters = [action.parameters.find((parameter) => parameter.name === 'fundCode')];
    if (mode === 'duplicate') action.parameters.push(structuredClone(action.parameters[0]));
    if (mode === 'object') artifacts.find((artifact) => artifact.category === 'mock-ta').body.confirmationMapping.parameters.txid = 'invented';
    const errors = validateArtifacts(snapshot, artifacts).errors;
    assert.ok(errors.some((error) => /omits required parameter|duplicate parameter|unknown parameter/.test(error)));
  }
});
test('negative: trace field, parameter and copied binding evidence are authenticated', () => {
  for (const key of ['eventFieldRef', 'stateFieldRefs', 'commandParameter', 'binding']) {
    const artifacts = extractArtifacts(snapshot);
    const row = artifacts.find((artifact) => artifact.category === 'traceability').body.rows[0];
    if (key === 'eventFieldRef') row[key] = 'CreditBalance.ExternalTopUpRequested.fake';
    if (key === 'stateFieldRefs') row[key] = ['CreditBalance.fake'];
    if (key === 'commandParameter') row[key] = 'fake';
    if (key === 'binding') row[key].expr = 'param.fake';
    assert.ok(validateArtifacts(snapshot, artifacts).errors.length, key);
  }
});
test('negative: typed screen identity and journey action destination are checked', () => {
  for (const mode of ['wrong-type', 'missing-target', 'wrong-destination']) {
    const artifacts = extractArtifacts(snapshot);
    const structure = artifacts.find((artifact) => artifact.category === 'ux-structure');
    const skeleton = artifacts.find((artifact) => artifact.category === 'ux-skeleton');
    if (mode === 'wrong-type') structure.body.journeys[0].steps[0].screenId = 'message.empty';
    if (mode === 'missing-target') skeleton.body.screens[0].actions[0].targetScreenId = 'screen.fake';
    if (mode === 'wrong-destination') structure.body.journeys[1].steps[2].action = 'action.open-purchase';
    assert.ok(validateArtifacts(snapshot, artifacts).errors.length, mode);
  }
});
test('negative: malformed explicit edges and numeric graph nodes cannot disappear silently', () => {
  for (const mode of ['edge', 'node']) {
    const artifacts = extractArtifacts(snapshot);
    const context = artifacts.find((artifact) => artifact.category === 'context-map');
    if (mode === 'edge') context.body.edges[0].to = 42;
    else context.body.nodes.push({ id: 42, label: 'invalid node' });
    assert.ok(validateArtifacts(snapshot, artifacts).errors.some((error) => /malformed explicit edge|unregistered projection node/.test(error)));
  }
});
test('negative: scenario summary labels cannot replace actual MockTA outcome contracts', () => {
  const artifacts = extractArtifacts(snapshot);
  artifacts.find((artifact) => artifact.category === 'mock-ta').body.scenarios = [];
  assert.equal(validateArtifacts(snapshot, artifacts).errors.filter((error) => error.includes('missing simulated outcome')).length, 7);
});
test('stale truth/binding fingerprint cannot be reported as the current snapshot', () => {
  assert.throws(() => assertSnapshotStable({ ...snapshot, sourceFingerprint: 'stale' }), /Concurrent bank-wealth truth/);
});
test('supplemental bindings close uniquely without mutating historical authority', () => {
  const saga = JSON.parse(readFileSync(join(ROOT, 'bindings.json'), 'utf8'));
  const supplemental = JSON.parse(readFileSync(join(ROOT, 'wealth-bindings.json'), 'utf8'));
  const before = structuredClone(saga);
  const combined = loadBindings();
  assert.deepEqual(saga, before);
  assert.equal(combined.saga.sagas.length, 4);
  assert.equal(combined.execution.pipelines.length, 4);
  assert.equal(combined.runtime.sagas.length, 4);
  assert.deepEqual(combined.execution.sagaBindings, combined.saga);
  for (const entry of supplemental.sagas) assert.equal(combined.saga.sagas.filter((row) => row.sagaId === entry.sagaId).length, 1);
});
test('negative: duplicate supplemental identities, schema and runtime target drift fail closed', () => {
  const base = { schemaVersion: 'v1', sagas: [{ sagaId: 'one' }] };
  assert.throws(() => mergeBindings(base, { schemaVersion: 'v1', sagas: [{ sagaId: 'one' }] }, 'sagas', 'sagaId'), /Duplicate supplemental/);
  assert.throws(() => mergeBindings(base, { schemaVersion: 'v2', sagas: [] }, 'sagas', 'sagaId'), /Incompatible supplemental/);
  assert.throws(() => mergeBindings({ ...base, target: { runtime: 'x' } }, { ...base, target: { runtime: 'y' }, sagas: [] }, 'sagas', 'sagaId'), /target differs/);
});
