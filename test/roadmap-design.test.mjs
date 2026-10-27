import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot, sha256 } from '../tools/truth-source.mjs';
import { extractArtifacts, validateArtifacts } from '../tools/artifacts.mjs';

const snapshot = loadSnapshot(), source = extractArtifacts(snapshot);
const IDS = ['decision.full-target-gap-roadmap', 'decision.public-x03-work-packages', 'decision.public-x04-work-packages'];
const NAMES = ['FullTargetGapRoadmapProposal', 'PublicX03WorkPackagesProposal', 'PublicX04WorkPackagesProposal'];
const SELECTED = ['I0-S01-account-setup', 'I0-S02-account-ownership', 'I0-S09-cash-entry-owner'];
const LAYERS = ['source', 'design', 'publicGenerated', 'componentBehavior', 'processBusinessIntegration'];
const COVERAGE = Array.from({ length: 23 }, (_, i) => `I0-C${String(i + 1).padStart(2, '0')}`);
const PHASES = Array.from({ length: 9 }, (_, i) => `R${i}`);
const PACKAGE_IDS = ['X03-A', 'X03-B', 'X03-C', 'X03-D', 'X04-A', 'X04-B', 'X04-C', 'X04-D'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = value => typeof value === 'string' && value.trim().length > 0;
const populated = value => Array.isArray(value) && value.length > 0;
const resolve = (doc, pointer) => typeof pointer === 'string' && pointer.startsWith('/')
  ? pointer.slice(1).split('/').reduce((value, segment) => {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
  }, doc) : undefined;
const requiredAllocations = {
  'X03-A': ['lib/value-products/exact-types.mjs', 'test/exact-value-admission.test.mjs'],
  'X03-B': ['lib/value-products/exact-codecs.mjs', 'test/exact-codec-roundtrip.test.mjs'],
  'X03-C': ['generators/proto-dsl/exact-value-port.mjs', 'test/exact-serialization-generation.test.mjs'],
  'X03-D': ['test/public-bank-exact-values.test.mjs', 'test/public-travel-exact-values.test.mjs', 'test/fixtures/public-bank-exact-values.mjs', 'test/fixtures/public-travel-exact-values.mjs'],
  'X04-A': ['lib/saga/phase-evidence-products.mjs', 'test/phase-evidence-admission.test.mjs'],
  'X04-B': ['generators/saga-dsl/phase-evidence-port.mjs', 'test/phase-evidence-generated-query.test.mjs'],
  'X04-C': ['generators/saga-dsl/completion-target-port.mjs', 'test/completion-target-generated-behavior.test.mjs'],
  'X04-D': ['test/public-bank-phase-targets.test.mjs', 'test/public-travel-phase-targets.test.mjs', 'test/fixtures/public-bank-phase-targets.mjs', 'test/fixtures/public-travel-phase-targets.mjs'],
};
const requiredExisting = {
  'X03-A': ['src/core/manifest.mjs', 'generators/run-all.mjs', 'generators/valueobject-dsl/emit.mjs'],
  'X03-B': ['generators/converter-dsl/emit.mjs', 'generators/saga-dsl/emit-strict.mjs', 'test/money-prepare-evidence.test.mjs'],
  'X03-C': ['generators/run-all.mjs', 'generators/valueobject-dsl/emit.mjs', 'generators/proto-dsl/emit.mjs', 'generators/converter-dsl/emit.mjs', 'generators/aggregate-dsl/emit.mjs'],
  'X03-D': ['package.json', 'test/saga-fab-runtime-binding-v3.test.mjs'],
  'X04-A': ['lib/saga/compile.mjs', 'lib/saga/runtime-binding.mjs', 'src/core/manifest.mjs', 'generators/saga-dsl/emit-strict.mjs'],
  'X04-B': ['generators/saga-dsl/emit-strict.mjs', 'generators/saga-dsl/emit-strict-host.mjs'],
  'X04-C': ['generators/saga-dsl/emit-strict.mjs', 'generators/saga-dsl/emit-strict-host.mjs', 'lib/saga/runtime-binding.mjs'],
  'X04-D': ['package.json', 'test/invocation-recovery-emission.test.mjs'],
};

// Local bank design acceptance only. No portable product compiler or banking execution engine.
function roadmapErrors(artifacts) {
  const errors = [...validateArtifacts(snapshot, artifacts).errors];
  const check = (ok, where, message) => { if (!ok) errors.push(`${where}: ${message}`); };
  const find = id => artifacts.find(row => row.id === id);
  const baseline = find('decision.i0-baseline-coverage'), original = baseline?.body.coverageRows || [];
  const oldScope = baseline?.body.scopeDecisions || [], overlay = find('decision.cash-entry-prerequisites');
  const ownership = find('decision.i0-boundary-ownership'), slice = find('decision.cash-first-slice-design');
  const pointer = (link, where) => {
    const a = find(link?.artifact), atom = a && snapshot.atoms.find(row => `tree/${row.file}` === a.source.file);
    check(!!atom && resolve(atom.doc, link?.pointer) !== undefined, where, 'own authored source pointer must resolve');
    return atom && resolve(atom.doc, link?.pointer);
  };
  const auth = (value, where) => {
    check(value?.source === 'user-approved-full-target-roadmap-plan' && value.scope === 'bank-source-design-navigation-and-local-acceptance-only', where, 'actual limited plan provenance');
    for (const key of ['policySelectionAuthorized', 'publicExecutionAuthorized', 'publicEPExists', 'applicationGenerationAuthorized', 'fundsRuntimeAuthorized', 'productionPoliciesApproved', 'externalBankMockAuthorized']) check(value?.[key] === false, where, `no inferred ${key}`);
  };
  const readiness = (value, where) => {
    for (const key of ['bootstrapVerified', 'authorityEnforced', 'runtimeBindingVerified', 'runnable', 'designComplete']) check(value?.[key] === false, where, `${key} remains unverified`);
    check(value?.publicImplementation === 'not-started' && value.publicTests === 'not-run' && value.applicationGeneration === 'not-run' && value.independentAudit === 'not-performed', where, 'honest implementation/execution levels');
  };
  const checkDag = (rows, where) => {
    const ids = new Set(rows.map(row => row.id)), active = new Set(), done = new Set();
    const visit = id => {
      if (active.has(id)) { check(false, where, `cycle at ${id}`); return; }
      if (done.has(id)) return;
      active.add(id);
      for (const dep of rows.find(row => row.id === id)?.dependsOn || []) {
        check(ids.has(dep) && dep !== id, where, `known independent prerequisite ${dep}`);
        if (ids.has(dep) && dep !== id) visit(dep);
      }
      active.delete(id); done.add(id);
    };
    check(ids.size === rows.length, where, 'unique identities');
    for (const row of rows) { check(Array.isArray(row.dependsOn) && new Set(row.dependsOn).size === row.dependsOn.length, where, 'explicit unique dependency set'); visit(row.id); }
  };
  for (const [i, id] of IDS.entries()) {
    const note = find(id);
    if (!note) { check(false, id, 'required roadmap note'); continue; }
    check(note.category === 'decision' && note.status === 'demo-proposal' && note.provenance?.workshopHeld === false, id, 'not a workshop, policy approval or runtime product');
    check(note.source.board === 'wealth-roadmap-v1' && note.source.seq === i && note.source.stage === 'refining' && note.source.note === `question:${NAMES[i]}`, id, 'stable new board/order/identity');
    check(same(note.body.entities, []) && same(note.body.edges, []), id, 'no fabricated runtime/graph entities');
    auth(note.body.authorization, id); readiness(note.body.readiness, id);
  }
  const r = find(IDS[0])?.body;
  if (r) {
    pointer(r.originalCoverage, IDS[0]); pointer(r.selectedDesignSource, IDS[0]); pointer(r.originalOpenSource, IDS[0]);
    const goals = r.coverageRows || [];
    check(same(goals.map(row => row.id), COVERAGE), IDS[0], 'exact ordered 23 coverage IDs, no omitted required goal');
    for (const [i, row] of goals.entries()) {
      const old = original[i], resolved = pointer(row.original, row.id);
      check(row.original?.artifact === baseline?.id && row.original.pointer === `/payload/info/artifact/body/coverageRows/${i}` && resolved?.id === row.id, row.id, 'exact original row provenance');
      check(row.topic === old?.topic && row.scope === old?.scope && row.originalDesign === old?.design && row.owner === old?.owner, row.id, 'preserve historical scope/design/topic/owner');
      check(populated(row.phases) && row.phases.every(id => PHASES.includes(id)) && populated(row.gap) === false && text(row.gap), row.id, 'phase and concrete gap');
      check(row.runtimeQualified === false && text(row.implementationStatus) && same(row.evidenceLevelsRequired, LAYERS), row.id, 'evidence levels separate from runtime success');
      check(same(row.facets?.map(f => f.facet), ['business', 'product', 'technical']), row.id, 'all three coverage dimensions');
      for (const facet of row.facets || []) { pointer(facet.original, row.id); check(facet.original?.pointer === `/payload/info/artifact/body/coverageRows/${i}/${facet.facet}`, row.id, 'exact dimension provenance'); }
      check((row.decisionIds || []).every(id => oldScope.some(d => d.id === id)), row.id, 'decision IDs resolve');
      check((row.publicExtensions || []).every(id => ownership?.body.publicExtensions.some(e => e.id === id)), row.id, 'public extension IDs resolve');
      check((row.cashObligations || []).every(id => slice?.body.acceptanceObligations.some(g => g.id === id)), row.id, 'cash obligation IDs resolve');
      if (row.scope === 'required') check(row.disposition === 'required-cannot-drop-blocked-gates', row.id, 'required blocked goals do not disappear');
      if (row.scope === 'deferred') check(row.disposition === 'deferred-not-a-passed-positive', row.id, 'deferred not positive evidence');
      if (row.scope === 'excluded') check(row.disposition === 'excluded-not-a-bounded-positive', row.id, 'excluded outside completion denominator');
    }
    const sip = goals.find(row => row.id === 'I0-C11');
    check(sip?.scope === 'required' && sip.phases.includes('R6') && /not cash migration/.test(sip.gap), 'I0-C11', 'required SIP and old-path migration gap retained');
    check(goals.find(row => row.id === 'I0-C01')?.currentDesign === 'partial-selected-demo-prerequisite-only', 'I0-C01', 'seed selection does not approve full lifecycle');
    const bounded = r.boundedCompletion;
    check(same(bounded?.requiredBusiness, ['owned-demo-account-and-trusted-mapping', 'cash-request-payment-cancel-outcomes', 'TA-confirmed-or-rejected-evidence', 'independent-refund-after-explicit-TA-rejection', 'SIP-occurrence-lifecycle-and-history']) && bounded.unresolvedRequiredBlocksCompletion === true, IDS[0], 'full bounded business endpoint, not payment-only');
    check(bounded?.customerFinalSuccess === 'TA-confirmed-not-payment-marker' && bounded.fullAccountLifecycleSelected === false, IDS[0], 'TA final, no full account approval');
    check(same(bounded?.conditionalBusiness, ['internal-transfer', 'holdings-aggregation', 'bounded-batch']) && same(bounded.deferredBusiness, ['real-external-bank-topup-settlement']) && same(bounded.excludedBusiness, ['whole-bank-product-suite', 'production-financial-regulatory-certification']), IDS[0], 'conditional/deferred/excluded explicit');
    const chosen = r.selectedDesignDecisions || [];
    check(same(chosen.map(row => row.id), SELECTED), IDS[0], 'only three already selected designs');
    for (const [i, row] of chosen.entries()) { pointer(row.original, row.id); check(row.original?.artifact === overlay?.id && row.original.pointer === `/payload/info/artifact/body/resolvedDecisions/${i}` && row.status === 'selected-demo-design' && row.implementation === 'not-started' && row.enforcementVerified === false, row.id, 'selection only from current overlay, no enforcement'); }
    const schedule = r.openDecisionSchedule || [], expectedOpen = overlay?.body.remainingOpenDecisions || [];
    check(same(schedule.map(row => row.id), expectedOpen.map(row => row.id)), IDS[0], 'all eight exact open decisions');
    for (const [i, row] of schedule.entries()) {
      pointer(row.original, row.id); pointer(row.currentOpenSource, row.id);
      check(row.status === 'open' && row.selectedChoice === null && row.owner === expectedOpen[i]?.owner && same(row.original, expectedOpen[i]?.original), row.id, 'open status/owner/provenance remains');
      const before = ['I0-S03-internal-transfer', 'I0-S08-batch-scope'].includes(row.id) ? 'R7' : row.id === 'I0-S04-holdings' ? 'R4' : row.id.includes('sip-') ? 'R6' : 'R2';
      check(row.reviewBefore === before, row.id, 'review before consuming milestone');
    }
    const review = r.consumerStackReview;
    check(review?.decisionId === 'I0-S10-consumer-stack' && review.status === 'candidate-review-preparation-only', IDS[0], 'S10 review only');
    for (const key of ['selectedTarget', 'selectedApiStack', 'selectedUiStack', 'selectedDeployment']) check(review?.[key] === null, IDS[0], `unselected ${key}`);
    check(same(review?.candidates?.map(row => row.choice), oldScope[9]?.choices) && populated(review.reviewChecklist), IDS[0], 'all exact S10 candidates and review obligations');
    for (const [i, candidate] of (review?.candidates || []).entries()) { pointer(candidate.original, IDS[0]); check(candidate.selected === false && candidate.original.pointer === `/payload/info/artifact/body/scopeDecisions/9/choices/${i}`, IDS[0], 'candidate remains unselected and exact'); }
    const extra = r.supplementalDecisions || [];
    check(same(extra.map(row => row.id), ['ROADMAP-D-refund-entry-authority', 'ROADMAP-D-sip-funding-path']), IDS[0], 'refund owner and SIP funding gaps explicit');
    for (const row of extra) check(row.status === 'open' && row.selectedChoice === null && text(row.owner) && populated(row.excludes) && PHASES.includes(row.reviewBefore), row.id, 'no supplemental policy choice');
    const phases = r.phases || [];
    check(same(phases.map(row => row.id), PHASES), IDS[0], 'all nine staged milestones'); checkDag(phases, 'phases');
    for (const phase of phases) {
      check(phase.status === 'future-proposed' && phase.implementation === 'not-started' && phase.execution === 'not-run' && phase.runtimeQualified === false, phase.id, 'milestone not executed');
      check(text(phase.owner) && populated(phase.deliverables) && populated(phase.exitEvidence) && populated(phase.evidenceLayers), phase.id, 'owner/deliverables/actual exit evidence');
      check(same(phase.coverageIds, goals.filter(row => row.phases.includes(phase.id)).map(row => row.id)), phase.id, 'both sides coverage/phase mapping agree');
      check(phase.conditionalOnly === (phase.id === 'R7') && phase.mandatoryForFinal === (phase.id !== 'R7'), phase.id, 'SIP mandatory, conditional R7 not implicitly approved');
    }
    check(phases.find(row => row.id === 'R8')?.dependsOn.includes('R6'), 'R8', 'full qualified target does not omit SIP');
    const extensions = r.publicExtensions || [];
    check(same(extensions.map(row => row.id), ownership?.body.publicExtensions.map(row => row.id)), IDS[0], 'all X01-X10 retained'); checkDag(extensions, 'extensions');
    for (const [i, row] of extensions.entries()) {
      pointer(row.original, row.id);
      check(same(row.dependsOn, ownership?.body.publicExtensions[i]?.dependsOn) && row.owner === 'metarch-truthsrc' && row.implementation === 'not-started' && row.executionAuthorized === false && row.bankQualified === false, row.id, 'public owner and original dependency boundary');
      check(row.prerequisiteGate === 'accepted-portable-capability-slice-not-final-bank-qualification', row.id, 'do not create final-bank-qualification cycle');
      if (i < 4) pointer(row.detailedSpecification, row.id);
    }
    for (const [key, originalKey, count, identity] of [['technicalNeedCoverage', 'technicalNeeds', 12, 'id'], ['cashAcceptanceCoverage', 'acceptanceObligations', 15, 'id'], ['productPlaneCoverage', 'productPlanes', 5, 'plane']]) {
      const rows = r[key] || [];
      check(rows.length === count && same(rows.map(row => row[identity]), slice?.body[originalKey].map(row => row[identity])), key, 'all original obligations/product planes mapped');
      for (const [i, row] of rows.entries()) { pointer(row.original, key); check(row.original?.artifact === slice?.id && row.original.pointer === `/payload/info/artifact/body/${originalKey}/${i}`, key, 'exact obligation pointer'); }
    }
    const critical = r.criticalGates || [];
    check(same(critical.map(row => row.id), ['ROADMAP-G-seed-fence', 'ROADMAP-G-mock-unknown-progress', 'ROADMAP-G-cancel-readside', 'ROADMAP-G-sip-terminal']), IDS[0], 'all known hard gates explicit');
    for (const row of critical) check(row.runtimeVerified === false && text(row.rule) && PHASES.includes(row.before), row.id, 'known hard gate not a pass');
    const fence = critical[0];
    check(fence?.protectedParticipantWriteAuthorized === false && /insufficient/.test(fence.rule) && /committed-aware/.test(fence.rule), IDS[0], 'stable txid/host query not a seed fence and no protected write');
    check(/no dueTick/.test(critical[1]?.rule || ''), IDS[0], 'MockTA unknown progression gap not hidden');
    const policy = r.evidencePolicy;
    check(same(policy?.layers, LAYERS) && policy.runtimeNotInheritedFromSource === true && policy.exclusionsNeedExplicitBasis === true, IDS[0], 'five separate evidence levels');
    for (const key of ['testsCountIsCoverage', 'requiredBlockedMayDisappear', 'blockedDiagnosticsAreBankPositive', 'historicalReceiptIsCurrentEvidence']) check(policy?.[key] === false, IDS[0], `no false evidence ${key}`);
    check(policy?.testRegistration?.current === 'test:current-seven-explicit-files' && policy.testRegistration.default === 'six-file-historical-selected-scope-preserved' && policy.testRegistration.paused === 'excluded-not-executed-skip', IDS[0], 'actual user-selected test registration boundary');
    const retained = r.retainedBoundaries;
    check(retained?.fundCompany === 'simulation-authorized' && retained.externalBankMock === 'not-authorized' && retained.pausedDrafts === 'preserve-no-execution', IDS[0], 'TA/bank/paused scope');
    for (const key of ['unknownAllowsNewDebit', 'unknownAllowsRefund', 'retryRemapAllowed', 'paymentDirectIndependentStartAllowed', 'publicCodeAuthorized', 'generatedAppAuthorized', 'sourceHashIsDefinitionConsumption']) check(retained?.[key] === false, IDS[0], `retained ${key}`);
    const reuse = r.reuseAndFeedback;
    check(populated(reuse?.existingApply) && populated(reuse.existingAnchors) && reuse.portableFeedbackRequiresTwoDomains === true, IDS[0], 'existing apply/anchors and two-domain public feedback');
    for (const key of ['rebuildApplyAllowed', 'rebuildAnchorEngineAllowed', 'crossFileAtomicityClaimAllowed', 'bankCompatibilityShimAllowed']) check(reuse?.[key] === false, IDS[0], `no new ${key}`);
    check(same(reuse?.recordedPeerEvidence?.map(row => row.batch), ['P16', 'P17', 'P18', 'P19']) && reuse.recordedPeerEvidence.every(row => row.rerunHere === false) && reuse.recordedPeerEvidence[3].observedStatus === 'recorded-frozen-scope-accepted' && reuse.recordedPeerEvidence[3].bankRuntimeQualified === false, IDS[0], 'peer recorded narrow acceptance is not bank runtime');
    check(r.immediateIncrement?.publicImplementationAuthorized === false && r.immediateIncrement.laterIterationAuthorizationInherited === false && text(r.immediateIncrement.subsequentAction), IDS[0], 'not endless design or inherited next implementation authorization');
  }
  const packages = IDS.slice(1).flatMap(id => find(id)?.body.packages || []);
  check(same(packages.map(row => row.id), PACKAGE_IDS), 'packages', 'four plus four public packages');
  const allPackages = [...(find('decision.public-x01-work-packages')?.body.packages || []), ...(find('decision.public-x02-work-packages')?.body.packages || []), ...packages];
  checkDag(allPackages, 'public packages');
  for (const [i, id] of IDS.slice(1).entries()) {
    const note = find(id); if (!note) continue;
    pointer(note.body.upstreamSpecification, id);
    check(note.body.upstreamSpecification.artifact === ownership?.id && note.body.upstreamSpecification.pointer === `/payload/info/artifact/body/publicExtensions/${i + 2}` && note.body.extensionId === `X0${i + 3}`, id, 'exact original public extension');
    check(note.body.implementation === 'not-started' && note.body.owner === 'metarch-truthsrc' && populated(note.body.executionProtocol) && text(note.body.parallelSourceObservation), id, 'public owner/checkout/execute boundary');
  }
  const safePublic = file => text(file) && file.startsWith('metarch-truthsrc/') && !file.includes('..') && !file.startsWith('/') && !file.includes('\\');
  for (const p of packages) {
    check(p.status === 'proposal' && p.implementation === 'not-started' && p.publicExecutionAuthorized === false && p.owner === 'metarch-truthsrc' && text(p.ownerLayer), p.id, 'public proposal owner, no execute authorization');
    for (const key of ['authorizationGate', 'input', 'output', 'migration', 'futureWritePolicy']) check(text(p[key]), p.id, `${key} contract`);
    for (const key of ['sourceReadSet', 'futureWriteSet', 'proposedCreateSet', 'tasks', 'positiveTests', 'negativeTests', 'compatibility', 'exitGates', 'nonGoals']) check(populated(p[key]), p.id, `${key} nonempty`);
    for (const row of p.sourceReadSet || []) check(safePublic(row.file) && text(row.lines) && text(row.observation), p.id, 'safe located public source observation');
    for (const file of p.futureWriteSet || []) check(safePublic(file) && p.sourceReadSet?.some(row => row.file === file), p.id, 'future existing write only in observed allocation');
    for (const row of p.proposedCreateSet || []) check(safePublic(row.file) && text(row.purpose) && text(row.kind) && row.status === 'proposed-not-created', p.id, 'new proposed allocated file, not created');
    for (const file of requiredAllocations[p.id] || []) check(p.proposedCreateSet?.some(row => row.file === `metarch-truthsrc/${file}`), p.id, `mandatory product/test/fixture allocation ${file}`);
    for (const file of requiredExisting[p.id] || []) check(p.futureWriteSet?.includes(`metarch-truthsrc/${file}`), p.id, `mandatory existing target/test face ${file}`);
    const api = p.publicApiContract;
    check(text(api?.proposedEntry) && text(api.inputShape) && text(api.outputShape) && text(api.purity) && populated(api.implementationAllocation), p.id, 'explicit API/type/product contract');
    for (const file of api?.implementationAllocation || []) check(p.futureWriteSet?.includes(file) || p.proposedCreateSet?.some(row => row.file === file), p.id, 'API location inside scoped allocation');
    for (const f of [p.bankFixture, p.secondDomainFixture]) check(f?.status === 'proposed' && f.implemented === false && f.executed === false && text(f.scenario), p.id, 'both fixtures are future, not executed');
    check(p.bankFixture?.domain === 'bank-wealth-cash' && p.secondDomainFixture?.domain === 'travel-booking', p.id, 'independent second domain');
    for (const gate of [...(p.positiveTests || []), ...(p.negativeTests || [])]) check(text(gate.id) && text(gate.assertion) && gate.execution === 'not-run' && ['portableContract', 'generatedDomainBehavior'].includes(gate.phase) && ['future-public-contract', 'future-fail-closed'].includes(gate.evidenceLevel), p.id, 'test phase and unexecuted level');
    for (const gate of p.compatibility || []) check(gate.execution === 'not-run' && gate.evidenceLevel === 'future-compatibility' && text(gate.assertion), p.id, 'future compatibility');
    const comp = p.compatibilityBaseline;
    check(comp?.status === 'proposed-to-pin-at-public-implementation' && comp.execution === 'not-run' && populated(comp.corpus), p.id, 'pin affected compatibility');
    for (const suite of ['test/generate-cli.test.mjs', 'test/generate-anchors.test.mjs', 'test/saga-generator.test.mjs', 'test/saga-fab-runtime-binding-v3.test.mjs', 'test/invocation-recovery-emission.test.mjs', 'test/money-prepare-evidence.test.mjs']) check(comp?.minimumExistingSuites?.includes(suite), p.id, `feature-present compatibility ${suite}`);
    const phases = p.gatePhases;
    check(phases?.portableContract?.supportsIndependentClosure === true && phases.portableContract.execution === 'not-run' && populated(phases.portableContract.requiredEvidence), p.id, 'portable closure independent');
    check(phases?.generatedDomainBehavior?.execution === 'not-run' && phases.generatedDomainBehavior.bankExecution === 'not-run-blocked-until-prerequisites' && phases.generatedDomainBehavior.diagnosticsDoNotCountAsPositiveBankBehavior === true && populated(phases.generatedDomainBehavior.bankPrerequisites) && text(phases.generatedDomainBehavior.prerequisitesInterpretation), p.id, 'capability slices vs bank final gate no loop or false positive');
    check(phases?.finalQualification?.execution === 'not-run' && phases.finalQualification.runtimeCertification === false && text(phases.finalQualification.rule), p.id, 'not banking runtime certification');
    check(p.peerCoordination?.state === 'owner-must-recheck-current-peer-lock-before-write' && text(p.peerCoordination.rule) && Array.isArray(p.peerCoordination.overlap), p.id, 'P19 peer overlap explicit');
  }
  const pkg = id => packages.find(row => row.id === id);
  const type = pkg('X03-A')?.typePolicy;
  check(type?.identity === 'domain-and-wire-separate' && type.collision === 'reject-before-emission' && type.constraints === 'explicit-domain-contract-not-global-default' && type.domainMutationAllowed === false, 'X03-A', 'type collision/policy ownership');
  const codec = pkg('X03-B')?.codecPolicy;
  check(codec?.arithmetic === 'exact-no-binary-float' && codec.receiptBytes === 'preserve-original-canonical-bytes' && codec.implicitRoundingAllowed === false && codec.implicitScaleAllowed === false && codec.unsupported === 'fail-before-apply-or-effects', 'X03-B', 'exact no implicit policy/float');
  const serialization = pkg('X03-C')?.serializationPolicy;
  check(serialization?.coverage === 'every-referenced-domain-proto-converter-registration' && serialization.missingDefinition === 'fail-before-apply' && serialization.lossyFallbackAllowed === false && serialization.actualCompilationRequired === true && serialization.stateEventReplayRequired === true, 'X03-C', 'no ghost PO or lossy fallback; actual compile/replay');
  const evidence = pkg('X04-A')?.evidencePolicy;
  check(evidence?.carrierSelection === 'explicit-not-literal-field-name' && evidence.lineage === 'exact-confirmation-txid-key-value-resource' && evidence.legacyDefault === 'validated-unambiguous-only' && evidence.schemaExpansion === 'owner-approved-versioned-contract-first', 'X04-A', 'explicit lineage and schema approval');
  const observation = pkg('X04-B')?.observationPolicy;
  check(observation?.exactValueRequired === true && observation.unknownConfirmsEffects === false && observation.queryCreatesNewEffects === false && observation.fabricatedConfirmationAllowed === false, 'X04-B', 'exact observation not synthetic effect confirmation');
  const completion = pkg('X04-C')?.completionPolicy;
  check(same(completion?.resultKinds, ['succeeded', 'rejected-before-effects', 'compensated', 'recovery-required', 'outcome-unknown']) && completion.destination === 'retained-original-result-owner' && completion.firstParticipantFallbackAllowed === false && completion.successfulTargetCommitRequiredForEarlyOutcome === false && completion.associationBeforeInvokeAndEarlyOutcomeRequired === true && completion.txidIsAuthentication === false && completion.authorityOwner === 'X07-contract-and-bank-concrete-binding' && completion.runtimeHostOwner === 'X08-finite-generic-host-and-bank-consumer', 'X04-C', 'all five kinds exact target/early association/auth ownership');
  check(same(pkg('X03-D')?.blockedBankBehaviorBy, ['X04', 'X07', 'X08']) && same(pkg('X04-D')?.blockedBankBehaviorBy, ['X07', 'X08']), 'final gates', 'runtime prerequisites not concealed');
  return errors;
}

function mutated(id, change) {
  const a = structuredClone(source); change(a.find(row => row.id === id)); return a;
}
const row = (n, id) => n.body.coverageRows.find(r => r.id === id);
const pkg = (n, id) => n.body.packages.find(p => p.id === id);

test('roadmap covers all 23 goals, eight open decisions, five planes, twelve needs and fifteen obligations', () => {
  assert.deepEqual(roadmapErrors(source), []);
  for (const id of IDS) {
    const a = source.find(row => row.id === id), atom = snapshot.atoms.find(row => `tree/${row.file}` === a.source.file);
    assert.equal(atom.doc.payload.sourceCapture, undefined);
  }
});

test('all pre-roadmap truth, domain/bindings, old design tests and historical receipts retain measured bytes', () => {
  const old = JSON.parse(readFileSync(join(ROOT, 'docs/CASH-NEXT-DESIGN-VERIFICATION.json'), 'utf8'));
  const frozen = old.currentInputFiles.filter(r => r.file.startsWith('tree/') || /^(?:wealth-)?(?:bindings|execution-bindings|runtime-binding)\.json$/.test(r.file) || /^(?:compiled|isolation-zone|qualification)\//.test(r.file) || /^(?:test\/(?:i0-design|cash-next-design|domain-runner)\.test\.mjs|tools\/qualify-domain\.mjs|docs\/(?:BASELINE|VERIFICATION|SECOND-BATCH-INCREMENT|SECOND-BATCH-VERIFICATION|I0-VERIFICATION)\.json)$/.test(r.file));
  assert.ok(frozen.length > 0);
  for (const r of frozen) assert.equal(sha256(readFileSync(join(ROOT, r.file))), r.sha256, r.file);
  assert.equal(existsSync(join(ROOT, 'tools/domain-spec.mjs')), false);
});

test('default old six-file script is preserved and user-selected test:current explicitly executes all seven files', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const old = ['truth', 'projections', 'cash-contract', 'mock-ta', 'i0-design', 'cash-next-design'].map(n => `test/${n}.test.mjs`);
  assert.equal(pkg.scripts.test, `node --test ${old.join(' ')}`);
  assert.equal(pkg.scripts['test:current'], `node --test ${[...old, 'test/roadmap-design.test.mjs'].join(' ')}`);
  assert.equal(pkg.scripts['test:roadmap'], 'node --test test/roadmap-design.test.mjs');
  for (const name of ['test', 'test:current', 'test:roadmap']) assert.ok(!pkg.scripts[name].includes('*') && !pkg.scripts[name].includes('domain-runner'));
});

test('current navigation points to source proposals and separates new roadmap receipt from history', () => {
  for (const file of ['README.md', 'docs/FULL-TARGET-ROADMAP.md', 'docs/PUBLIC-EXTENSIONS.md', 'docs/HANDOFF.md', 'docs/IMPLEMENTATION-STATUS.md']) {
    const content = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(content.includes('ROADMAP-DESIGN-VERIFICATION.json'), `${file}: new current receipt`);
    assert.ok(content.includes('CASH-NEXT-DESIGN-VERIFICATION.json'), `${file}: retained earlier receipt`);
    assert.ok(content.includes('test:current') && content.includes('test:roadmap'), `${file}: current vs default explicit selection`);
    const linked = snapshot.atoms.filter(a => content.includes(a.file.split('/').at(-1)));
    for (const match of content.matchAll(/`(\/payload\/info\/artifact[^`\s]*)`/g)) assert.ok(linked.some(a => resolve(a.doc, match[1]) !== undefined), `${file}: exact pointer ${match[1]}`);
  }
});

const mutants = [
  ['omitted required goal', IDS[0], n => { n.body.coverageRows = n.body.coverageRows.filter(r => r.id !== 'I0-C11'); }],
  ['duplicate coverage goal', IDS[0], n => { n.body.coverageRows[1].id = 'I0-C01'; }],
  ['scope shrunk to payment', IDS[0], n => { n.body.boundedCompletion.requiredBusiness.pop(); }],
  ['required SIP deferred', IDS[0], n => { row(n, 'I0-C11').scope = 'deferred'; }],
  ['required blocked goal disappears', IDS[0], n => { n.body.evidencePolicy.requiredBlockedMayDisappear = true; }],
  ['SIP migration falsely complete', IDS[0], n => { row(n, 'I0-C11').gap = 'legacy pipeline already migrated'; }],
  ['full lifecycle implicitly selected', IDS[0], n => { n.body.boundedCompletion.fullAccountLifecycleSelected = true; }],
  ['fourth design selected', IDS[0], n => { n.body.selectedDesignDecisions.push(structuredClone(n.body.openDecisionSchedule[0])); }],
  ['open decision approved', IDS[0], n => { n.body.openDecisionSchedule[0].status = 'selected-demo-design'; }],
  ['missing eighth open decision', IDS[0], n => { n.body.openDecisionSchedule.pop(); }],
  ['S10 target selected by roadmap', IDS[0], n => { n.body.consumerStackReview.selectedTarget = '../banking-app'; }],
  ['S10 candidate selected', IDS[0], n => { n.body.consumerStackReview.candidates[0].selected = true; }],
  ['S10 missing review checklist', IDS[0], n => { n.body.consumerStackReview.reviewChecklist = []; }],
  ['refund entry automatically selected', IDS[0], n => { n.body.supplementalDecisions[0].selectedChoice = 'automatic-browser'; }],
  ['missing SIP funding path decision', IDS[0], n => { n.body.supplementalDecisions.pop(); }],
  ['missing coverage dimension', IDS[0], n => { n.body.coverageRows[0].facets.pop(); }],
  ['wrong original row pointer', IDS[0], n => { n.body.coverageRows[0].original.pointer = '/payload/info/artifact/body/coverageRows/1'; }],
  ['inherited constructor pointer', IDS[0], n => { n.body.coverageRows[0].original.pointer = '/payload/info/artifact/body/constructor'; }],
  ['phase map omits coverage', IDS[0], n => { n.body.phases[2].coverageIds.pop(); }],
  ['phase dependency cycle', IDS[0], n => { n.body.phases[0].dependsOn.push('R8'); }],
  ['unknown phase dependency', IDS[0], n => { n.body.phases[0].dependsOn.push('R99'); }],
  ['R8 excludes SIP', IDS[0], n => { n.body.phases[8].dependsOn = n.body.phases[8].dependsOn.filter(id => id !== 'R6'); }],
  ['SIP milestone made conditional', IDS[0], n => { n.body.phases[6].mandatoryForFinal = false; }],
  ['conditional batch mandatory without choice', IDS[0], n => { n.body.phases[7].mandatoryForFinal = true; }],
  ['milestone runtime qualified', IDS[0], n => { n.body.phases[2].runtimeQualified = true; }],
  ['missing public extension', IDS[0], n => { n.body.publicExtensions.pop(); }],
  ['public dependencies silently changed', IDS[0], n => { n.body.publicExtensions[6].dependsOn = []; }],
  ['final bank gate used as implementation prerequisite', IDS[0], n => { n.body.publicExtensions[1].prerequisiteGate = 'whole-bank-runtime'; }],
  ['missing technical need', IDS[0], n => { n.body.technicalNeedCoverage.pop(); }],
  ['missing acceptance obligation', IDS[0], n => { n.body.cashAcceptanceCoverage.pop(); }],
  ['missing product plane', IDS[0], n => { n.body.productPlaneCoverage.pop(); }],
  ['stable txid claimed as seed fence', IDS[0], n => { n.body.criticalGates[0].rule = 'stable txid is sufficient'; }],
  ['protected participant edit authorized', IDS[0], n => { n.body.criticalGates[0].protectedParticipantWriteAuthorized = true; }],
  ['MockTA unknown already resolved', IDS[0], n => { n.body.criticalGates[1].rule = 'already completed unknown-to-final'; }],
  ['cancel gate missing', IDS[0], n => { n.body.criticalGates.splice(2, 1); }],
  ['runtime inferred from local tests', IDS[0], n => { n.body.readiness.runnable = true; }],
  ['test count as coverage', IDS[0], n => { n.body.evidencePolicy.testsCountIsCoverage = true; }],
  ['old receipt attributed current', IDS[0], n => { n.body.evidencePolicy.historicalReceiptIsCurrentEvidence = true; }],
  ['blocked diagnosis is bank positive', IDS[0], n => { n.body.evidencePolicy.blockedDiagnosticsAreBankPositive = true; }],
  ['payment declared final purchase success', IDS[0], n => { n.body.boundedCompletion.customerFinalSuccess = 'payment-succeeded'; }],
  ['external bank mock enabled', IDS[0], n => { n.body.retainedBoundaries.externalBankMock = 'simulation-authorized'; }],
  ['unknown new debit', IDS[0], n => { n.body.retainedBoundaries.unknownAllowsNewDebit = true; }],
  ['unknown refund allowed', IDS[0], n => { n.body.retainedBoundaries.unknownAllowsRefund = true; }],
  ['retry remaps resources', IDS[0], n => { n.body.retainedBoundaries.retryRemapAllowed = true; }],
  ['public implementation implicitly authorized', IDS[0], n => { n.body.authorization.publicExecutionAuthorized = true; }],
  ['policy selection implicitly authorized', IDS[0], n => { n.body.authorization.policySelectionAuthorized = true; }],
  ['new apply engine', IDS[0], n => { n.body.reuseAndFeedback.rebuildApplyAllowed = true; }],
  ['new anchor engine', IDS[0], n => { n.body.reuseAndFeedback.rebuildAnchorEngineAllowed = true; }],
  ['cross-file rollback inferred', IDS[0], n => { n.body.reuseAndFeedback.crossFileAtomicityClaimAllowed = true; }],
  ['bank host compatibility shim', IDS[0], n => { n.body.reuseAndFeedback.bankCompatibilityShimAllowed = true; }],
  ['P19 narrow acceptance certifies bank runtime', IDS[0], n => { n.body.reuseAndFeedback.recordedPeerEvidence[3].bankRuntimeQualified = true; }],
  ['peer evidence rerun invented', IDS[0], n => { n.body.reuseAndFeedback.recordedPeerEvidence[0].rerunHere = true; }],
  ['later iteration automatically authorized', IDS[0], n => { n.body.immediateIncrement.laterIterationAuthorizationInherited = true; }],
  ['new suite mistaken for default', IDS[0], n => { n.body.evidencePolicy.testRegistration.default = 'seven-file'; }],
  ['public EP invented', IDS[1], n => { n.body.authorization.publicEPExists = true; }],
  ['workshop invented', IDS[1], n => { n.provenance.workshopHeld = true; }],
  ['missing public package', IDS[1], n => { n.body.packages.pop(); }],
  ['package DAG cycle', IDS[1], n => { n.body.packages[0].dependsOn.push('X03-C'); }],
  ['package API omitted', IDS[1], n => { delete n.body.packages[0].publicApiContract; }],
  ['product implementation unallocated', IDS[1], n => { n.body.packages[0].proposedCreateSet.shift(); }],
  ['serialization target omitted', IDS[1], n => { pkg(n, 'X03-C').futureWriteSet = pkg(n, 'X03-C').futureWriteSet.filter(f => !f.endsWith('proto-dsl/emit.mjs')); }],
  ['two-domain fixture omitted', IDS[1], n => { pkg(n, 'X03-D').proposedCreateSet = pkg(n, 'X03-D').proposedCreateSet.filter(f => !f.file.includes('public-travel')); }],
  ['second domain bank-renamed', IDS[1], n => { n.body.packages[0].secondDomainFixture.domain = 'bank-renamed'; }],
  ['fixture executed invented', IDS[1], n => { n.body.packages[0].bankFixture.executed = true; }],
  ['test passed invented', IDS[2], n => { n.body.packages[0].positiveTests[0].execution = 'passed'; }],
  ['unsafe public future path', IDS[1], n => { n.body.packages[0].futureWriteSet.push('metarch-truthsrc/../bank-wealth-demo/tools/host.mjs'); }],
  ['compatibility conveniently feature-absent only', IDS[1], n => { n.body.packages[0].compatibilityBaseline.minimumExistingSuites = ['test/generate.test.mjs']; }],
  ['P19 coordination omitted', IDS[2], n => { delete pkg(n, 'X04-B').peerCoordination; }],
  ['domain and wire Money aliased', IDS[1], n => { pkg(n, 'X03-A').typePolicy.identity = 'same-name-alias'; }],
  ['Money collision overwrite', IDS[1], n => { pkg(n, 'X03-A').typePolicy.collision = 'last-write-wins'; }],
  ['canonical domain mutation allowed', IDS[1], n => { pkg(n, 'X03-A').typePolicy.domainMutationAllowed = true; }],
  ['decimal conversion through float', IDS[1], n => { pkg(n, 'X03-B').codecPolicy.arithmetic = 'double'; }],
  ['implicit rounding', IDS[1], n => { pkg(n, 'X03-B').codecPolicy.implicitRoundingAllowed = true; }],
  ['implicit scale', IDS[1], n => { pkg(n, 'X03-B').codecPolicy.implicitScaleAllowed = true; }],
  ['receipt bytes display-normalized', IDS[1], n => { pkg(n, 'X03-B').codecPolicy.receiptBytes = 'display-normalized'; }],
  ['ghost DecimalPO accepted', IDS[1], n => { pkg(n, 'X03-C').serializationPolicy.missingDefinition = 'qualified-name-is-enough'; }],
  ['lossy serialization fallback', IDS[1], n => { pkg(n, 'X03-C').serializationPolicy.lossyFallbackAllowed = true; }],
  ['generated compile not required', IDS[1], n => { pkg(n, 'X03-C').serializationPolicy.actualCompilationRequired = false; }],
  ['literal committed marker required', IDS[2], n => { pkg(n, 'X04-A').evidencePolicy.carrierSelection = 'literal-committed'; }],
  ['phase lineage omitted', IDS[2], n => { delete pkg(n, 'X04-A').evidencePolicy.lineage; }],
  ['closed schema expanded without approval', IDS[2], n => { pkg(n, 'X04-A').evidencePolicy.schemaExpansion = 'arbitrary-mapper-commandRef'; }],
  ['UNKNOWN proves phase effect', IDS[2], n => { pkg(n, 'X04-B').observationPolicy.unknownConfirmsEffects = true; }],
  ['phase query causes money effects', IDS[2], n => { pkg(n, 'X04-B').observationPolicy.queryCreatesNewEffects = true; }],
  ['first participant completion target', IDS[2], n => { pkg(n, 'X04-C').completionPolicy.firstParticipantFallbackAllowed = true; }],
  ['early refusal requires order commit', IDS[2], n => { pkg(n, 'X04-C').completionPolicy.successfulTargetCommitRequiredForEarlyOutcome = true; }],
  ['association after early delivery', IDS[2], n => { pkg(n, 'X04-C').completionPolicy.associationBeforeInvokeAndEarlyOutcomeRequired = false; }],
  ['txid authenticates sender', IDS[2], n => { pkg(n, 'X04-C').completionPolicy.txidIsAuthentication = true; }],
  ['result kind missing', IDS[2], n => { pkg(n, 'X04-C').completionPolicy.resultKinds.pop(); }],
  ['bank blockers hidden', IDS[2], n => { pkg(n, 'X04-D').blockedBankBehaviorBy = []; }],
  ['portable contract claims bank-positive diagnostic', IDS[1], n => { n.body.packages[0].gatePhases.generatedDomainBehavior.diagnosticsDoNotCountAsPositiveBankBehavior = false; }],
  ['public package certifies bank runtime', IDS[2], n => { n.body.packages[0].gatePhases.finalQualification.runtimeCertification = true; }],
];
for (const [name, id, change] of mutants) test(`negative roadmap design: ${name}`, () => {
  assert.ok(roadmapErrors(mutated(id, change)).length > 0, name);
});
