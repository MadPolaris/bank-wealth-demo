import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, protectedFiles } from '../tools/truth-source.mjs';
import { extractArtifacts, renderProjections, validateArtifacts } from '../tools/artifacts.mjs';
import { checkProjections } from '../tools/project.mjs';

const snapshot = loadSnapshot();
test('two renders produce byte-identical projections without source mutations', () => {
  const before = protectedFiles();
  assert.deepEqual([...renderProjections(snapshot)], [...renderProjections(snapshot)]);
  assert.deepEqual(protectedFiles(), before);
});
test('checked-in derived outputs match the current truth', () => {
  assert.equal(checkProjections(snapshot).ok, true, JSON.stringify(checkProjections(snapshot)));
});
test('projection index retains exact note source pointers and proposal readiness', () => {
  const index = JSON.parse(renderProjections(snapshot).get('index.json'));
  assert.equal(index.readiness, 'design-proposal-only');
  assert.equal(index.sourceDigest, snapshot.canonicalSha256);
  for (const artifact of index.artifacts) {
    assert.equal(artifact.source.pointer, '/payload/info/artifact');
    assert.ok(snapshot.atoms.some(({ file }) => `tree/${file}` === artifact.source.file));
    assert.equal(artifact.source.line, undefined, 'do not invent line-level compiler source maps');
  }
});
test('five product planes and explicit story-map backbone are present', () => {
  const artifacts = extractArtifacts(snapshot);
  for (const category of ['ux-strategy', 'ux-scope', 'ux-structure', 'ux-skeleton', 'ux-surface']) {
    assert.ok(artifacts.some((artifact) => artifact.category === category));
  }
  const scope = artifacts.find((artifact) => artifact.category === 'ux-scope');
  assert.ok(scope.body.backbone.length >= 3);
  assert.ok(scope.body.tasks.some((task) => task.storyRef === 'PurchaseFund'));
  assert.ok(renderProjections(snapshot).get('story-map.md').includes('PurchaseFund'));
});
test('journey projection preserves membership, story, actor, action and information needs', () => {
  const structure = extractArtifacts(snapshot).find((artifact) => artifact.category === 'ux-structure');
  const rendered = renderProjections(snapshot).get('journeys.md');
  for (const journey of structure.body.journeys) {
    assert.ok(rendered.includes(journey.storyRef));
    for (const step of journey.steps) {
      assert.ok(rendered.includes(step.actor));
      assert.ok(rendered.includes(step.action));
      for (const need of step.informationNeeds) assert.ok(rendered.includes(need));
    }
  }
});
test('cash projections preserve distinct receipt, refund and input authority semantics', () => {
  const cash = extractArtifacts(snapshot).find((artifact) => artifact.id === 'ux.cash-v2');
  const rendered = renderProjections(snapshot);
  assert.equal(rendered.size, 9);
  assert.ok(rendered.get('journeys.md').includes('CashFundPurchaseLifecycle'));
  assert.ok(rendered.get('story-map.md').includes('CashFundPurchaseLifecycle'));
  for (const state of cash.body.states) assert.ok(rendered.get('cash-experience.md').includes(state.evidence.eventRef));
  for (const event of ['FundPurchaseSettlementRequested', 'FundTAOutcomeUnknownObserved', 'FundTARejected', 'FundPurchaseRefundRequested', 'FundRefundCompleted']) assert.ok(rendered.get('cash-lifecycle.md').includes(`FundOrder.${event}`));
  const request = cash.body.screens.flatMap((screen) => screen.actions).find((action) => action.commandRef);
  assert.equal(request.commandRef, 'FundOrder.RequestFundPurchaseSettlement');
  assert.equal(request.parameters.find((slot) => slot.name === 'fundCollectionAccountId').source, 'trusted-context');
  assert.ok(cash.body.feedbackRules.some((rule) => rule.includes('UNKNOWN') || rule.includes('未知')));
});
test('negative: cash graph cannot authorize refund from unknown or claim request as completion', () => {
  for (const mode of ['unknown', 'payment-unknown', 'request']) {
    const artifacts = extractArtifacts(snapshot);
    const flow = artifacts.find((artifact) => artifact.category === 'cash-flow');
    if (mode === 'unknown' || mode === 'payment-unknown') flow.body.edges.push({ from: mode === 'unknown' ? 'cash-flow.unknown' : 'cash-flow.payment-unknown', to: 'cash-flow.refund-request', label: 'invalid shortcut' });
    else flow.body.entities.find((node) => node.id === 'cash-flow.refunded').eventRef = 'FundOrder.FundPurchaseRefundRequested';
    assert.ok(validateArtifacts(snapshot, artifacts).errors.length, mode);
  }
});
test('negative: cash input authority, entry isolation and feedback evidence are checked', () => {
  for (const mode of ['account', 'legacy', 'evidence', 'enabled', 'actor']) {
    const artifacts = extractArtifacts(snapshot);
    const cash = artifacts.find((artifact) => artifact.id === 'ux.cash-v2');
    const action = cash.body.screens[0].actions.find((entry) => entry.commandRef);
    if (mode === 'account') action.parameters.find((slot) => slot.name === 'fundCollectionAccountId').source = 'user';
    if (mode === 'legacy') action.commandRef = 'FundOrder.RequestFundPurchase';
    if (mode === 'evidence') cash.body.states.find((state) => state.id === 'cash-state.refund-complete').evidence.eventRef = 'FundOrder.FundPurchaseRefundRequested';
    if (mode === 'enabled') action.availability.runtimeEnabled = true;
    if (mode === 'actor') cash.body.journeys[0].steps[0].actor = 'invented-role';
    assert.ok(validateArtifacts(snapshot, artifacts).errors.length, mode);
  }
});
