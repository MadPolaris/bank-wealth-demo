import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot } from '../tools/truth-source.mjs';
import { extractArtifacts, validateArtifacts } from '../tools/artifacts.mjs';

const snapshot = loadSnapshot();
const IDS = ['decision.i0-baseline-coverage', 'decision.i0-boundary-ownership', 'decision.cash-first-slice-design'];
const NAMES = ['I0BaselineCoverageDesignProposal', 'I0BoundaryOwnershipDesignProposal', 'CashFirstSliceDesignProposal'];
const source = extractArtifacts(snapshot);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const populated = (value) => Array.isArray(value) && value.length > 0;

// Bank-specific design acceptance only. Public artifact syntax/semantic support is not extended here.
function designErrors(artifacts) {
  const errors = [...validateArtifacts(snapshot, artifacts).errors];
  const check = (ok, where, message) => { if (!ok) errors.push(`${where}: ${message}`); };
  const notes = IDS.map((id) => artifacts.find((artifact) => artifact.id === id));
  for (const [i, note] of notes.entries()) {
    if (!note) { errors.push(`missing ${IDS[i]}`); continue; }
    check(note.status === 'demo-proposal' && note.category === 'decision', note.id, 'must remain a design proposal');
    check(note.provenance?.workshopHeld === false, note.id, 'no invented workshop');
    check(note.body?.decisionStatus === 'open', note.id, 'unresolved decisions must not be auto-approved');
    check(note.body?.authorization?.direction === 'user-approved' && note.body.authorization.implementationScope === 'I0-source-and-design-only' && note.body.authorization.newBusinessPoliciesApproved === false, note.id, 'direction approval is not new policy approval');
    check(note.source?.board === 'wealth-i0-design-v1' && note.source?.seq === i && note.source?.stage === 'refining', note.id, 'new board order must be stable');
    check(note.source?.note === `question:${NAMES[i]}`, note.id, 'note identity mismatch');
    check(Array.isArray(note.body?.entities) && note.body.entities.length === 0 && Array.isArray(note.body?.edges) && note.body.edges.length === 0, note.id, 'do not invent graph or execution entities');
  }
  const [coverage, ownership, cash] = notes.map((note) => note?.body);
  if (coverage) {
    check(populated(coverage.coverageRows), IDS[0], 'needs three-plane coverage');
    for (const id of ['I0-C01', 'I0-C06', 'I0-C08', 'I0-C10', 'I0-C11']) check((coverage.coverageRows || []).some((row) => row.id === id && nonempty(row.topic)), IDS[0], `required demo coverage missing ${id}`);
    const rowIds = new Set();
    for (const row of coverage.coverageRows || []) {
      check(nonempty(row.id) && !rowIds.has(row.id), IDS[0], 'coverage row identity must be unique'); rowIds.add(row.id);
      check(['required', 'deferred', 'excluded', 'undecided'].includes(row.scope) && nonempty(row.scopeBasis), row.id, 'scope and source basis missing');
      check(['proposed', 'declared', 'open'].includes(row.design), row.id, 'design evidence must remain distinct');
      check(nonempty(row.owner) && nonempty(row.iteration), row.id, 'needs owner and next slice');
      for (const plane of ['business', 'product', 'technical']) check(nonempty(row[plane]?.presence) && Array.isArray(row[plane]?.evidenceRefs) && Array.isArray(row[plane]?.gaps), row.id, `${plane} coverage/evidence/gaps missing`);
    }
    check(populated(coverage.scopeDecisions), IDS[0], 'needs unresolved scope decisions');
    const decisionIds = new Set();
    for (const decision of coverage.scopeDecisions || []) {
      check(nonempty(decision.id) && !decisionIds.has(decision.id), IDS[0], 'scope decision IDs must be unique');
      decisionIds.add(decision.id);
      check(nonempty(decision.question) && decision.status === 'open' && nonempty(decision.owner) && populated(decision.sourceRefs), decision.id || IDS[0], 'open decision needs question/owner/source');
    }
    check(JSON.stringify(coverage.evidencePolicy?.requiredDimensions) === JSON.stringify(['scope', 'design', 'evidence']), IDS[0], 'must distinguish scope/design/evidence');
    check(coverage.evidencePolicy?.currentDesignCompleteness !== 'complete', IDS[0], 'I0 inventory must not claim complete business/product/technical design');
    check(coverage.evidencePolicy?.historicalAcceptance === 'second-batch-only' && coverage.evidencePolicy?.currentAcceptance === 'pending', IDS[0], 'source note is not a machine receipt');
    check(coverage.externalBoundaries?.fundCompany === 'simulation-authorized' && coverage.externalBoundaries?.externalBankMock === 'not-authorized', IDS[0], 'TA authorization must not expand to external bank');
    check(coverage.draftDisposition?.status === 'paused-preserve' && coverage.draftDisposition?.resumeBankLocalGenerationShim === false && populated(coverage.draftDisposition?.files), IDS[0], 'paused drafts remain preserved, not resumed');
  }
  if (ownership) {
    check(populated(ownership.ownershipRows) && populated(ownership.toolDisposition), IDS[1], 'needs repository and tool ownership');
    for (const tool of ownership.toolDisposition || []) check(nonempty(tool.file) && nonempty(tool.classification) && tool.retain !== undefined && tool.publicFeedback !== undefined, IDS[1], 'tool needs explicit retention and public feedback disposition');
    for (const row of ownership.ownershipRows || []) check(nonempty(row.id) && nonempty(row.ownerLayer) && populated(row.retainedResponsibilities) && populated(row.forbiddenResponsibilities), row.id || IDS[1], 'owner responsibilities/boundaries missing');
    check(ownership.crossRepoExecutionAuthorized === false, IDS[1], 'this source batch must not authorize sibling writes');
    for (const capability of ['core-plan-apply', 'one-to-many-anchors']) check(ownership.reuseExisting?.includes(capability), IDS[1], `reuse existing ${capability}, do not rebuild`);
    check(populated(ownership.feedbackProtocol), IDS[1], 'needs upstream feedback and consumer path');
    const extensions = ownership.publicExtensions || [];
    check(extensions.length === 10 && new Set(extensions.map((entry) => entry.id)).size === 10, IDS[1], 'ten unique explicit extensions');
    for (let i = 1; i <= 10; i++) {
      const id = `X${String(i).padStart(2, '0')}`, extension = extensions.find((entry) => entry.id === id);
      if (!extension) { errors.push(`missing ${id}`); continue; }
      check(extension.status === 'proposal' && extension.owner === 'metarch-truthsrc', id, 'portable changes remain public proposals');
      for (const key of ['input', 'output', 'migration', 'deprecationPath']) check(nonempty(extension[key]), id, `${key} contract missing`);
      for (const key of ['codeAreas', 'nonGoals', 'compatibility', 'positiveTests', 'negativeTests', 'exitGates']) check(populated(extension[key]), id, `${key} boundary/gate missing`);
      check(Array.isArray(extension.dependsOn) && extension.dependsOn.every((id) => /^X(?:0[1-9]|10)$/.test(id) && id !== extension.id), id, 'dependency list must resolve to another public extension');
      check(populated(extension.bankReproducer?.sourceRefs) && nonempty(extension.bankReproducer?.scenario), id, 'needs concrete bank input/reproducer');
      check(nonempty(extension.secondDomainFixture?.domain) && nonempty(extension.secondDomainFixture?.scenario) && extension.secondDomainFixture?.status === 'proposed', id, 'needs distinct non-bank feature exercise, not claimed implemented fixture');
      check(!/bank|wealth|fund/i.test(extension.secondDomainFixture?.domain || ''), id, 'second fixture must not merely rename bankwealth');
    }
  }
  if (cash) {
    check(cash.sliceBoundary?.businessContractArtifact === 'contract.cash-purchase-v2' && populated(cash.sliceBoundary?.included) && populated(cash.sliceBoundary?.excluded), IDS[2], 'reference existing cash contract and explicit boundary');
    check(cash.sliceBoundary?.customerFinalSuccess === 'TA-confirmed-not-payment-marker', IDS[2], 'payment marker is not final fund success');
    for (const plane of ['strategy', 'scope', 'structure', 'skeleton', 'surface']) {
      const entry = cash.productPlanes?.find((record) => record.plane === plane);
      check(nonempty(entry?.intent) && populated(entry?.sourceRefs) && populated(entry?.requirements) && Array.isArray(entry?.gaps), IDS[2], `five-element ${plane} missing`);
    }
    check(cash.productPlanes?.length === 5, IDS[2], 'exact five named product planes');
    check(populated(cash.technicalNeeds) && populated(cash.acceptanceObligations), IDS[2], 'technical bindings and layered acceptance must be specified');
    for (const need of cash.technicalNeeds || []) check(nonempty(need.id) && nonempty(need.topic) && need.status === 'proposal' && populated(need.sourceRefs) && populated(need.requirements) && Array.isArray(need.publicExtensions), need.id || IDS[2], 'technical proposal/requirements/reference missing');
    for (const obligation of cash.acceptanceObligations || []) check(nonempty(obligation.id) && nonempty(obligation.layer) && nonempty(obligation.scenario) && nonempty(obligation.expectedEvidence) && nonempty(obligation.forbiddenClaim), obligation.id || IDS[2], 'actual evidence and non-claim missing');
    check(JSON.stringify(cash.inputAuthority?.user) === JSON.stringify(['fundCode', 'amount']), IDS[2], 'user inputs must not supply accounts or results');
    check(JSON.stringify(cash.inputAuthority?.trustedContext) === JSON.stringify(['investorAccountId', 'fundCollectionAccountId']) && JSON.stringify(cash.inputAuthority?.hostGenerated) === JSON.stringify(['operationId', 'fundOrderId']) && cash.inputAuthority.machineOnlyResults === true, IDS[2], 'trusted identity/result inputs need explicit authority');
    check(cash.safety?.unknownAllowsNewDebit === false && cash.safety?.unknownAllowsRefund === false && cash.safety?.legacyCashDoubleDispatchAllowed === false, IDS[2], 'unknown and entry isolation must fail closed');
    check(cash.consumerStatus?.publicSchema === 'proposal-only' && cash.consumerStatus?.generatedApplication === 'not-run' && cash.consumerStatus?.runtimeBindingVerified === false && cash.consumerStatus?.runnable === false, IDS[2], 'do not claim schema/consumer/runtime implemented');
    const decisions = new Set((coverage?.scopeDecisions || []).map((entry) => entry.id));
    check(populated(cash.unresolvedDecisionIds) && cash.unresolvedDecisionIds.every((id) => decisions.has(id)), IDS[2], 'cash decisions must refer to the single scope register');
    const extensionIds = new Set((ownership?.publicExtensions || []).map((entry) => entry.id));
    for (const need of cash.technicalNeeds || []) check((need.publicExtensions || []).every((id) => extensionIds.has(id)), need.id, 'missing upstream extension linkage');
    for (const key of ['operationId', 'fundOrderId']) check(!cash.inputAuthority.user.includes(key), IDS[2], 'browser cannot choose business operation identity');
  }
  return errors;
}

