import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot, sha256 } from '../tools/truth-source.mjs';
import { extractArtifacts, validateArtifacts } from '../tools/artifacts.mjs';

const snapshot = loadSnapshot();
const source = extractArtifacts(snapshot);
const IDS = ['decision.cash-entry-prerequisites', 'decision.public-x01-work-packages', 'decision.public-x02-work-packages'];
const NAMES = ['CashPrerequisiteDecisionOverlay', 'PublicX01WorkPackagesProposal', 'PublicX02WorkPackagesProposal'];
const SELECTED = ['I0-S01-account-setup', 'I0-S02-account-ownership', 'I0-S09-cash-entry-owner'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const populated = value => Array.isArray(value) && value.length > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const resolve = (doc, pointer) => typeof pointer === 'string' && pointer.startsWith('/')
  ? pointer.slice(1).split('/').reduce((value, key) => {
    const name = key.replaceAll('~1', '/').replaceAll('~0', '~');
    return value !== null && typeof value === 'object' && Object.hasOwn(value, name) ? value[name] : undefined;
  }, doc) : undefined;
const expectedChoiceIndex = new Map([[SELECTED[0], 0], [SELECTED[1], 0], [SELECTED[2], 1]]);
const requiredAreas = {
  'X01-A': ['src/core/generate.mjs', 'src/core/manifest.mjs', 'src/core/canonical.mjs', 'lib/compile.mjs', 'test/generate.test.mjs'],
  'X01-B': ['generators/aggregate-dsl/emit.mjs', 'generators/invariant-dsl/emit.mjs', 'generators/command-dsl/emit.mjs', 'generators/valueobject-dsl/emit.mjs', 'generators/proto-dsl/emit.mjs'],
  'X01-C': ['src/core/generate.mjs', 'src/core/apply-preflight.mjs', 'src/core/anchors.mjs', 'bin/truthsrc.js', 'test/generate-cli.test.mjs', 'test/generate-anchors.test.mjs'],
  'X01-D': ['test/generate-cli.test.mjs', 'test/generate-anchors.test.mjs', 'test/saga-generator.test.mjs', 'test/saga-fab-runtime-binding-v3.test.mjs', 'package.json'],
  'X02-A': ['src/core/manifest.mjs', 'generators/run-all.mjs', 'generators/invariant-dsl/emit.mjs'],
  'X02-B': ['src/core/manifest.mjs', 'generators/command-dsl/emit.mjs', 'generators/invariant-dsl/emit.mjs'],
  'X02-C': ['lib/compile.mjs', 'src/core/manifest.mjs', 'generators/aggregate-dsl/emit.mjs'],
  'X02-D': ['generators/command-dsl/emit.mjs', 'generators/invariant-dsl/emit.mjs', 'generators/aggregate-dsl/emit.mjs', 'test/saga-generator.test.mjs', 'package.json'],
};
const requiredCreates = {
  'X01-A': ['lib/compile-snapshot.mjs', 'src/core/products.mjs', 'test/snapshot-products.test.mjs'],
  'X01-B': ['generators/aggregate-dsl/produce.mjs', 'generators/invariant-dsl/produce.mjs', 'generators/command-dsl/produce.mjs', 'generators/valueobject-dsl/produce.mjs', 'generators/proto-dsl/produce.mjs', 'test/producer-purity.test.mjs'],
  'X01-C': ['test/products-plan-cli.test.mjs'],
  'X01-D': ['test/public-cash-products.test.mjs', 'test/public-inventory-products.test.mjs', 'test/fixtures/public-bank-products.mjs', 'test/fixtures/public-inventory-products.mjs', 'test/public-products-compatibility.test.mjs'],
  'X02-A': ['lib/domain-products/decision.mjs', 'test/domain-decision.test.mjs'],
  'X02-B': ['lib/domain-products/dependencies.mjs', 'test/domain-dependencies.test.mjs'],
  'X02-C': ['lib/domain-products/folds.mjs', 'test/domain-folds.test.mjs'],
  'X02-D': ['test/public-domain-generated-behavior.test.mjs', 'test/fixtures/public-travel-products.mjs', 'generators/command-dsl/host-computation-port.mjs'],
};

// Bank design assertions only; no public compiler, bootstrap, authority or invocation engine is implemented.
function designErrors(artifacts) {
  const errors = [...validateArtifacts(snapshot, artifacts).errors];
  const check = (ok, where, message) => { if (!ok) errors.push(`${where}: ${message}`); };
  const notes = IDS.map(id => artifacts.find(a => a.id === id));
  const baseline = artifacts.find(a => a.id === 'decision.i0-baseline-coverage');
  const ownership = artifacts.find(a => a.id === 'decision.i0-boundary-ownership');
  const original = baseline?.body.scopeDecisions || [];
  const refs = new Map(artifacts.map(a => [a.id, a]));
  const checkPointer = (link, where) => {
    const a = refs.get(link?.artifact);
    const atom = a && snapshot.atoms.find(entry => `tree/${entry.file}` === a.source.file);
    check(!!atom && resolve(atom.doc, link.pointer) !== undefined, where, 'source artifact/pointer must resolve');
  };
  for (const [i, note] of notes.entries()) {
    if (!note) { errors.push(`missing ${IDS[i]}`); continue; }
    check(note.category === 'decision' && note.status === 'demo-proposal' && note.provenance?.workshopHeld === false, note.id, 'truthful design-only provenance required');
    check(note.source.board === 'wealth-cash-next-design-v1' && note.source.seq === i && note.source.stage === 'refining' && note.source.note === `question:${NAMES[i]}`, note.id, 'stable new board identity/order');
    check(same(note.body.entities, []) && same(note.body.edges, []), note.id, 'do not invent execution/graph entities');
  }
  const overlay = notes[0]?.body;
  if (overlay) {
    checkPointer(overlay.originalRegister, IDS[0]);
    check(overlay.authorization?.source === 'user-approved-next-design-plan' && overlay.authorization.implementationScope === 'bank-source-design-and-local-acceptance-only', IDS[0], 'limited actual plan approval');
    check(same(overlay.authorization?.selectedDecisionIds, SELECTED), IDS[0], 'only three designs are approved');
    for (const key of ['publicExecutionAuthorized', 'productionPoliciesApproved', 'externalBankMockAuthorized']) check(overlay.authorization?.[key] === false, IDS[0], `no expanded ${key}`);
    const decisions = overlay.resolvedDecisions || [];
    check(same(decisions.map(d => d.id), SELECTED), IDS[0], 'exact selected subset, not fourth policy');
    check(original.every(d => d.status === 'open') && baseline.body.authorization.newBusinessPoliciesApproved === false, IDS[0], 'original I0 is historical and remains unchanged');
    const remaining = original.filter(d => !SELECTED.includes(d.id)).map(d => d.id);
    check(same((overlay.remainingOpenDecisions || []).map(d => d.id), remaining), IDS[0], 'all eight other decisions stay open');
    for (const d of overlay.remainingOpenDecisions || []) { check(d.status === 'open' && nonempty(d.owner), d.id, 'remaining owner and open status'); checkPointer(d.original, d.id); }
    for (const d of decisions) {
      check(d.status === 'selected-demo-design' && d.scope === 'cash-payment-demo-prerequisite-only' && d.implementation === 'not-started' && d.enforcementVerified === false, d.id, 'design selection is not enforcement');
      checkPointer(d.supersedes, d.id);
      const old = original.find(row => row.id === d.id);
      check(d.owner === old?.owner && populated(d.acceptance), d.id, 'original owner and evidence obligations');
      const oldAtom = snapshot.atoms.find(a => `tree/${a.file}` === baseline.source.file);
      const expectedPointer = `/payload/info/artifact/body/scopeDecisions/${original.findIndex(row => row.id === d.id)}`;
      check(d.supersedes?.artifact === baseline.id && d.supersedes.pointer === expectedPointer && resolve(oldAtom.doc, d.supersedes.pointer)?.id === d.id, d.id, 'supersession matches exact original row');
      check(d.originalChoicePointer === `${expectedPointer}/choices/${expectedChoiceIndex.get(d.id)}` && nonempty(resolve(oldAtom.doc, d.originalChoicePointer)) && d.selectedChoice === d.details?.selection, d.id, 'selection and candidate provenance must agree');
      for (const gate of d.acceptance || []) check(nonempty(gate.id) && nonempty(gate.assertion) && gate.execution === 'not-run' && gate.evidenceLevel === 'future-behavior', d.id, 'future evidence remains unexecuted');
    }
    const setup = decisions.find(d => d.id === SELECTED[0])?.details;
    if (setup) {
      check(setup.selection === 'owned-seeded-ledger-fixture' && setup.aggregateRef === 'CreditBalance' && setup.fundingProvenance === 'explicit-demo-seed-not-real-bank-funds' && setup.accountLifecycleIncluded === false, SELECTED[0], 'explicit bounded seeded ledger, no invented account lifecycle');
      const fixture = setup.fixtureContract;
      check(fixture?.locationOwner === 'bank-wealth-demo' && fixture.actualFixturePublished === false && populated(fixture.relationships), SELECTED[0], 'bank fixture contract, not a fake published dataset');
      for (const field of ['fixtureId', 'fixtureVersion', 'principalId', 'investorAccountId', 'fundCode', 'fundCollectionAccountId', 'currency', 'seedAmount', 'setupOperationId', 'setupTxId']) check(fixture?.fields?.includes(field), SELECTED[0], `fixture provenance field ${field}`);
      checkPointer(fixture?.currencyAuthority, SELECTED[0]);
      const bootstrap = setup.bootstrap;
      check(same(bootstrap?.commandRefs, ['CreditBalance.RecordIncomingCredits', 'CreditBalance.CommitIncomingCredits']) && bootstrap.stateEvolution === 'event-application-only', SELECTED[0], 'actual event-sourced setup commands');
      for (const key of ['directStateAssignmentAllowed', 'journalRewriteAllowed', 'nonzeroEmptyDefaultAllowed', 'externalTopUpAllowed', 'reseedOnInsufficientBalanceAllowed', 'bootstrapVerified']) check(bootstrap?.[key] === false, SELECTED[0], `${key} must not bypass setup authority/evidence`);
      for (const key of ['identity', 'ownership', 'committedReplay', 'pendingReplay', 'conflictPolicy', 'unresolvedSendPolicy', 'knownHazard', 'duplicateDelayedCommandPolicy', 'participantFixAuthority']) check(nonempty(bootstrap?.[key]), SELECTED[0], `${key} recovery/fence contract required`);
      check(populated(bootstrap?.recoveryEvidenceRequired) && bootstrap.readiness === 'blocked-until-real-bootstrap-replay-and-fencing-evidence', SELECTED[0], 'stable txid/host query is not qualified bootstrap');
    } else check(false, SELECTED[0], 'setup design missing');
    const mapping = decisions.find(d => d.id === SELECTED[1])?.details;
    if (mapping) {
      check(mapping.selection === 'bank-owned-versioned-trusted-fixture-authority' && mapping.authoritySource === 'server-owned-versioned-demo-fixture' && mapping.authenticatedPrincipalRequired === true, SELECTED[1], 'server-owned authenticated authority');
      check(same(mapping.publicInputs, ['fundCode', 'amount']) && mapping.clientAccountSelectionAllowed === false && mapping.clientOperationIdentityAllowed === false && mapping.retryRemapAllowed === false, SELECTED[1], 'no client account/operation choice or retry remap');
      for (const field of ['operationId', 'fundOrderId', 'principalId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount', 'mappingVersion', 'fixtureVersion', 'requestFingerprint']) check(mapping.persistedBeforeDomainCreation?.includes(field), SELECTED[1], `retained input missing ${field}`);
      check(populated(mapping.newAdmissionChecks) && mapping.newAdmissionChecks.some(v => /active/.test(v)) && mapping.newAdmissionChecks.some(v => /unknown\/missing\/ambiguous/.test(v)), SELECTED[1], 'latest eligibility and missing/ambiguous fail closed');
      for (const key of ['retainedOperationSnapshot', 'sameOperationConflict', 'versionChangePolicy', 'revokedExistingOperation', 'unknownPolicy', 'machineBoundary']) check(nonempty(mapping[key]), SELECTED[1], `${key} required`);
      check(mapping.revokedNewAdmission === 'reject-new-operation' && mapping.actualFixturePublished === false && mapping.authorityEnforced === false, SELECTED[1], 'revocation and authority not implemented');
    } else check(false, SELECTED[1], 'mapping design missing');
    const start = decisions.find(d => d.id === SELECTED[2])?.details;
    if (start) {
      check(start.selection === 'single-invoke-durable-cash-pipeline' && start.pipelineId === 'fund-purchase-cash-payment' && start.pipelineStageId === 'pay-cash-purchase' && same(start.saga, { id: 'fund-purchase-payment-v2', version: 'v2' }), SELECTED[2], 'one chosen payment pipeline owner');
      check(start.directSagaSourceSubscriptionEnabled === false && start.independentDirectSagaStartAllowed === false, SELECTED[2], 'no independent direct event subscriber/start');
      check(start.recipeEquivalenceVerified === false && start.argsRecomputedOnRetry === false && start.freshIdentityOnUnknownAllowed === false && start.runtimeBindingVerified === false && start.runnable === false, SELECTED[2], 'same durable identity, no fake qualification');
      const pipeline = snapshot.atoms.find(a => a.doc.kind === 'pipeline' && a.doc.id === start.pipelineId)?.doc;
      const step = pipeline?.steps.find(s => s.id === start.pipelineStageId);
      check(pipeline?.steps.length === 1 && same(step?.execution.invokeSaga.ref, { sagaId: start.saga?.id, version: start.saga?.version }), SELECTED[2], 'selected owner matches frozen invoke declaration');
      check(same(start.pipelineInputs?.map(row => [row.slot, row.type]), pipeline?.execution.inputs.map(row => [row.id, row.type])), SELECTED[2], 'all pinned pipeline inputs and types');
      for (const input of start.pipelineInputs || []) {
        const field = ['operation', 'occurrence'].includes(input.slot) ? 'operationId' : input.slot;
        check(input.sourceEventFieldRef === `FundOrder.FundPurchaseSettlementRequested.${field}`, SELECTED[2], `exact original source for ${input.slot}`);
      }
      const occurrence = start.pipelineInputs?.find(row => row.slot === 'occurrence');
      check(occurrence?.sourceEventFieldRef === 'FundOrder.FundPurchaseSettlementRequested.operationId' && nonempty(occurrence.policy), SELECTED[2], 'single occurrence retained from source, not retry identity');
      check(populated(start.persistBeforeInvokeAndEarlyOutcome) && nonempty(start.transactionIdentity), SELECTED[2], 'persist source/start association before early outcome');
      const retry = start.creationRetry;
      check(retry?.creationOnly === true && retry.resendOnRetryAllowed === false && retry.allocationOnPendingAllowed === false, SELECTED[2], 'creation-only command is not retry API');
      for (const key of ['retainedAssociation', 'pendingSubmission', 'refresh', 'requestIntentHandle', 'proofBoundary']) check(nonempty(retry?.[key]), SELECTED[2], `${key} pending/retry boundary required`);
    } else check(false, SELECTED[2], 'start-owner design missing');
    const inherited = overlay.inheritedBoundaries;
    check(inherited?.fundCompany === 'simulation-authorized' && inherited.externalBankMock === 'not-authorized' && inherited.unknownAllowsNewDebit === false && inherited.unknownAllowsRefund === false && inherited.legacyCashDoubleDispatchAllowed === false && inherited.customerFinalSuccess === 'TA-confirmed-not-payment-marker' && inherited.pausedDrafts === 'paused-preserve-no-execution', IDS[0], 'existing cash/external/paused boundaries unchanged');
    check(overlay.designCompleteness === 'partial-three-prerequisites-selected-not-complete', IDS[0], 'not complete business/product/technical design');
    for (const key of ['bootstrapVerified', 'authorityEnforced', 'runtimeBindingVerified', 'runnable']) check(overlay.evidenceBoundary?.[key] === false, IDS[0], `unverified ${key}`);
    check(overlay.evidenceBoundary?.publicImplementation === 'not-started' && overlay.evidenceBoundary.applicationGeneration === 'not-run' && overlay.evidenceBoundary.independentAudit === 'not-performed', IDS[0], 'honest evidence scope');
  }
  const allPackages = notes.slice(1).flatMap(n => n?.body.packages || []);
  const packageIds = new Set(allPackages.map(p => p.id));
  check(same(allPackages.map(p => p.id), ['X01-A', 'X01-B', 'X01-C', 'X01-D', 'X02-A', 'X02-B', 'X02-C', 'X02-D']), 'packages', 'eight unique ordered public packages');
  const extensionIds = new Set(ownership?.body.publicExtensions.map(e => e.id));
  for (const [i, note] of notes.slice(1).entries()) {
    if (!note) continue;
    const body = note.body, extension = i === 0 ? 'X01' : 'X02';
    checkPointer(body.upstreamSpecification, note.id);
    check(body.extensionId === extension && body.owner === 'metarch-truthsrc' && body.implementation === 'not-started', note.id, 'public spec not implementation');
    check(body.authorization?.publicExecutionAuthorized === false && body.authorization.publicEPExists === false && body.authorization.scope === 'bank-owned-public-work-package-specification-only', note.id, 'separate public owner authorization/EP remains missing');
    check(populated(body.executionProtocol) && nonempty(body.parallelSourceObservation), note.id, 'owner execution protocol and dirty-source evidence boundary');
    check(body.readiness?.publicTests === 'not-run' && body.readiness.publicImplementation === 'not-started' && body.readiness.applicationGeneration === 'not-run' && body.readiness.runtimeBindingVerified === false && body.readiness.runnable === false, note.id, 'no public acceptance/runtime inherited');
    for (const p of body.packages || []) {
      check(p.id.startsWith(`${extension}-`) && p.owner === 'metarch-truthsrc' && nonempty(p.ownerLayer) && p.status === 'proposal' && p.implementation === 'not-started' && p.publicExecutionAuthorized === false, p.id, 'public owner/layer/proposal boundary');
      for (const key of ['authorizationGate', 'input', 'output', 'migration']) check(nonempty(p[key]), p.id, `package ${key} missing`);
      for (const key of ['sourceReadSet', 'futureWriteSet', 'proposedCreateSet', 'tasks', 'positiveTests', 'negativeTests', 'compatibility', 'exitGates', 'nonGoals']) check(populated(p[key]), p.id, `package ${key} missing`);
      for (const area of p.sourceReadSet || []) check(nonempty(area.file) && area.file.startsWith('metarch-truthsrc/') && !area.file.includes('..') && nonempty(area.lines) && nonempty(area.observation), p.id, 'safe named public code area/source observation');
      check((p.futureWriteSet || []).every(file => (p.sourceReadSet || []).some(area => area.file === file)), p.id, 'no unscoped public write area');
      for (const file of requiredAreas[p.id] || []) check(p.sourceReadSet?.some(area => area.file === `metarch-truthsrc/${file}`) && p.futureWriteSet?.includes(`metarch-truthsrc/${file}`), p.id, `required existing implementation/test allocation ${file}`);
      for (const row of p.proposedCreateSet || []) check(row.status === 'proposed-not-created' && nonempty(row.purpose) && nonempty(row.kind) && row.file?.startsWith('metarch-truthsrc/') && !row.file.includes('..'), p.id, 'new API/test/fixture allocation is proposed, not created/authorized');
      for (const file of requiredCreates[p.id] || []) check(p.proposedCreateSet?.some(row => row.file === `metarch-truthsrc/${file}`), p.id, `required proposed implementation/test allocation ${file}`);
      const api = p.publicApiContract;
      check(nonempty(api?.proposedEntry) && nonempty(api.inputShape) && nonempty(api.outputShape) && populated(api.implementationAllocation), p.id, 'versioned pure/product/API implementation contract');
      for (const file of api?.implementationAllocation || []) check(p.futureWriteSet?.includes(file) || p.proposedCreateSet?.some(row => row.file === file), p.id, 'API implementation allocated inside package future scope');
      for (const gate of p.compatibility || []) check(nonempty(gate.id) && nonempty(gate.assertion) && gate.evidenceLevel === 'future-compatibility' && gate.execution === 'not-run', p.id, 'compatibility gates are structured future evidence');
      const compatibility = p.compatibilityBaseline;
      check(compatibility?.status === 'proposed-to-pin-at-public-implementation' && compatibility.execution === 'not-run' && populated(compatibility.affectedSurfaces) && populated(compatibility.corpus), p.id, 'affected feature-present/absent compatibility baseline');
      for (const suite of ['test/generate.test.mjs', 'test/generate-cli.test.mjs', 'test/saga-generator.test.mjs', 'test/saga-fab-runtime-binding-v3.test.mjs', 'test/invocation-recovery-emission.test.mjs']) check(compatibility?.minimumExistingSuites?.includes(suite), p.id, `affected compatibility suite ${suite}`);
      const phases = p.gatePhases;
      check(phases?.portableContract?.supportsIndependentClosure === true && phases.portableContract.execution === 'not-run' && populated(phases.portableContract.requiredEvidence), p.id, 'portable contract completion is independently qualified');
      check(phases?.generatedDomainBehavior?.execution === 'not-run' && phases.generatedDomainBehavior.diagnosticsDoNotCountAsPositiveBankBehavior === true && phases.generatedDomainBehavior.bankExecution === 'not-run-blocked-until-prerequisites' && populated(phases.generatedDomainBehavior.bankPrerequisites), p.id, 'blocked bank positive behavior separated from admission diagnostics');
      check(phases?.finalQualification?.execution === 'not-run' && phases.finalQualification.runtimeCertification === false && nonempty(phases.finalQualification.rule), p.id, 'final extension/runtime evidence not implied by portable completion');
      check(Array.isArray(p.dependsOn) && p.dependsOn.every(id => packageIds.has(id) && id !== p.id) && new Set(p.dependsOn).size === p.dependsOn.length, p.id, 'dependency must resolve uniquely');
      check((p.additionalJointGates || []).every(id => packageIds.has(id)), p.id, 'joint gate references known package, not circular implementation dependency');
      for (const fixture of [p.bankFixture, p.secondDomainFixture]) check(fixture?.status === 'proposed' && nonempty(fixture.domain) && nonempty(fixture.scenario) && fixture.implemented === false && fixture.executed === false, p.id, 'both domains are proposed unimplemented/unexecuted fixtures');
      check(p.secondDomainFixture?.domain === (extension === 'X01' ? 'inventory-reservation' : 'travel-booking') && p.secondDomainFixture.implemented === false && p.secondDomainFixture.executed === false, p.id, 'independent second domain unimplemented/unexecuted');
      for (const gate of [...(p.positiveTests || []), ...(p.negativeTests || [])]) check(nonempty(gate.id) && nonempty(gate.assertion) && ['future-public-contract', 'future-fail-closed'].includes(gate.evidenceLevel) && gate.execution === 'not-run' && ['portableContract', 'generatedDomainBehavior'].includes(gate.phase), p.id, 'phase-qualified future tests not falsely executed');
      check(p.exitGates?.includes('independent-owner-authorization') && p.exitGates.includes('both-domain-positive-negative-evidence') && p.exitGates.includes('public-test-receipt-not-a-bank-design-test'), p.id, 'owner/portability/evidence gates');
      for (const key of ['blockedBankBehaviorBy', 'blockedExactMoneyBy']) check((p[key] || []).every(id => extensionIds.has(id)), p.id, 'blocked external extension must resolve');
    }
  }
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`${id}: circular package dependency`); return; }
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of allPackages.find(p => p.id === id)?.dependsOn || []) if (packageIds.has(dependency)) visit(dependency);
    visiting.delete(id); done.add(id);
  }
  for (const id of packageIds) visit(id);
  const pkg = id => allPackages.find(p => p.id === id);
  const core = pkg('X01-C');
  for (const name of ['applyEntries', 'preflightPaths', 'preflightApply', 'merge', 'concerns', 'ledger', 'planAnchors', 'writeAnchorsIndex']) check(core?.reuseExisting?.includes(name), 'X01-C', `reuse actual ${name}`);
  check(core?.atomicAcrossFiles === false && core.fingerprintCertifiesSemantics === false, 'X01-C', 'no rollback or semantic certification claim');
  check(same(pkg('X01-A')?.capabilityBoundary, { core: ['version-check', 'explicit-load', 'dispatch'], productCompiler: ['typed-semantic-admission'], plugin: ['target-syntax-lowering'] }), 'X01-A', 'core/product/plugin layers distinct');
  check(same(pkg('X02-A')?.semantics, { authorOrder: 'exact-once-in-place', reject: 'failed-pass-condition', succeedEmpty: 'matched-declared-duplicate-condition', unsupported: 'diagnostic-no-apply' }), 'X02-A', 'authored sequence/duplicate semantics');
  check(same(pkg('X02-B')?.dependencyPolicy, { guardOnlyInputs: 'complete-typed', eventSlots: 'complete-explicit', missingHostComputation: 'diagnostic-no-apply', requiredDefaultFallbackAllowed: false, canonicalMutationAllowed: false }), 'X02-B', 'complete typed inputs/slots/no fallback');
  const folds = pkg('X02-C')?.foldPolicy;
  check(folds?.coverage === 'complete-authored-set' && folds.rhsState === 'single-pre-event-state' && folds.commandInputsDuringReplayAllowed === false && same(folds.supportedOperators, ['put', 'remove', 'literal', 'read', 'money-apply-with-declared-exact-capability']), 'X02-C', 'complete pre-event fold semantics and operator set');
  const port = pkg('X02-D')?.publicApiContract?.hostComputationPort;
  check(same(port?.descriptorFields, ['id', 'version', 'outputType', 'inputDependencies', 'sourcePointer', 'stableIdentityContract']) && nonempty(port?.pluginOwnership) && nonempty(port?.bankOwnership) && nonempty(port?.fallback), 'X02-D', 'typed host-computation port allocation without a synthetic command field');
  check(same(pkg('X02-C')?.blockedExactMoneyBy, ['X03']), 'X02-C', 'exact-money blocker visible');
  for (const id of ['X01-D', 'X02-D']) check(same(pkg(id)?.blockedBankBehaviorBy, ['X03', 'X04', 'X07', 'X08']), id, 'bank capability blockers cannot be suppressed');
  check(pkg('X02-D')?.qualifiesBankRuntime === false, 'X02-D', 'not funds runtime certification');
  return errors;
}

