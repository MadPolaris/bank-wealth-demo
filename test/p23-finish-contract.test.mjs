import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot, parseDoc, declarationIndex, assertSnapshotStable } from '../tools/truth-source.mjs';
import { extractArtifacts, validateArtifacts } from '../tools/artifacts.mjs';
import { CASH_RESULT_KINDS } from '../tools/cash-contract.mjs';

const snapshot = loadSnapshot(), artifacts = extractArtifacts(snapshot);
const ID = 'decision.p23-bank-v1-handoff';
const source = artifacts.find(row => row.id === ID);
const FLOW_IDS = ['payment', 'ta', 'refund', 'sip'];
const COUNTS = [4, 6, 5, 3, 5, 3, 3, 4, 4, 3];
const PACKAGE_IDS = COUNTS.flatMap((n, i) => Array.from({ length: n }, (_, j) => `P${23 + i}-${j + 1}`));
const RESOLUTIONS = ['I0-S03-internal-transfer','I0-S04-holdings','I0-S05-sip-clock','I0-S06-sip-occurrence','I0-S07-sip-counters',
  'I0-S08-batch-scope','I0-S10-consumer-stack','I0-S11-financial-rules','ROADMAP-D-refund-entry-authority','ROADMAP-D-sip-funding-path'];
const SCENARIOS = ['PAY-success','PAY-repeat','PAY-conflict','PAY-early-reject','PAY-unknown-recover','PAY-cancel-before-prepare',
  'TA-confirm','TA-repeat','TA-conflicting-body','TA-unknown-confirm','TA-before-payment','TA-wrong-resource','TA-accepted-only',
  'REFUND-success','REFUND-repeat','REFUND-substitute','REFUND-unknown-recover','REFUND-no-TA-reject','REFUND-conflicting-terminal',
  'SIP-success','SIP-repeat-slot','SIP-conflict-config','SIP-unknown-recover','SIP-no-effects-failure','SIP-pause-backlog',
  'SIP-inflight-pause','SIP-revision-backlog','SIP-late-terminal','SIP-refund-count-boundary','SIP-catch-up-order'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const populated = value => Array.isArray(value) && value.length > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function pointer(doc, path) {
  if (path === '') return doc;
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  return path.slice(1).split('/').reduce((value, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    return value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
  }, doc);
}
const isSafeFile = value => text(value) && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
const documentCache = new Map();
function document(file) {
  if (!isSafeFile(file)) return undefined;
  if (!documentCache.has(file)) {
    try {
      const bytes = readFileSync(join(ROOT, file), 'utf8');
      documentCache.set(file, file.endsWith('.yaml') ? parseDoc(bytes, file) : JSON.parse(bytes));
    } catch { return undefined; }
  }
  return documentCache.get(file);
}
const walk = (value, fn, path = '') => {
  if (!value || typeof value !== 'object') return;
  fn(value, path);
  for (const [key, child] of Object.entries(value)) walk(child, fn, `${path}/${key}`);
};
const resolution = (body, id) => body.resolutions?.find(row => row.id === id)?.details;
const flow = (body, id) => body.flows?.find(row => row.id === id);
const scenario = (body, id) => body.scenarios?.find(row => row.id === id);
const observed = (body, id, kind, subject, expected) => scenario(body, id)?.expectedObservations?.some(row => row.kind === kind && row.subject === subject && same(row.expected, expected));

// Bank design-contract checks only. These compare source references and required
// obligations; they never execute funds, a policy state machine or public lowering.
function contractErrors(candidate) {
  const errors = [];
  const check = (ok, at, message) => { if (!ok) errors.push(`${at}: ${message}`); };
  if (!candidate?.body) return ['P23 artifact/body missing'];
  const body = candidate.body;
  errors.push(...validateArtifacts(snapshot, artifacts.map(row => row.id === ID ? candidate : row)).errors);
  check(candidate.id === ID && candidate.status === 'demo-proposal', 'artifact', 'original proposal envelope');
  check(candidate.provenance?.workshopHeld === false && candidate.provenance?.source === 'user-approved-bounded-v1-and-bank-p23-plan', 'provenance', 'actual selected-policy source, no fictional workshop');
  check(candidate.source?.board === 'wealth-p23-v1-handoff' && candidate.source?.seq === 0, 'source', 'new independent capture address');
  check(body.designVersion === 'bank-v1-p23-design-1', 'designVersion', 'business design version distinct from schemas');
  check(body.authorization?.scope === 'bank-source-design-contract-tests-and-projections-only', 'authorization', 'bank-only scope');
  for (const key of ['publicSourceWritesAuthorized','runtimeWritesAuthorized','serviceLifecycleAuthorized','productionPoliciesApproved','externalBankMockAuthorized']) {
    check(body.authorization?.[key] === false, 'authorization', `${key} stays false`);
  }
  check(same(body.inheritedDecisions?.map(row => row.id), ['I0-S01-account-setup','I0-S02-account-ownership','I0-S09-cash-entry-owner']), 'inheritedDecisions', 'three prior selected decisions');
  check(same(body.resolutions?.map(row => row.id), RESOLUTIONS), 'resolutions', 'exact ten already-selected resolutions');
  for (const row of body.resolutions || []) check(row.status === 'selected-demo-design' && row.decisionBasis === 'user-approved-bounded-v1-and-p23-policies' && row.enforcementVerified === false && populated(row.supersedes), row.id, 'selected source and explicit supersession, not enforcement');

  const canonical = declarationIndex(snapshot.canonical);
  walk(body, (value, path) => {
    if (value.artifact && Object.hasOwn(value, 'pointer')) {
      const ref = value.artifact === ID ? candidate : artifacts.find(row => row.id === value.artifact);
      const atom = ref?.source && snapshot.atoms.find(row => `tree/${row.file}` === ref.source.file);
      const target = value.artifact === ID ? { payload: { info: { artifact: candidate } } } : atom?.doc;
      check(!!ref && pointer(target, value.pointer) !== undefined, path, 'artifact source pointer resolves');
    }
    if (Object.hasOwn(value, 'file') && Object.hasOwn(value, 'pointer')) {
      check(isSafeFile(value.file) && pointer(document(value.file), value.pointer) !== undefined, path, 'safe source file/pointer resolves');
    }
    for (const key of ['runtimeVerified','runtimeQualified','runnable','generated','authorityEnforced','runtimeBindingVerified']) {
      if (Object.hasOwn(value, key)) check(value[key] === false, path, `${key} must not certify implementation`);
    }
    if (Object.hasOwn(value, 'execution')) check(value.execution === 'not-run', path, 'runtime oracle not executed');
    check(!Object.keys(value).some(key => /^(sha256|sourceDigest|toolDigest|measuredAt|publishedAt|gitHead)$/.test(key)), path, 'tool evidence stays outside truth');
  });

  const coverage = body.coverageRows || [], packages = body.acceptancePackages || [];
  check(same(coverage.map(row => row.id), Array.from({ length: 23 }, (_, i) => `I0-C${String(i + 1).padStart(2, '0')}`)), 'coverage', 'exact 23 original rows');
  const nonrequired = new Map([['I0-C03','conditional-follow-up-not-required'], ['I0-C04','deferred'], ['I0-C15','conditional-follow-up-not-required'], ['I0-C23','excluded']]);
  for (const row of coverage) {
    check(row.disposition === (nonrequired.get(row.id) ?? 'required'), row.id, 'selected V1 scope retained');
    if (row.disposition === 'required') check(populated(row.subscopes?.required) && populated(row.milestones) && populated(row.oraclePackageIds), row.id, 'required subscopes and oracle coverage');
    for (const id of row.oraclePackageIds || []) check(PACKAGE_IDS.includes(id), row.id, 'known acceptance package');
  }
  check(coverage.find(row => row.id === 'I0-C01')?.subscopes.notIncluded.includes('full-account-opening-freezing-closing'), 'C01', 'demo account not full lifecycle');
  check(coverage.find(row => row.id === 'I0-C09')?.subscopes.required.includes('single-order-exact-confirmed-shares') && coverage.find(row => row.id === 'I0-C09')?.subscopes.notIncluded.includes('total-holdings-aggregate'), 'C09', 'single order shares not total holdings');
  check(same(packages.map(row => row.id), PACKAGE_IDS), 'packages', 'exact existing forty packages');
  check(same(body.milestones?.map(row => row.id), COUNTS.map((_, i) => `P${23 + i}`)), 'milestones', 'P23-P32 only');
  for (const [i, milestone] of (body.milestones || []).entries()) {
    check(same(milestone.packageIds, PACKAGE_IDS.filter(id => id.startsWith(`P${23 + i}-`))), milestone.id, 'milestone package set');
    const expected = milestone.id === 'P31' ? ['P26','P27','P28','P29','P30'] : i ? [`P${22 + i}`] : [];
    check(same(milestone.dependsOn, expected), milestone.id, 'required prior milestones');
  }
  const active = new Set(), done = new Set();
  function visit(id) {
    if (active.has(id)) { errors.push(`package dependency cycle: ${id}`); return; }
    if (done.has(id)) return;
    active.add(id);
    const pack = packages.find(row => row.id === id);
    for (const dep of pack?.dependsOn || []) {
      check(PACKAGE_IDS.includes(dep), id, 'known dependency');
      if (PACKAGE_IDS.includes(dep)) visit(dep);
    }
    active.delete(id); done.add(id);
  }
  for (const pack of packages) {
    visit(pack.id);
    const stage = Number(pack.milestone?.slice(1));
    const requiredStages = stage === 31 ? [26,27,28,29,30] : stage > 23 ? [stage - 1] : [];
    const expectedDependencies = PACKAGE_IDS.filter(id => requiredStages.some(n => id.startsWith(`P${n}-`)));
    if (['P24-6','P25-5','P32-3'].includes(pack.id)) expectedDependencies.push(...PACKAGE_IDS.filter(id => id.startsWith(`${pack.milestone}-`) && id !== pack.id));
    check(same(pack.dependsOn, expectedDependencies), pack.id, 'complete prerequisite stage including artifact and joint gates');
    check(text(pack.ownerRole) && text(pack.evidenceLevel) && text(pack.oracle?.observation) && !!pack.oracleRef, pack.id, 'owner and observable oracle');
    for (const id of pack.scenarioIds || []) check(scenario(body, id)?.acceptancePackage === pack.id, pack.id, 'scenario/package linkage');
  }

  const clock = resolution(body, 'I0-S05-sip-clock');
  check(clock?.mode === 'manual-discrete-business-tick' && clock?.dueSlots === 'explicit-finite-list' && clock?.missed === 'catch-up-in-due-slot-order', 'clock', 'selected manual finite catch-up');
  check(clock?.backlog === 'pre-pause-due-uncreated-retained' && clock?.pausedDue === 'skipped-no-catch-up-debit' && clock?.inFlight === 'finish-original-cash-lifecycle', 'clock', 'pause/backlog/inflight boundary');
  check(clock?.pauseBoundary === 'durable-pause-effective-tick' && clock?.productionCalendarSelected === false, 'clock', 'no invented calendar');
  const identity = resolution(body, 'I0-S06-sip-occurrence');
  check(same(identity?.components, ['planId','revision','dueSlot']) && identity?.attemptInIdentity === false && identity?.processingTimeInIdentity === false && identity?.randomRetryIdentity === false, 'occurrence', 'retained business identity');
  check(identity?.backlogRevision === 'retain-owning-original-revision' && identity?.futureSlotOwnership === 'exactly-one-effective-revision' && identity?.oldPlans === 'no-automatic-migration', 'occurrence', 'revision ownership');
  const counters = resolution(body, 'I0-S07-sip-counters');
  check(counters?.mode === 'first-trusted-business-terminal-totals' && counters?.dedupeBy === 'occurrenceId' && counters?.successEvidence === 'correlated-TAConfirmed', 'counters', 'first trusted terminal');
  check(same(counters?.failureEvidence, ['known-no-effects-rejection','completed-payment-compensation','TARejected-and-independent-refund-completed']), 'counters', 'safe failure evidence');
  check(same(counters?.uncounted, ['pending','outcome-unknown','recovery-required','refund-in-progress','skipped']) && counters?.conflictingTerminal === 'reject', 'counters', 'unresolved not terminal');
  for (const key of ['successResetsFailure','consecutiveFailures','automaticThreeFailurePause']) check(counters?.[key] === false, 'counters', key);
  const refund = resolution(body, 'ROADMAP-D-refund-entry-authority');
  check(refund?.initiator === 'trusted-service' && refund?.startOwner === 'single-durable-refund-pipeline' && refund?.intent === 'one-durable-intent-per-eligible-order', 'refund-policy', 'one trusted intent/start owner');
  check(same(refund?.prerequisites, ['known-succeeded-original-payment','correlated-explicit-TARejected']), 'refund-policy', 'both eligibility facts');
  check(refund?.customerMayCreate === false && refund?.operatorMayCreate === false && refund?.operatorAction === 'recover-existing-refund-only', 'refund-policy', 'customer/operator boundary');
  check(refund?.amount === 'retained-original-full-principal' && refund?.resources === 'retained-original-collection-to-original-investor' && refund?.paymentCompensationIsRefund === false, 'refund-policy', 'independent original principal/resources');
  const funding = resolution(body, 'ROADMAP-D-sip-funding-path');
  check(funding?.path === 'trusted-local-demo-investor-account' && funding?.legacyExternalPath === 'preserved-not-invoked-by-v1' && funding?.externalBankMockAuthorized === false, 'funding', 'no external bank mock or silent migration');
  const money = resolution(body, 'I0-S11-financial-rules');
  const originalPolicy = artifacts.find(row => row.id === 'contract.cash-purchase-v2').body.demoPolicy;
  check(money?.currency === originalPolicy.currency && money?.feesMinorUnits === originalPolicy.feesMinorUnits && money?.refundMode === originalPolicy.refundMode, 'money', 'inherit exact demo policy');
  check(money?.scale === 2 && money?.unrepresentable === 'reject' && money?.implicitRounding === false && money?.binaryFloat === false && money?.pricingFormulaSelected === false, 'money', 'exact selected scale without invented pricing');
  const stack = resolution(body, 'I0-S10-consumer-stack');
  check(stack?.jdk === '11' && stack?.scala === '2.13.14' && stack?.akka === '2.6.20' && stack?.play === '2.8.18' && stack?.journal === 'MongoDB' && stack?.readSide === 'MySQL JDBC', 'stack', 'selected technical baseline');
  check(stack?.serviceLifecycleAuthorized === false && stack?.sharedTargetsAllowed === false && stack?.finalTarget === 'bank-wealth-demo/dist/v1/{bc,js}-app', 'stack', 'no service or shared target writes');

  check(same(body.flows?.map(row => row.id), FLOW_IDS), 'flows', 'exact four flow inventory');
  for (const value of body.flows || []) {
    check(text(value.businessContractVersion) && populated(value.sourceRefs) && populated(value.pendingRequirements), value.id, 'source/version/explicit incomplete requirements');
    check(same(value.scenarioIds, (body.scenarios || []).filter(row => row.flow === value.id).map(row => row.id)), value.id, 'complete scenario linkage');
    for (const binding of value.bindings || []) {
      const full = document(binding.file), row = pointer(full, binding.pointer);
      check(full?.schemaVersion === binding.bindingSchemaVersion, value.id, 'exact binding schema');
      check(row?.[binding.identity?.key] === binding.identity?.value, value.id, 'exact binding identity');
      const versions = row && Object.fromEntries(['version','definitionVersion','runtimeVersion'].filter(key => Object.hasOwn(row, key)).map(key => [key,row[key]]));
      check(same(binding.versions, versions), value.id, 'exact separate binding versions');
      check(same(binding.codec, row?.codec ?? row?.argsCodec ?? null), value.id, 'exact codec binding');
    }
    for (const req of value.pendingRequirements || []) check(req.status === 'binding-requirements-pending-public-contract' && req.implementation === 'not-started' && populated(req.publicExtensionIds), value.id, 'not a fabricated supported binding');
  }
  for (const [id, sagaVersion, runtimeVersion] of [['payment','v2',2], ['refund','v1',1]]) {
    const value = flow(body,id);
    check(value?.existingDeclarations.definitionVersion === sagaVersion && value?.existingDeclarations.planVersion === 'plan-v2' && value?.existingDeclarations.executionSchemaVersion === 'truthsrc.execution/v1', id, 'exact Saga/plan versions');
    check(value?.bindings?.length === 3 && value.bindings.some(row => row.versions.runtimeVersion === runtimeVersion && row.bindingSchemaVersion === 'truthsrc.saga-runtime-binding/v2'), id, 'complete declared binding references');
  }
  const pay = flow(body,'payment');
  check(pay?.identity.startOwner === 'fund-purchase-cash-payment-only' && pay?.identity.directSagaSubscriberEnabled === false && pay?.identity.occurrence === 'source.operationId', 'payment', 'selected sole start/occurrence');
  check(same(pay?.completion.resultKinds, [...CASH_RESULT_KINDS]) && pay?.completion.destination === 'retained-original-FundOrder' && pay?.completion.requiresOrderCommitForEveryKind === false && pay?.completion.associationBeforeInvocation === true, 'payment', 'early original-order result target');
  const ta = flow(body,'ta');
  check(ta?.completion.customerSuccess === 'TAConfirmed-only' && ta?.completion.acceptedIsSuccess === false && ta?.completion.unknownAuthorizesRefund === false && ta?.identity.newRequestOnUnknown === false, 'TA', 'same request nonterminal progress');
  for (const ref of ta?.existingDeclarations.commands || []) check(canonical.has(`command:${ref}`), 'TA', 'actual command declaration');
  check(ta?.bindingStatus === 'technical-bridge-requirements-not-public-binding-schema' && ta?.bindings.length === 0, 'TA', 'bridge requirements not invented binding');
  const rf = flow(body,'refund');
  check(rf?.identity.handlerComputedSlot === 'refundTxId' && rf?.identity.systemInjectedBindingImplemented === false && rf?.identity.unknownStartsNewRefund === false && rf?.identity.differsFromPayment === true, 'refund', 'new retained identity, unresolved typed source');
  check(rf?.resources.newClientAmountAllowed === false && rf?.resources.newClientResourceAllowed === false && rf?.completion.accountWriteOnceLedgerIsSoleAuthority === false && rf?.completion.paymentCompensationIsRefund === false, 'refund', 'resource/authority separation');
  const sip = flow(body,'sip');
  check(sip?.existingDeclarations.declarationRole === 'legacy-external-not-v1-cash' && sip?.existingDeclarations.migrated === false && sip?.readiness.existingExecutableDeclarations === false, 'SIP', 'old declaration not new V1 execution');
  check(same(sip?.identity, identity) && same(sip?.completion, counters), 'SIP', 'policy/body same selected facts');
  check(sip?.inputContract.designOnly === true && populated(sip?.inputContract.required) && sip?.stateContract.designOnly === true && sip?.stateContract.runtimeStateSchemaImplemented === false, 'SIP', 'typed design inventory not fake executable schema');
  for (const field of ['planId','revision','dueSlot','occurrenceId','operationId','fundOrderId','deductionAmount']) check(sip?.inputContract.required.includes(field), 'SIP', `required identity/config ${field}`);
  check(sip?.eventObligations.length >= 5 && sip?.guardObligations.length >= 6 && sip?.foldObligations.length >= 7 && sip?.lifecycle.includes('request-local-cash-payment'), 'SIP', 'minimum state/event/guard/fold/lifecycle obligations');

  check(same(body.scenarios?.map(row => row.id), SCENARIOS), 'scenarios', 'exact thirty representative scenarios');
  for (const value of body.scenarios || []) {
    check(FLOW_IDS.includes(value.flow) && PACKAGE_IDS.includes(value.acceptancePackage), value.id, 'known flow/package');
    check(populated(value.preconditions) && value.inputs && typeof value.inputs === 'object' && populated(value.sequence) && populated(value.expectedObservations) && populated(value.forbiddenEffects) && populated(value.sourceRefs), value.id, 'complete scenario and forbidden effects');
    check(value.execution === 'not-run' && value.evidenceLevel === 'design-oracle-not-runtime-test' && value.originalValuesMustBeRetained === true, value.id, 'unexecuted design oracle');
    for (const row of value.expectedObservations || []) check(['event','state','resource-effect','customer-state','counter','diagnostic'].includes(row.kind) && text(row.subject) && Object.hasOwn(row,'expected'), value.id, 'typed observable');
  }
  for (const id of FLOW_IDS) for (const label of ['success','duplicate','conflict','unknown-recovery','early-failure']) check(body.scenarios?.some(row => row.flow === id && row.labels?.includes(label)), id, `required scenario category ${label}`);
  const requiredObservations = [
    ['PAY-success','resource-effect','investor/collection-minor-units',['90000','10000']],
    ['PAY-success','customer-state','purchase','await-TA-not-yet-success'],
    ['PAY-repeat','event','creation-repeat','no-second-request-or-start; existing-creation-guard-may-reject'],
    ['PAY-early-reject','state','order-commit','not-required-for-this-result'],
    ['TA-accepted-only','customer-state','purchase','pending'],
    ['TA-unknown-confirm','state','TA-request-id','unchanged'],
    ['REFUND-success','resource-effect','final-investor/collection-minor-units',['100000','0']],
    ['REFUND-no-TA-reject','state','refund-intent','absent'],
    ['SIP-repeat-slot','event','cash-request-count',1],
    ['SIP-unknown-recover','counter','while-unknown-total-delta',0],
    ['SIP-pause-backlog','state','slot20','skipped'],
    ['SIP-revision-backlog','state','slot10-revision-and-amount',['revision-1','100.00']],
    ['SIP-late-terminal','counter','all-repeat-count-delta',0],
    ['SIP-refund-count-boundary','counter','until-refund-completed-failure-delta',0],
    ['SIP-refund-count-boundary','counter','after-first-refund-completed-failure-delta',1],
    ['SIP-catch-up-order','event','occurrence-creation-order',[10,20]],
  ];
  for (const row of requiredObservations) check(observed(body, ...row), row[0], `required oracle ${row[2]}`);
  const fixture = body.representativeFixture;
  check(same(fixture?.amount,{amount:'100.00',currency:'CNY'}) && same(fixture?.wireAmount,{minorUnits:'10000',currency:'CNY'}), 'fixture', 'domain and wire Money remain separate');
  check(fixture?.refundTxId !== fixture?.paymentTxId && fixture?.refundOperationId !== fixture?.operationId && fixture?.investorAccountId !== fixture?.fundCollectionAccountId, 'fixture', 'distinct business resources and operations');
  check(fixture?.pricingFormula === 'not-implied-by-example-amount-NAV-or-shares', 'fixture', 'MockTA values do not define pricing');
  check(same(body.bindingInventory?.map(row => row.file), ['bindings.json','execution-bindings.json','runtime-binding.json','wealth-bindings.json','wealth-execution-bindings.json','wealth-runtime-binding.json']), 'bindingInventory', 'six original binding documents');
  for (const row of body.bindingInventory || []) check(document(row.file)?.schemaVersion === row.schemaVersion && row.modifiedByP23 === false && row.completeV1Coverage === false, row.file, 'actual schema and honest V1 coverage');
  check(body.readiness?.designContractValidated === false && body.readiness?.publicSemanticAdmission === 'not-run-for-new-v1-overlay' && body.readiness?.existingSourceGatesDoNotQualifyOverlay === true && body.readiness?.completeP23 === false, 'readiness', 'execution receipts stay outside truth');
  check(body.readiness?.runtimeArtifactClosure === 'blocked-separate-owner-evidence', 'readiness', 'separate artifact gate');
  return errors;
}

test('P23: four-flow authoritative design, source refs, versions and forty-package inventory are coherent', () => {
  assert.ok(source);
  assert.deepEqual(contractErrors(source), []);
  assertSnapshotStable(snapshot);
});
for (const id of FLOW_IDS) test(`P23 ${id}: success/duplicate/conflict/unknown/early-failure are source-linked unexecuted oracles`, () => {
  const current = source.body.flows.find(row => row.id === id);
  assert.ok(current.scenarioIds.length >= 5);
  assert.deepEqual(contractErrors(source), []);
});
const mutateScenario = (body, id, fn) => fn(scenario(body,id));
const mutations = [
  ['missing flow', b => b.flows.pop()], ['missing required SIP coverage', b => b.coverageRows[10].disposition = 'deferred'],
  ['drop single order shares', b => b.coverageRows[8].subscopes.required = []], ['add P33 milestone', b => b.milestones.push({id:'P33',packageIds:[]})],
  ['missing package', b => b.acceptancePackages.pop()], ['package cycle', b => b.acceptancePackages[0].dependsOn = ['P23-1']],
  ['bypass P23 artifact gate', b => b.acceptancePackages.find(p => p.id === 'P24-1').dependsOn = ['P23-4']],
  ['bypass P24 semantic packages', b => b.acceptancePackages.find(p => p.id === 'P25-1').dependsOn = ['P24-6']],
  ['joint gate lacks own package dependencies', b => b.acceptancePackages.find(p => p.id === 'P25-5').dependsOn = PACKAGE_IDS.filter(id => id.startsWith('P24-'))],
  ['P31 omits business milestone coverage', b => b.milestones.find(m => m.id === 'P31').dependsOn = ['P30']],
  ['unknown source pointer', b => b.flows[0].sourceRefs[0].pointer = '/missing'], ['unsafe binding path', b => b.flows[0].bindings[0].file = '../other.json'],
  ['wrong binding schema', b => b.flows[0].bindings[0].bindingSchemaVersion = 'truthsrc.saga-binding/v9'],
  ['wrong definition version', b => b.flows[0].bindings[0].versions.version = 'v1'], ['wrong runtime version', b => b.flows[2].bindings[1].versions.runtimeVersion = 2],
  ['wrong codec', b => b.flows[0].bindings[0].codec.version = 'forged'], ['missing inheritance', b => b.inheritedDecisions.pop()],
  ['policy marked enforced', b => b.resolutions[2].enforcementVerified = true], ['public source permission', b => b.authorization.publicSourceWritesAuthorized = true],
  ['missing supersession', b => b.resolutions[2].supersedes = []], ['misordered catch-up policy', b => resolution(b,'I0-S05-sip-clock').missed = 'drop'],
  ['debit skipped period', b => resolution(b,'I0-S05-sip-clock').pausedDue = 'catch-up-all'], ['drop old backlog', b => resolution(b,'I0-S05-sip-clock').backlog = 'delete'],
  ['attempt identity', b => resolution(b,'I0-S06-sip-occurrence').attemptInIdentity = true], ['wall-clock identity', b => resolution(b,'I0-S06-sip-occurrence').processingTimeInIdentity = true],
  ['rebind backlog revision', b => resolution(b,'I0-S06-sip-occurrence').backlogRevision = 'use-latest'],
  ['unknown counts failure', b => resolution(b,'I0-S07-sip-counters').uncounted = ['pending','skipped']],
  ['three failure pause', b => resolution(b,'I0-S07-sip-counters').automaticThreeFailurePause = true],
  ['success resets failures', b => resolution(b,'I0-S07-sip-counters').successResetsFailure = true],
  ['early TA rejection count', b => resolution(b,'I0-S07-sip-counters').failureEvidence[2] = 'TARejected'],
  ['customer creates refund', b => resolution(b,'ROADMAP-D-refund-entry-authority').customerMayCreate = true],
  ['two refund start owners', b => resolution(b,'ROADMAP-D-refund-entry-authority').startOwner = 'direct-and-pipeline'],
  ['refund without payment', b => resolution(b,'ROADMAP-D-refund-entry-authority').prerequisites.shift()],
  ['refund new amount', b => resolution(b,'ROADMAP-D-refund-entry-authority').amount = 'caller-amount'],
  ['external bank mock', b => resolution(b,'ROADMAP-D-sip-funding-path').externalBankMockAuthorized = true],
  ['lossy exact Money', b => resolution(b,'I0-S11-financial-rules').binaryFloat = true], ['implicit rounding', b => resolution(b,'I0-S11-financial-rules').implicitRounding = true],
  ['wrong currency policy', b => resolution(b,'I0-S11-financial-rules').currency = 'USD'],
  ['payment double start', b => flow(b,'payment').identity.directSagaSubscriberEnabled = true],
  ['wrong early result target', b => flow(b,'payment').completion.destination = 'first-account'],
  ['early result requires order commit', b => flow(b,'payment').completion.requiresOrderCommitForEveryKind = true],
  ['TA accepted as success', b => flow(b,'ta').completion.acceptedIsSuccess = true], ['TA unknown refund', b => flow(b,'ta').completion.unknownAuthorizesRefund = true],
  ['TA unknown new request', b => flow(b,'ta').identity.newRequestOnUnknown = true],
  ['fabricated handler binding', b => flow(b,'refund').identity.systemInjectedBindingImplemented = true],
  ['unknown new refund', b => flow(b,'refund').identity.unknownStartsNewRefund = true],
  ['payment compensation as refund', b => flow(b,'refund').completion.paymentCompensationIsRefund = true],
  ['SIP falsely migrated', b => flow(b,'sip').existingDeclarations.migrated = true], ['SIP fake runtime schema', b => flow(b,'sip').stateContract.runtimeStateSchemaImplemented = true],
  ['SIP missing guards', b => flow(b,'sip').guardObligations = []], ['SIP missing folds', b => flow(b,'sip').foldObligations = []],
  ['missing scenario', b => b.scenarios.pop()], ['scenario run claim', b => b.scenarios[0].execution = 'passed'],
  ['scenario lacks forbidden effects', b => b.scenarios[0].forbiddenEffects = []],
  ['payment as customer success oracle', b => mutateScenario(b,'PAY-success',s => s.expectedObservations.find(x => x.subject==='purchase').expected='succeeded')],
  ['duplicate creation treated as safe new start', b => mutateScenario(b,'PAY-repeat',s => s.expectedObservations.find(x => x.subject==='creation-repeat').expected='start-again')],
  ['SIP unknown terminal count', b => mutateScenario(b,'SIP-unknown-recover',s => s.expectedObservations[0].expected=1)],
  ['SIP paused due debited', b => mutateScenario(b,'SIP-pause-backlog',s => s.expectedObservations.find(x=>x.subject==='slot20').expected='deducted')],
  ['SIP old backlog reversion', b => mutateScenario(b,'SIP-revision-backlog',s => s.expectedObservations[0].expected=['revision-2','200.00'])],
  ['SIP early refund failure count', b => mutateScenario(b,'SIP-refund-count-boundary',s => s.expectedObservations[0].expected=1)],
  ['SIP catchup order reversed', b => mutateScenario(b,'SIP-catch-up-order',s => s.expectedObservations[0].expected=[20,10])],
  ['runtime certification', b => b.readiness.runnable = true], ['P23 complete despite artifacts', b => b.readiness.completeP23 = true],
  ['tool hash in truth', b => b.toolDigest = 'forged'], ['claimed all V1 bindings', b => b.bindingInventory[0].completeV1Coverage = true],
];
for (const [label, mutate] of mutations) test(`P23 mutation rejects: ${label}`, () => {
  const candidate = structuredClone(source);
  mutate(candidate.body);
  assert.ok(contractErrors(candidate).length > 0, label);
});