function mutate(id, action) {
  const artifacts = structuredClone(source);
  const note = artifacts.find((entry) => entry.id === id);
  assert.ok(note, `missing I0 input ${id}`);
  action(note);
  return artifacts;
}

test('I0 has three provenance-preserving proposals with three-plane coverage and no execution claims', () => {
  assert.deepEqual(designErrors(source), []);
  for (const id of IDS) {
    const artifact = source.find((entry) => entry.id === id);
    const atom = snapshot.atoms.find((entry) => `tree/${entry.file}` === artifact.source.file);
    assert.equal(atom.doc.payload.sourceCapture, undefined, 'new proposals must not pretend to be corrected imports');
    assert.equal(artifact.source.pointer, '/payload/info/artifact');
  }
});

test('cash design references existing contract, experience and lifecycle instead of duplicating authority', () => {
  const note = source.find((entry) => entry.id === IDS[2]);
  for (const id of ['contract.cash-purchase-v2', 'ux.cash-v2', 'flow.cash-v2']) assert.ok(note.references.some((reference) => reference.kind === 'artifact' && reference.id === id));
  assert.equal(note.body.mockConfiguration, undefined, 'configuration stays in cash contract');
  assert.equal(note.body.cashPath, undefined, 'TCC contract stays in cash contract');
});