function mutate(id, change) {
  const artifacts = structuredClone(source);
  change(artifacts.find(a => a.id === id));
  return artifacts;
}
const resolved = (note, index) => note.body.resolvedDecisions[index].details;
const packageOf = (note, id) => note.body.packages.find(p => p.id === id);

test('next design selects exactly three demo prerequisites and leaves original I0/eight other decisions intact', () => {
  assert.deepEqual(designErrors(source), []);
  for (const id of IDS) {
    const artifact = source.find(a => a.id === id);
    const atom = snapshot.atoms.find(a => `tree/${a.file}` === artifact.source.file);
    assert.equal(atom.doc.payload.sourceCapture, undefined);
  }
});

test('historical I0 source/test, protected domain/bindings and paused drafts retain recorded bytes', () => {
  const receipt = JSON.parse(readFileSync(join(ROOT, 'docs/I0-VERIFICATION.json'), 'utf8'));
  const frozen = receipt.currentInputFiles.filter(row => row.file.startsWith('tree/') || /^(?:wealth-)?(?:bindings|execution-bindings|runtime-binding)\.json$/.test(row.file) || row.file.startsWith('compiled/') || row.file.startsWith('isolation-zone/') || row.file.startsWith('qualification/') || ['test/i0-design.test.mjs', 'test/domain-runner.test.mjs', 'tools/qualify-domain.mjs'].includes(row.file));
  assert.ok(frozen.length > 0);
  for (const row of frozen) assert.equal(sha256(readFileSync(join(ROOT, row.file))), row.sha256, row.file);
  assert.equal(existsSync(join(ROOT, 'tools/domain-spec.mjs')), false);
});