test('I0 navigation resolves authoritative note identities and JSON pointers', () => {
  for (const [file, ids] of [['docs/I0-BASELINE.md', IDS.slice(0, 2)], ['docs/CASH-FIRST-SLICE.md', [IDS[2]]], ['docs/PUBLIC-EXTENSIONS.md', [IDS[1]]]]) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const id of ids) {
      const artifact = source.find((entry) => entry.id === id);
      assert.ok(text.includes(id), `${file} missing ${id}`);
      assert.ok(text.includes(artifact.source.file.split('/').at(-1)), `${file} missing source filename`);
      assert.ok(text.includes('/payload/info/artifact'), `${file} missing actual note pointer`);
    }
    const linkedAtoms = snapshot.atoms.filter((entry) => text.includes(entry.file.split('/').at(-1))).map((entry) => entry.doc);
    for (const match of text.matchAll(/`(\/payload\/info\/artifact[^`\s]*)`/g)) {
      const pointer = match[1];
      const resolve = (atom) => pointer.slice(1).split('/').reduce((current, key) => current?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], atom);
      assert.ok(linkedAtoms.some((atom) => resolve(atom) !== undefined), `${file}: pointer does not resolve in a linked source note ${pointer}`);
    }
  }
});

test('active test selection preserves and openly excludes unfinished domain-runner draft', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const active = ['truth', 'projections', 'cash-contract', 'mock-ta', 'i0-design'].map((name) => `test/${name}.test.mjs`);
  for (const file of active) assert.ok(pkg.scripts.test.includes(file));
  assert.ok(!pkg.scripts.test.includes('*') && !pkg.scripts.test.includes('domain-runner'));
  assert.ok(pkg.scripts['test:baseline'] && pkg.scripts['test:design']);
  for (const file of ['test/domain-runner.test.mjs', 'tools/qualify-domain.mjs', 'qualification/fund-order-cash']) assert.ok(existsSync(join(ROOT, file)), `paused draft not preserved: ${file}`);
  assert.equal(existsSync(join(ROOT, 'tools/domain-spec.mjs')), false, 'do not resurrect the bank-local generation shim');
  const text = readFileSync(join(ROOT, 'docs/I0-BASELINE.md'), 'utf8');
  assert.ok(text.includes('domain-runner.test.mjs') && /excluded|排除/.test(text));
});

const mutants = [
  ['invented policy approval', IDS[0], (note) => { note.body.authorization.newBusinessPoliciesApproved = true; }],
  ['external bank mock authorization', IDS[0], (note) => { note.body.externalBoundaries.externalBankMock = 'simulation-authorized'; }],
  ['missing technical coverage', IDS[0], (note) => { delete note.body.coverageRows[0].technical; }],
  ['scope undecided treated as approved', IDS[0], (note) => { note.body.scopeDecisions[0].status = 'approved'; }],
  ['resumed bank-local generator shim', IDS[0], (note) => { note.body.draftDisposition.resumeBankLocalGenerationShim = true; }],
  ['scope and execution evidence conflated', IDS[0], (note) => { note.body.evidencePolicy.requiredDimensions = ['complete']; }],
  ['inventory declared complete design', IDS[0], (note) => { note.body.evidencePolicy.currentDesignCompleteness = 'complete'; }],
  ['missing public exit gate', IDS[1], (note) => { note.body.publicExtensions[0].exitGates = []; }],
  ['unknown extension prerequisite', IDS[1], (note) => { note.body.publicExtensions[0].dependsOn.push('X99'); }],
  ['duplicate scope decision identity', IDS[0], (note) => { note.body.scopeDecisions.push(structuredClone(note.body.scopeDecisions[0])); }],
  ['missing public input', IDS[1], (note) => { note.body.publicExtensions[1].input = ''; }],
  ['missing compatibility gate', IDS[1], (note) => { note.body.publicExtensions[2].compatibility = []; }],
  ['same-domain portability fixture', IDS[1], (note) => { note.body.publicExtensions[3].secondDomainFixture.domain = 'bankwealth-renamed'; }],
  ['invented fixture execution', IDS[1], (note) => { note.body.publicExtensions[4].secondDomainFixture.status = 'passed'; }],
  ['sibling execution implied', IDS[1], (note) => { note.body.crossRepoExecutionAuthorized = true; }],
  ['rebuilding anchors', IDS[1], (note) => { note.body.reuseExisting = note.body.reuseExisting.filter((entry) => entry !== 'one-to-many-anchors'); }],
  ['missing product surface plane', IDS[2], (note) => { note.body.productPlanes = note.body.productPlanes.filter((entry) => entry.plane !== 'surface'); }],
  ['client-selected collection account', IDS[2], (note) => { note.body.inputAuthority.user.push('fundCollectionAccountId'); }],
  ['unknown authorizes another debit', IDS[2], (note) => { note.body.safety.unknownAllowsNewDebit = true; }],
  ['unknown authorizes refund', IDS[2], (note) => { note.body.safety.unknownAllowsRefund = true; }],
  ['payment marker is fund success', IDS[2], (note) => { note.body.sliceBoundary.customerFinalSuccess = 'payment-marker'; }],
  ['unverified runtime consumer', IDS[2], (note) => { note.body.consumerStatus.runnable = true; }],
  ['unresolved cash decision reference', IDS[2], (note) => { note.body.unresolvedDecisionIds.push('invented-decision'); }],
  ['unresolved typed domain reference', IDS[2], (note) => { note.references.push({ kind: 'command', id: 'FundOrder.InventedCommand' }); }],
];
for (const [name, id, action] of mutants) test(`negative I0 design: ${name}`, () => {
  assert.ok(designErrors(mutate(id, action)).length > 0, name);
});