test('next design navigation links actual authoritative notes and all JSON pointers resolve', () => {
  const docs = ['docs/CASH-ENTRY-DECISIONS.md', 'docs/I0-BASELINE.md', 'docs/CASH-FIRST-SLICE.md', 'docs/PUBLIC-EXTENSIONS.md', 'docs/HANDOFF.md', 'docs/IMPLEMENTATION-STATUS.md', 'README.md'];
  for (const file of docs) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const linked = snapshot.atoms.filter(a => text.includes(a.file.split('/').at(-1)));
    for (const match of text.matchAll(/`(\/payload\/info\/artifact[^`\s]*)`/g)) assert.ok(linked.some(a => resolve(a.doc, match[1]) !== undefined), `${file}: ${match[1]}`);
    assert.ok(text.includes('CASH-NEXT-DESIGN-VERIFICATION.json'), `${file}: current evidence link`);
  }
  const decisions = readFileSync(join(ROOT, docs[0]), 'utf8');
  assert.ok(decisions.includes(IDS[0]) && decisions.includes('selected-demo-design'));
  const publicDoc = readFileSync(join(ROOT, 'docs/PUBLIC-EXTENSIONS.md'), 'utf8');
  for (const id of IDS.slice(1)) assert.ok(publicDoc.includes(id));
});

test('explicit active six-file selection adds next design without executing paused qualification suite', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const files = ['truth', 'projections', 'cash-contract', 'mock-ta', 'i0-design', 'cash-next-design'].map(name => `test/${name}.test.mjs`);
  assert.equal(pkg.scripts.test, `node --test ${files.join(' ')}`);
  assert.equal(pkg.scripts['test:next-design'], 'node --test test/cash-next-design.test.mjs');
  assert.equal(pkg.scripts['test:design'], 'node --test test/i0-design.test.mjs');
  assert.ok(!pkg.scripts.test.includes('*') && !pkg.scripts.test.includes('domain-runner'));
});

const mutants = [
  ['fourth decision selected', IDS[0], n => { n.body.resolvedDecisions.push(structuredClone(n.body.remainingOpenDecisions[0])); }],
  ['remaining decision auto-approved', IDS[0], n => { n.body.remainingOpenDecisions[0].status = 'selected-demo-design'; }],
  ['missing open decision', IDS[0], n => { n.body.remainingOpenDecisions.pop(); }],
  ['invented public authorization', IDS[0], n => { n.body.authorization.publicExecutionAuthorized = true; }],
  ['production policy approval', IDS[0], n => { n.body.authorization.productionPoliciesApproved = true; }],
  ['invented held workshop', IDS[0], n => { n.provenance.workshopHeld = true; }],
  ['source supersession pointer drift', IDS[0], n => { n.body.resolvedDecisions[0].supersedes.pointer = '/invented'; }],
  ['external bank mock authorized', IDS[0], n => { n.body.inheritedBoundaries.externalBankMock = 'simulation-authorized'; }],
  ['unknown authorizes debit', IDS[0], n => { n.body.inheritedBoundaries.unknownAllowsNewDebit = true; }],
  ['complete design inferred', IDS[0], n => { n.body.designCompleteness = 'complete'; }],
  ['direct balance assignment', IDS[0], n => { resolved(n, 0).bootstrap.directStateAssignmentAllowed = true; }],
  ['nonzero empty balance', IDS[0], n => { resolved(n, 0).bootstrap.nonzeroEmptyDefaultAllowed = true; }],
  ['seed via external topup', IDS[0], n => { resolved(n, 0).bootstrap.externalTopUpAllowed = true; }],
  ['insufficient balance reseeds', IDS[0], n => { resolved(n, 0).bootstrap.reseedOnInsufficientBalanceAllowed = true; }],
  ['missing committed replay fence', IDS[0], n => { delete resolved(n, 0).bootstrap.committedReplay; }],
  ['missing delayed command gate', IDS[0], n => { delete resolved(n, 0).bootstrap.duplicateDelayedCommandPolicy; }],
  ['stable txid treated as verified bootstrap', IDS[0], n => { resolved(n, 0).bootstrap.bootstrapVerified = true; }],
  ['fixture without setup provenance', IDS[0], n => { resolved(n, 0).fixtureContract.fields = resolved(n, 0).fixtureContract.fields.filter(f => f !== 'setupTxId'); }],
  ['browser selects debit account', IDS[0], n => { resolved(n, 1).publicInputs.push('investorAccountId'); }],
  ['mapping retry remaps account', IDS[0], n => { resolved(n, 1).retryRemapAllowed = true; }],
  ['missing retained mapping version', IDS[0], n => { resolved(n, 1).persistedBeforeDomainCreation = resolved(n, 1).persistedBeforeDomainCreation.filter(f => f !== 'mappingVersion'); }],
  ['revoked mapping allows new operation', IDS[0], n => { resolved(n, 1).revokedNewAdmission = 'allow'; }],
  ['fixture falsely enforces authority', IDS[0], n => { resolved(n, 1).authorityEnforced = true; }],
  ['dual direct source subscriber', IDS[0], n => { resolved(n, 2).directSagaSourceSubscriptionEnabled = true; }],
  ['independent Saga start', IDS[0], n => { resolved(n, 2).independentDirectSagaStartAllowed = true; }],
  ['pending create resent', IDS[0], n => { resolved(n, 2).creationRetry.resendOnRetryAllowed = true; }],
  ['new order allocated on pending submit', IDS[0], n => { resolved(n, 2).creationRetry.allocationOnPendingAllowed = true; }],
  ['new identity on unknown', IDS[0], n => { resolved(n, 2).freshIdentityOnUnknownAllowed = true; }],
  ['source occurrence missing', IDS[0], n => { resolved(n, 2).pipelineInputs = resolved(n, 2).pipelineInputs.filter(r => r.slot !== 'occurrence'); }],
  ['unproved recipe certified', IDS[0], n => { resolved(n, 2).recipeEquivalenceVerified = true; }],
  ['public EP invented', IDS[1], n => { n.body.authorization.publicEPExists = true; }],
  ['missing package output', IDS[1], n => { n.body.packages[0].output = ''; }],
  ['unknown package dependency', IDS[1], n => { n.body.packages[0].dependsOn.push('X99-A'); }],
  ['circular package implementation', IDS[1], n => { n.body.packages[0].dependsOn.push('X01-C'); }],
  ['same-domain second fixture', IDS[1], n => { n.body.packages[0].secondDomainFixture.domain = 'bank-renamed'; }],
  ['second fixture falsely executed', IDS[2], n => { n.body.packages[0].secondDomainFixture.executed = true; }],
  ['missing owner exit gate', IDS[1], n => { n.body.packages[0].exitGates = []; }],
  ['public test falsely passed', IDS[2], n => { n.body.packages[0].positiveTests[0].execution = 'passed'; }],
  ['rebuild apply engine', IDS[1], n => { packageOf(n, 'X01-C').reuseExisting = []; }],
  ['core interprets domain semantics', IDS[1], n => { packageOf(n, 'X01-A').capabilityBoundary.core.push('fund-policy'); }],
  ['claimed transaction rollback', IDS[1], n => { packageOf(n, 'X01-C').atomicAcrossFiles = true; }],
  ['guard order append accepted', IDS[2], n => { packageOf(n, 'X02-A').semantics.authorOrder = 'append-structured-after-legacy'; }],
  ['guard-only input omitted', IDS[2], n => { packageOf(n, 'X02-B').dependencyPolicy.guardOnlyInputs = 'heuristic-subset'; }],
  ['required host slot default', IDS[2], n => { packageOf(n, 'X02-B').dependencyPolicy.requiredDefaultFallbackAllowed = true; }],
  ['canonical rewritten for plugin', IDS[2], n => { packageOf(n, 'X02-B').dependencyPolicy.canonicalMutationAllowed = true; }],
  ['fold set incomplete', IDS[2], n => { packageOf(n, 'X02-C').foldPolicy.coverage = 'inferred-subset'; }],
  ['fold uses updated state', IDS[2], n => { packageOf(n, 'X02-C').foldPolicy.rhsState = 'sequential-mutated-state'; }],
  ['exact money blocker hidden', IDS[2], n => { packageOf(n, 'X02-C').blockedExactMoneyBy = []; }],
  ['bank runtime blockers omitted', IDS[2], n => { packageOf(n, 'X02-D').blockedBankBehaviorBy = []; }],
  ['public packages qualify funds runtime', IDS[2], n => { packageOf(n, 'X02-D').qualifiesBankRuntime = true; }],
  ['typed source reference invented', IDS[0], n => { n.references.push({ kind: 'command', id: 'CreditBalance.OpenAccount' }); }],
  ['account source field swapped', IDS[0], n => { resolved(n, 2).pipelineInputs.find(row => row.slot === 'investorAccountId').sourceEventFieldRef = 'FundOrder.FundPurchaseSettlementRequested.fundCollectionAccountId'; }],
  ['selection candidate points to another decision', IDS[0], n => { n.body.resolvedDecisions[2].originalChoicePointer = '/payload/info/artifact/body/scopeDecisions/0/choices/0'; }],
  ['selection and details diverge', IDS[0], n => { n.body.resolvedDecisions[0].selectedChoice = 'minimal-live-account-lifecycle'; }],
  ['inherited JSON pointer is not truth', IDS[0], n => { n.body.resolvedDecisions[0].supersedes.pointer = '/payload/info/artifact/body/constructor'; }],
  ['missing Saga record returns rejection', IDS[0], n => { delete resolved(n, 2).saga; }],
  ['required snapshot surface removed', IDS[1], n => { const p = packageOf(n, 'X01-A'); p.sourceReadSet = p.sourceReadSet.filter(row => !row.file.endsWith('lib/compile.mjs')); p.futureWriteSet = p.futureWriteSet.filter(file => !file.endsWith('lib/compile.mjs')); }],
  ['pure snapshot API unallocated', IDS[1], n => { packageOf(n, 'X01-A').proposedCreateSet = packageOf(n, 'X01-A').proposedCreateSet.filter(row => !row.file.endsWith('lib/compile-snapshot.mjs')); }],
  ['decision product API unallocated', IDS[2], n => { packageOf(n, 'X02-A').proposedCreateSet = []; }],
  ['generated behavior test unallocated', IDS[2], n => { packageOf(n, 'X02-D').proposedCreateSet = packageOf(n, 'X02-D').proposedCreateSet.filter(row => !row.file.endsWith('public-domain-generated-behavior.test.mjs')); }],
  ['host injection port unallocated', IDS[2], n => { delete packageOf(n, 'X02-D').publicApiContract.hostComputationPort; }],
  ['bank fixture falsely executed', IDS[1], n => { packageOf(n, 'X01-D').bankFixture.executed = true; }],
  ['compatibility falsely passed', IDS[1], n => { packageOf(n, 'X01-D').compatibility[0].execution = 'passed'; }],
  ['public evidence mislabeled executed', IDS[2], n => { packageOf(n, 'X02-A').positiveTests[0].evidenceLevel = 'executed-public-tests'; }],
  ['required fold operators omitted', IDS[2], n => { packageOf(n, 'X02-C').foldPolicy.supportedOperators = ['put']; }],
  ['feature-present compatibility baseline omitted', IDS[1], n => { packageOf(n, 'X01-D').compatibilityBaseline.minimumExistingSuites = ['test/generate.test.mjs']; }],
  ['blocked diagnostics count as positive bank behavior', IDS[2], n => { packageOf(n, 'X02-D').gatePhases.generatedDomainBehavior.diagnosticsDoNotCountAsPositiveBankBehavior = false; }],
];
for (const [name, id, change] of mutants) test(`negative next design: ${name}`, () => {
  assert.ok(designErrors(mutate(id, change)).length > 0, name);
});
