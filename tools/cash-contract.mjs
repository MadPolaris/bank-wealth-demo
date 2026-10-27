import { isDeepStrictEqual } from 'node:util';
import { declarationIndex, loadBindings } from './truth-source.mjs';
import { extractArtifacts } from './artifacts.mjs';
import { validateMockConfiguration } from '../simulator/contract.mjs';

export const CASH_RESULT_KINDS = Object.freeze(['succeeded', 'rejected-before-effects', 'compensated', 'recovery-required', 'outcome-unknown']);
const suffixes = ['Succeeded', 'RejectedBeforeEffects', 'Compensated', 'RecoveryRequired', 'OutcomeUnknown'];
const refundCommands = ['RecordFundRefundCompleted', 'RecordFundPurchaseRefundRejected', 'RecordFundPurchaseRefundCompensated', 'RecordFundPurchaseRefundRecoveryRequired', 'RecordFundPurchaseRefundOutcomeUnknown'];
const refundEvents = ['FundRefundCompleted', 'FundPurchaseRefundRejected', 'FundPurchaseRefundCompensated', 'FundPurchaseRefundRecoveryRequired', 'FundPurchaseRefundOutcomeUnknownObserved'];
const txPin = { slot: 'txid', ref: 'txid', type: 'TxId' };
const condition = (command, rule) => command?.guards?.find((guard) => (guard.ref || guard.ruleId) === rule);
const binding = (event, slot) => event?.bindings?.find((row) => row.slot === slot)?.expr;
const outcomePolicy = { recoverableKinds: CASH_RESULT_KINDS.slice(3), terminalKinds: CASH_RESULT_KINDS.slice(0, 3), recoverableToTerminal: 'authenticated-reconciliation', sameFinal: 'succeed-empty', conflictingFinal: 'reject', nonterminalAfterFinal: 'reject' };
const paymentAssociation = 'state.cashPaymentFinalResults.keys.forall(_ == param.txid) && state.cashPaymentResults.keys.forall(_ == param.txid) && state.reservedSubscriptions.keys.forall(_ == param.txid) && state.committedSubscriptions.keys.forall(_ == param.txid) && state.compensatedSubscriptions.keys.forall(_ == param.txid)';
const taCorrelation = 'param.taRequestId.nonEmpty && param.taRequestId == state.taRequestId && param.taReference.nonEmpty && (state.taReference.isEmpty || state.taReference == param.taReference) && param.fundCode == state.fundCode && param.currency == state.amount.currency && param.currency == "CNY" && state.taRequests.get(param.taRequestId).contains(param.paymentTxId)';
const refundPhase = 'state.status == "REFUND_REQUESTED" && state.taStatus == "TA_REJECTED" && (state.refundOutcome == "requested" || state.refundOutcome == "recovery-required" || state.refundOutcome == "outcome-unknown")';

// Declaration audit, not a replacement decision/fold engine and not runtime certification.
// Compare actual owned slots, pins, guards and folds, not counts of narrative keywords.
export function validateCashContract(snapshot, artifacts = extractArtifacts(snapshot)) {
  const errors = [], notices = [];
  const check = (ok, where, message) => { if (!ok) errors.push(`${where}: ${message}`); };
  const equal = (actual, expected, where) => check(isDeepStrictEqual(actual, expected), where, 'declaration differs from the cash contract');
  const index = declarationIndex(snapshot.canonical);
  const get = (kind, id) => index.get(`${kind}:${id}`);
  const command = (name) => get('command', `FundOrder.${name}`);
  const event = (name) => get('event', `FundOrder.${name}`);
  const fold = (e, row) => check(e?.foldAssignments?.some((actual) => isDeepStrictEqual(actual, row)), e?.name || 'missing event', `missing exact fold ${JSON.stringify(row)}`);
  const folds = (e, rows) => equal(e?.foldAssignments, rows, `${e?.name || 'missing event'}/complete fold contract`);
  const guardOrder = (c, rules) => equal(c?.guards?.map((guard) => guard.ref || guard.ruleId), rules, `${c?.name || 'missing command'}/complete authored guard order`);
  const rejectWhen = (c, rule, when) => {
    const guard = condition(c, rule);
    equal(guard?.when, when, `${c?.name}/${rule}/predicate`);
    check(guard?.onFail === 'reject' || guard?.onFail === undefined, `${c?.name}/${rule}`, 'required rejecting guard cannot become empty success');
  };
  const cond = (c, rule, expected) => {
    const g = condition(c, rule);
    equal(g?.cond, expected, `${c?.name || 'missing command'}/${rule}`);
    check(g?.kind === 'invariantRef' && (g.onFail === undefined || g.onFail === 'reject'), `${c?.name}/${rule}`, 'must be a rejecting existing invariantRef guard');
  };
  const empty = (c, rule, map, key) => {
    const g = condition(c, rule);
    equal(g?.when, { form: 'map-absent', map, key }, `${c?.name}/${rule}`);
    equal(g?.onFail, 'succeed-empty', `${c?.name}/${rule}/onFail`);
  };
  const before = (c, first, second) => {
    const guards = c?.guards || [], at = (r) => guards.findIndex((g) => (g.ref || g.ruleId) === r);
    check(at(first) >= 0 && at(second) > at(first), c?.name || 'missing command', `${first} must precede ${second}`);
  };
  const fieldRef = (ref, kind, where) => { const value = get(kind, ref); check(!!value, where, `unresolved ${kind}:${ref}`); return value; };
  const matches = artifacts.filter((a) => a.id === 'contract.cash-purchase-v2');
  equal(matches.length, 1, 'cash artifact count');
  const body = matches[0]?.body || {};
  try { validateMockConfiguration(body.mockConfiguration); }
  catch (error) { errors.push(`cash mockConfiguration: ${error.message}`); }
  for (const [id, outcome, delivery] of [['accepted', 'accepted'], ['confirmed', 'confirmed'], ['rejected', 'rejected'], ['delayed', 'confirmed'], ['unknown', 'unknown'], ['duplicate-identical', 'confirmed', 'identical-duplicate'], ['duplicate-conflicting', 'confirmed', 'conflicting-duplicate']]) {
    const scenario = Array.isArray(body.mockConfiguration?.scenarios) ? body.mockConfiguration.scenarios.find((row) => row?.id === id) : undefined;
    check(scenario?.outcome === outcome && scenario?.delivery === delivery, `cash mockConfiguration/${id}`, 'missing actual required simulator scenario');
    if (id === 'delayed') check(scenario?.delayTicks > 0, `cash mockConfiguration/${id}`, 'delay must defer final confirmation');
  }
  equal(body.demoPolicy, { currency: 'CNY', feesMinorUnits: '0', refundMode: 'full-principal', clock: 'manual' }, 'cash demo policy');
  const payBridge = body.paymentResultBridge || {};
  const refundBridge = body.sourceRuntimeBoundaries?.refundResultReconciliation || {};
  const taBridge = body.sourceRuntimeBoundaries?.taTypedSlotBridge || {};
  const sagas = snapshot.canonical.sagas || [];
  const technical = snapshot.bindings?.saga || loadBindings().saga;

  // Resolve nested references against this canonical snapshot, including bridge-only
  // source slots that strict Saga compile never sees. A correct-looking string is
  // not sufficient when its actual event/state/command slot has disappeared.
  function auditNestedRefs(value, path) {
    if (!value || typeof value !== 'object') return;
    for (const key of ['sourceEventFieldRef', 'eventFieldRef']) if (value[key]) {
      const slot = fieldRef(value[key], 'event-field', `${path}/${key}`);
      if (value.dataType) equal(slot?.dataType, value.dataType, `${path}/${key}/actual type`);
    }
    for (const key of ['stateFieldRef', 'stateIdentityRef']) if (value[key]) {
      if (value[key] === 'FundOrder.id') check(get('aggregate', 'FundOrder')?.identifier?.name === 'id', `${path}/${key}`, 'actual aggregate identifier missing');
      else fieldRef(value[key], 'state-field', `${path}/${key}`);
    }
    if (value.sourceEventRef) fieldRef(value.sourceEventRef, 'event', `${path}/sourceEventRef`);
    if (value.commandRef) {
      const c = fieldRef(value.commandRef, 'command', `${path}/commandRef`);
      if (value.commandParameter) check(c?.parameters?.some((p) => p.name === value.commandParameter), path, 'bridge targets nonexistent command parameter');
      for (const p of value.parameters || []) equal(c?.parameters?.find((actual) => actual.name === p.commandParameter)?.dataType, p.dataType, `${path}/parameters/${p.commandParameter}`);
    }
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') auditNestedRefs(child, `${path}/${key}`);
  }
  auditNestedRefs(payBridge, 'paymentResultBridge');
  auditNestedRefs(refundBridge, 'sourceRuntimeBoundaries/refundResultReconciliation');
  auditNestedRefs(taBridge, 'sourceRuntimeBoundaries/taTypedSlotBridge');

  function auditSaga(id, version, source, operation, steps) {
    const saga = sagas.find((s) => s.id === id), p = saga?.payload || {};
    equal(saga?.version, version, id);
    equal(p.groups, steps.map((_, i) => ({ id: i + 1, dependsOn: i ? [i] : [] })), `${id}/barriers`);
    equal(p.steps?.length, steps.length, `${id}/steps`);
    equal(p.participants, steps.map(([participant, aggregate, resource, type]) => ({ id: participant, aggregate, resourceRef: { ref: `args:${resource}`, type } })), `${id}/participants`);
    const args = id === 'fund-purchase-payment-v2' ? ['investorAccountId', 'fundOrderId', 'fundCollectionAccountId', 'amount'] : ['fundCollectionAccountId', 'investorAccountId', 'amount'];
    equal(p.args, args.map((slot) => ({ slot, type: slot === 'amount' ? 'Money' : slot === 'fundOrderId' ? 'FundOrderId' : 'AccountId' })), `${id}/args`);
    equal(p.triggers?.length, 1, `${id}/triggers`);
    const trigger = p.triggers?.[0];
    equal(trigger?.kind, 'event', `${id}/trigger`);
    equal(trigger?.sourceRef, { aggregate: 'FundOrder', name: source }, `${id}/entry`);
    equal(trigger?.argsMapping, args.map((slot) => ({ slot, type: slot === 'amount' ? 'Money' : slot === 'fundOrderId' ? 'FundOrderId' : 'AccountId', ref: `source:${slot}` })), `${id}/source args`);
    equal(trigger?.idempotency, { ref: `source:${operation}`, type: 'OperationId', scope: 'saga-version', conflict: 'reject-different-args' }, `${id}/identity`);
    equal(p.resultKinds, [...CASH_RESULT_KINDS], `${id}/5kind`);
    equal(p.safety?.commitDecision, 'durable-before-commit', `${id}/commit decision`);
    equal(p.safety?.afterCommit, 'forward-recovery', `${id}/forward recovery`);
    const bound = technical.sagas?.find((s) => s.sagaId === id);
    equal(bound?.version, version, `${id}/binding version`);
    equal(bound?.completionMappers?.map((m) => m.kind), [...CASH_RESULT_KINDS], `${id}/supplemental completion coverage`);
    steps.forEach(([participant, aggregate, resource, type, stepId, commands, confirmations], i) => {
      const s = p.steps?.[i];
      equal([s?.id, s?.participant, s?.group], [stepId, participant, i + 1], `${id}/step/${i}`);
      ['prepare', 'commit', 'compensate'].forEach((phase, n) => {
        const d = s?.phases?.[phase], b = bound?.steps?.find((row) => row.stepId === stepId)?.phases?.[phase];
        equal(d?.kind, 'command', `${id}/${stepId}/${phase}`);
        equal(d?.commandRef, { aggregate, name: commands[n] }, `${id}/${stepId}/${phase}/command`);
        equal(d?.bindings, [txPin, { slot: 'resource', ref: `args:${resource}`, type }, ...(phase === 'prepare' ? [{ slot: 'amount', ref: 'args:amount', type: 'Money' }] : [])], `${id}/${stepId}/${phase}/exact money and resource`);
        check(!!get('command', `${aggregate}.${commands[n]}`), id, 'phase command must actually exist');
        equal(b?.confirmation?.eventRef, { aggregate, name: confirmations[n] }, `${id}/${stepId}/${phase}/receipt`);
      });
    });
    return p;
  }
  const outgoing = ['ReserveFunds', 'DeductFunds', 'ReleaseReservedFunds'];
  const outgoingEvents = ['ReserveFundsConfirmed', 'DeductFundsConfirmed', 'ReleaseReservedFundsConfirmed'];
  const incoming = ['RecordIncomingCredits', 'CommitIncomingCredits', 'CancelIncomingCredit'];
  const incomingEvents = ['RecordIncomingCreditsConfirmed', 'CommitIncomingCreditsConfirmed', 'CancelIncomingCreditConfirmed'];
  const pay = auditSaga('fund-purchase-payment-v2', 'v2', 'FundPurchaseSettlementRequested', 'operationId', [
    ['investorCreditBalance', 'CreditBalance', 'investorAccountId', 'AccountId', 'reserve-investor-funds', outgoing, outgoingEvents],
    ['collectionCreditBalance', 'CreditBalance', 'fundCollectionAccountId', 'AccountId', 'credit-fund-collection', incoming, incomingEvents],
    ['orderFundOrderTCC', 'FundOrder', 'fundOrderId', 'FundOrderId', 'reserve-cash-fund-order', ['ReserveFundSubscription', 'ConfirmFundSubscriptionPayment', 'CancelCashFundSubscription'], ['ReserveFundSubscriptionConfirmed', 'FundSubscriptionPaymentConfirmed', 'FundCashSubscriptionCanceled']],
  ]);
  const refund = auditSaga('fund-purchase-refund', 'v1', 'FundPurchaseRefundRequested', 'refundOperationId', [
    ['collectionCreditBalance', 'CreditBalance', 'fundCollectionAccountId', 'AccountId', 'debit-fund-collection', outgoing, outgoingEvents],
    ['investorCreditBalance', 'CreditBalance', 'investorAccountId', 'AccountId', 'credit-original-investor', incoming, incomingEvents],
  ]);
  fold(get('event', 'CreditBalance.ReserveFundsConfirmed'), { slot: 'accountBalance', op: 'money-apply', delta: 'event.amount', sign: -1 });
  fold(get('event', 'CreditBalance.CommitIncomingCreditsConfirmed'), { slot: 'accountBalance', op: 'money-apply', delta: 'state.incomingCredits[event.txid]', sign: 1 });
  fold(event('FundSubscriptionPaymentConfirmed'), { slot: 'committedSubscriptions', op: 'put', key: 'event.txid', value: 'state.reservedSubscriptions[event.txid]' });
  fold(event('FundSubscriptionPaymentConfirmed'), { slot: 'selectedPaymentTxId', expr: 'event.txid' });
  const request = command('RequestFundPurchaseSettlement'), requested = event('FundPurchaseSettlementRequested');
  equal(request?.parameters?.map((p) => [p.name, p.dataType]), [['operationId', 'OperationId'], ['fundOrderId', 'FundOrderId'], ['investorAccountId', 'AccountId'], ['fundCollectionAccountId', 'AccountId'], ['fundCode', 'String'], ['amount', 'Money']], 'cash request actual typed slots');
  equal(requested?.payloads?.map((p) => [p.name, p.dataType]), request?.parameters?.map((p) => [p.name, p.dataType]), 'cash source actual typed event slots');
  equal(binding(requested, 'fundOrderId'), 'param.fundOrderId', 'cash source order identity');
  cond(request, 'IR-FO-CASH-REQUEST-ID', 'param.fundOrderId == state.id && param.investorAccountId != param.fundCollectionAccountId');
  cond(request, 'IR-FO-CASH-CNY', 'param.amount.currency == "CNY"');
  equal(condition(request, 'IR-FO-RESERVE-002')?.when, { form: 'money-positive', amount: 'param.amount' }, 'cash request positive Money');
  rejectWhen(request, 'IR-FO-RESERVE-002', { form: 'money-positive', amount: 'param.amount' });
  const noRecreate = 'state.status.isEmpty && state.contractVersion.isEmpty && state.reservedSubscriptions.isEmpty && state.committedSubscriptions.isEmpty && state.compensatedSubscriptions.isEmpty';
  for (const name of ['RequestFundPurchase', 'RequestFundPurchaseSettlement']) cond(command(name), 'IR-FO-CASH-NO-RECREATE', noRecreate);
  guardOrder(request, ['IR-FO-CASH-NO-RECREATE', 'IR-FO-CASH-REQUEST-ID', 'IR-FO-RESERVE-002', 'IR-FO-CASH-CNY', 'IR-FO-CASH-FUND']);
  cond(request, 'IR-FO-CASH-FUND', 'param.fundCode.nonEmpty');
  for (const [name, expected] of [['Money', [['amount', 'Decimal'], ['currency', 'String']]], ['FundShare', [['fundCode', 'String'], ['shares', 'Decimal'], ['nav', 'Decimal']]]]) {
    equal(snapshot.canonical.valueObjects?.find((value) => value.name === name)?.fields?.map((field) => [field.name, field.dataType]), expected, `${name}/actual value-object fields`);
  }
  folds(requested, [{ slot: 'contractVersion', expr: 'literal:cash-purchase-v2' }, { slot: 'status', expr: 'literal:REQUESTED' }, ...['operationId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount'].map((slot) => ({ slot, expr: `event.${slot}` }))]);
  for (const name of ['operationId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount']) {
    equal(binding(requested, name), `param.${name}`, `cash request/${name}`);
    fold(requested, { slot: name, expr: `event.${name}` });
  }
  fold(requested, { slot: 'contractVersion', expr: 'literal:cash-purchase-v2' });

  function trusted(bridge, label) {
    equal(bridge.status, 'bridge-pending', `${label}/readiness`);
    equal(bridge.trustedHostOnly, true, `${label}/host only`);
    equal(bridge.browserMayPublish, false, `${label}/browser authority`);
    for (const [key, value] of Object.entries(outcomePolicy)) equal(bridge.terminalPolicy?.[key], value, `${label}/terminalPolicy/${key}`);
  }
  trusted(payBridge, 'payment bridge'); trusted(refundBridge, 'refund bridge');
  equal([payBridge.sagaId, payBridge.version, payBridge.sourceEventRef], ['fund-purchase-payment-v2', 'v2', 'FundOrder.FundPurchaseSettlementRequested'], 'payment bridge identity');
  equal(payBridge.automaticMutationPolicy, false, 'payment bridge automatic mutation');
  equal(payBridge.association?.evidence, 'persisted-authorized-source-event-and-durable-saga-start', 'pre-Prepare association evidence');
  equal([payBridge.association?.beforeOrderCommit, payBridge.association?.requiresCommitForEveryKind], [true, false], 'association cannot require order Commit for every outcome');
  equal(payBridge.association?.target, { sourceEventFieldRef: 'FundOrder.FundPurchaseSettlementRequested.fundOrderId', stateIdentityRef: 'FundOrder.id', sagaArg: 'fundOrderId' }, 'payment target association');
  equal(payBridge.association?.transaction, { source: 'authenticated-durable-saga-start.txid', type: 'TxId', conflict: 'reject-different-txid-for-same-source-operation' }, 'payment trusted txid');
  equal(payBridge.association?.args, pay.args?.map((a) => ({ slot: a.slot, sourceEventFieldRef: `FundOrder.FundPurchaseSettlementRequested.${a.slot}` })), 'payment bridge args actual slots');
  equal(payBridge.association?.sourceFields, ['operationId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount'].map((name) => ({ sourceEventFieldRef: `FundOrder.FundPurchaseSettlementRequested.${name}`, stateFieldRef: `FundOrder.${name}` })), 'payment immutable source fields');
  for (const row of payBridge.association?.sourceFields || []) {
    const e = fieldRef(row.sourceEventFieldRef, 'event-field', 'payment association');
    const s = fieldRef(row.stateFieldRef, 'state-field', 'payment association');
    equal(e?.dataType, s?.dataType, 'payment association type');
  }
  equal([payBridge.currentLedgerRef, payBridge.terminalLedgerRef], ['FundOrder.cashPaymentResults', 'FundOrder.cashPaymentFinalResults'], 'cash ledgers');
  for (const ledger of [payBridge.currentLedgerRef, payBridge.terminalLedgerRef, refundBridge.terminalLedgerRef]) equal(fieldRef(ledger, 'state-field', 'terminal ledger')?.dataType, 'Map[TxId, String]', ledger);
  equal(payBridge.statusPolicy?.paymentResultDoesNotSetOrderStatus, true, 'payment result conservative status');
  equal(pay.completions?.length, 5, 'cash completion coverage');
  equal(payBridge.mapping?.length, 5, 'cash bridge coverage');
  CASH_RESULT_KINDS.forEach((kind, i) => {
    const name = `RecordFundCashPayment${suffixes[i]}`, eName = `FundCashPayment${suffixes[i]}`, c = command(name), e = event(eName), terminal = i < 3;
    equal(pay.completions?.find((r) => r.kind === kind), { kind, eventRef: { aggregate: 'FundOrder', name: eName }, bindings: [txPin] }, `cash completion/${kind}`);
    equal(payBridge.mapping?.find((m) => m.resultKind === kind), { resultKind: kind, commandRef: `FundOrder.${name}`, eventRef: `FundOrder.${eName}`, commandParameter: 'txid', eventFieldRef: `FundOrder.${eName}.txid`, binding: txPin, sourceIndicators: { commandParameterOrigin: 'PROPAGATED', eventFieldOrigin: 'PROPAGATED' } }, `cash bridge actual command/event/${kind}`);
    equal(c?.parameters?.map(({ name, dataType }) => ({ name, dataType })), [{ name: 'txid', dataType: 'TxId' }], `${name}/supported TxId shape`);
    equal(c?.produces, [eName], `${name}/producer`);
    equal(e?.payloads?.map(({ name, dataType }) => ({ name, dataType })), [{ name: 'txid', dataType: 'TxId' }], `${eName}/slots`);
    equal(binding(e, 'txid'), 'param.txid', `${eName}/binding`);
    cond(c, 'IR-FO-CASH-V2-ONLY', 'state.contractVersion == "cash-purchase-v2"');
    cond(c, 'IR-FO-CASH-RESULT-ASSOCIATION', paymentAssociation);
    cond(c, 'IR-FO-CASH-RESULT-FINAL-CONFLICT', terminal ? `!state.cashPaymentFinalResults.contains(param.txid) || state.cashPaymentFinalResults(param.txid) == "${kind}"` : '!state.cashPaymentFinalResults.contains(param.txid)');
    if (terminal) {
      empty(c, 'IR-FO-CASH-RESULT-FINAL-ONCE', 'cashPaymentFinalResults', 'param.txid');
      before(c, 'IR-FO-CASH-RESULT-FINAL-CONFLICT', 'IR-FO-CASH-RESULT-FINAL-ONCE');
      fold(e, { slot: 'cashPaymentFinalResults', op: 'put', key: 'event.txid', value: `literal:${kind}` });
    } else check(!c?.guards?.some((g) => g.onFail === 'succeed-empty') && !e?.foldAssignments?.some((f) => f.slot === 'cashPaymentFinalResults'), name, 'nonterminal must not occupy terminal map or use write-once duplicate short circuit');
    if (kind === 'succeeded') cond(c, 'IR-FO-CASH-RESULT-SUCCESS-EVIDENCE', 'state.committedSubscriptions.get(param.txid).contains(state.amount)');
    if (i === 1 || i === 2) cond(c, 'IR-FO-CASH-RESULT-NO-COMMIT', 'state.committedSubscriptions.isEmpty');
    fold(e, { slot: 'cashPaymentResults', op: 'put', key: 'event.txid', value: `literal:${kind}` });
    check(!e?.foldAssignments?.some((f) => ['sagaResults', 'status', 'taStatus', 'refundOutcome', 'selectedPaymentTxId'].includes(f.slot)), eName, 'payment publication must not set lifecycle or legacy result ledger');
    guardOrder(c, ['IR-FO-CASH-V2-ONLY', 'IR-FO-CASH-RESULT-ASSOCIATION', 'IR-FO-CASH-RESULT-FINAL-CONFLICT', ...(terminal ? ['IR-FO-CASH-RESULT-FINAL-ONCE', kind === 'succeeded' ? 'IR-FO-CASH-RESULT-SUCCESS-EVIDENCE' : 'IR-FO-CASH-RESULT-NO-COMMIT'] : [])]);
    folds(e, [{ slot: 'cashPaymentResults', op: 'put', key: 'event.txid', value: `literal:${kind}` }, ...(terminal ? [{ slot: 'cashPaymentFinalResults', op: 'put', key: 'event.txid', value: `literal:${kind}` }] : [])]);
    equal(technical.sagas?.find((s) => s.sagaId === 'fund-purchase-payment-v2')?.completionMappers?.find((m) => m.kind === kind)?.mapper, `fixture.wealth.pay.${name}CompletionMapper`, `${kind}/new completion command mapper`);
  });
  const phasePrefix = 'state.contractVersion != "cash-purchase-v2" || (param.resource == state.id && state.cashPaymentFinalResults.isEmpty && state.cashPaymentResults.keys.forall(_ == param.txid) && ';
  cond(command('ReserveFundSubscription'), 'IR-FO-CASH-TCC-PREPARE', phasePrefix + 'param.amount == state.amount && (state.status == "REQUESTED" || state.status == "SUBSCRIPTION_RESERVED") && state.committedSubscriptions.isEmpty && state.compensatedSubscriptions.isEmpty && state.reservedSubscriptions.keys.forall(_ == param.txid) && (!state.reservedSubscriptions.contains(param.txid) || state.reservedSubscriptions(param.txid) == param.amount))');
  cond(command('ConfirmFundSubscriptionPayment'), 'IR-FO-CASH-TCC-COMMIT', phasePrefix + 'state.status == "SUBSCRIPTION_RESERVED" && state.reservedSubscriptions.get(param.txid).contains(state.amount) && state.committedSubscriptions.isEmpty)');
  cond(command('CancelFundSubscription'), 'IR-FO-CASH-TCC-COMPENSATE', phasePrefix + '(state.status == "REQUESTED" || state.status == "SUBSCRIPTION_RESERVED") && state.committedSubscriptions.isEmpty && state.reservedSubscriptions.keys.forall(_ == param.txid))');
  folds(event('ReserveFundSubscriptionConfirmed'), [{ slot: 'reservedSubscriptions', op: 'put', key: 'event.txid', value: 'event.amount' }, { slot: 'status', expr: 'literal:SUBSCRIPTION_RESERVED' }]);
  folds(event('FundSubscriptionPaymentConfirmed'), [{ slot: 'committedSubscriptions', op: 'put', key: 'event.txid', value: 'state.reservedSubscriptions[event.txid]' }, { slot: 'reservedSubscriptions', op: 'remove', key: 'event.txid' }, { slot: 'status', expr: 'literal:PAYMENT_SETTLED' }, { slot: 'selectedPaymentTxId', expr: 'event.txid' }]);
  const cancel = command('CancelCashFundSubscription');
  equal(cancel?.parameters?.map((field) => [field.name, field.dataType]), [['txid', 'TxId'], ['resource', 'FundOrderId']], 'cash cancel parameter contract');
  equal(cancel?.produces, ['FundCashSubscriptionCanceled'], 'cash cancel producer');
  cond(cancel, 'IR-FO-CASH-V2-ONLY', 'state.contractVersion == "cash-purchase-v2"');
  cond(cancel, 'IR-FO-CASH-CANCEL-RESOURCE', 'param.resource == state.id');
  cond(cancel, 'IR-FO-CASH-CANCEL-ASSOCIATION', 'state.cashPaymentResults.keys.forall(_ == param.txid) && state.cashPaymentFinalResults.keys.forall(_ == param.txid) && state.reservedSubscriptions.keys.forall(_ == param.txid) && state.compensatedSubscriptions.keys.forall(_ == param.txid) && (!state.reservedSubscriptions.contains(param.txid) || state.reservedSubscriptions(param.txid) == state.amount) && (!state.compensatedSubscriptions.contains(param.txid) || state.compensatedSubscriptions(param.txid) == state.amount)');
  cond(cancel, 'IR-FO-CASH-CANCEL-NO-COMMIT', 'state.committedSubscriptions.isEmpty && (state.cashPaymentFinalResults.isEmpty || state.cashPaymentFinalResults.get(param.txid).contains("compensated"))');
  empty(cancel, 'IR-FO-CASH-CANCEL-ONCE', 'compensatedSubscriptions', 'param.txid');
  cond(cancel, 'IR-FO-CASH-CANCEL-PHASE', 'state.cashPaymentFinalResults.isEmpty && (state.status == "REQUESTED" || state.status == "SUBSCRIPTION_RESERVED")');
  guardOrder(cancel, ['IR-FO-CASH-V2-ONLY', 'IR-FO-CASH-CANCEL-RESOURCE', 'IR-FO-CASH-CANCEL-ASSOCIATION', 'IR-FO-CASH-CANCEL-NO-COMMIT', 'IR-FO-CASH-CANCEL-ONCE', 'IR-FO-CASH-CANCEL-PHASE']);
  equal(event('FundCashSubscriptionCanceled')?.payloads?.map((field) => [field.name, field.dataType]), [['txid', 'TxId']], 'cash fence receipt slots');
  equal(binding(event('FundCashSubscriptionCanceled'), 'txid'), 'param.txid', 'cash fence receipt binding');
  folds(event('FundCashSubscriptionCanceled'), [{ slot: 'compensatedSubscriptions', op: 'put', key: 'event.txid', value: 'state.amount' }, { slot: 'reservedSubscriptions', op: 'remove', key: 'event.txid' }, { slot: 'status', expr: 'literal:CANCELED' }]);
  equal(pay.safety?.cancelBeforePrepare, 'empty-release-and-fence', 'cash cancellation safety');

  const taNames = ['RegisterFundTASubmission', 'RecordFundTAAccepted', 'RecordFundTAConfirmed', 'RecordFundTARejected', 'RecordFundTAUnknown'];
  for (const name of [...taNames, ...refundCommands]) {
    const c = command(name);
    cond(c, 'IR-FO-CASH-V2-ONLY', 'state.contractVersion == "cash-purchase-v2"');
    cond(c, 'IR-FO-CASH-RESOURCE', 'param.fundOrderId == state.id');
    cond(c, 'IR-FO-CASH-PAYMENT', 'param.paymentTxId == state.selectedPaymentTxId');
    cond(c, 'IR-FO-CASH-SUCCEEDED', 'state.cashPaymentFinalResults.get(param.paymentTxId).contains("succeeded")');
    rejectWhen(c, 'IR-FO-CASH-COMMITTED', { form: 'map-contains', map: 'committedSubscriptions', key: 'param.paymentTxId' });
  }
  cond(command(taNames[0]), 'IR-FO-TA-REQUEST-CONFLICT', '(state.taRequestId.isEmpty || state.taRequestId == param.taRequestId) && (!state.taRequests.contains(param.taRequestId) || state.taRequests(param.taRequestId) == param.paymentTxId)');
  before(command(taNames[0]), 'IR-FO-TA-REQUEST-CONFLICT', 'IR-FO-TA-REQUEST-ONCE');
  fold(event('FundTASubmissionRegistered'), { slot: 'taRequests', op: 'put', key: 'event.taRequestId', value: 'event.paymentTxId' });
  cond(command(taNames[0]), 'IR-FO-TA-SUBMIT-PHASE', 'state.status == "PAYMENT_SETTLED"');
  empty(command(taNames[0]), 'IR-FO-TA-REQUEST-ONCE', 'taRequests', 'param.taRequestId');
  before(command(taNames[0]), 'IR-FO-TA-REQUEST-ONCE', 'IR-FO-TA-SUBMIT-PHASE');
  const cashEvidenceRules = ['IR-FO-CASH-V2-ONLY', 'IR-FO-CASH-RESOURCE', 'IR-FO-CASH-PAYMENT', 'IR-FO-CASH-COMMITTED', 'IR-FO-CASH-SUCCEEDED'];
  cond(command(taNames[0]), 'IR-FO-TA-REQUEST-NONEMPTY', 'param.taRequestId.nonEmpty');
  guardOrder(command(taNames[0]), [...cashEvidenceRules, 'IR-FO-TA-REQUEST-NONEMPTY', 'IR-FO-TA-REQUEST-CONFLICT', 'IR-FO-TA-REQUEST-ONCE', 'IR-FO-TA-SUBMIT-PHASE']);
  const registered = event('FundTASubmissionRegistered');
  equal(command(taNames[0])?.produces, ['FundTASubmissionRegistered'], 'TA registration producer');
  equal(command(taNames[0])?.parameters?.map((field) => [field.name, field.dataType]), [['fundOrderId', 'FundOrderId'], ['paymentTxId', 'TxId'], ['taRequestId', 'String']], 'TA registration exact command types');
  equal(registered?.payloads?.map((field) => [field.name, field.dataType]), command(taNames[0])?.parameters?.map((field) => [field.name, field.dataType]), 'TA registration propagated event types');
  for (const field of command(taNames[0])?.parameters || []) equal(binding(registered, field.name), `param.${field.name}`, `TA registration/${field.name}/binding`);
  folds(registered, [{ slot: 'taRequestId', expr: 'event.taRequestId' }, { slot: 'status', expr: 'literal:TA_SUBMITTED' }, { slot: 'taStatus', expr: 'literal:TA_SUBMITTED' }, { slot: 'taRequests', op: 'put', key: 'event.taRequestId', value: 'event.paymentTxId' }]);
  const taEvents = ['FundTAAccepted', 'FundTASharesConfirmed', 'FundTARejected', 'FundTAOutcomeUnknownObserved'];
  for (const [i, name] of taNames.slice(1).entries()) {
    const c = command(name), e = event(taEvents[i]);
    equal(c?.produces, [taEvents[i]], `${name}/exact outcome event`);
    cond(c, 'IR-FO-TA-CORRELATION', taCorrelation);
    cond(c, 'IR-FO-TA-RECEIPT-CONFLICT', '!state.taReceipts.contains(param.receiptId) || state.taReceipts(param.receiptId) == param.receiptBody');
    empty(c, 'IR-FO-TA-RECEIPT-ONCE', 'taReceipts', 'param.receiptId');
    before(c, 'IR-FO-TA-CORRELATION', 'IR-FO-TA-RECEIPT-ONCE');
    before(c, 'IR-FO-TA-RECEIPT-CONFLICT', 'IR-FO-TA-RECEIPT-ONCE');
    const phaseRule = { RecordFundTAAccepted: 'IR-FO-TA-ACCEPTED-PHASE', RecordFundTAConfirmed: 'IR-FO-TA-CONFIRMED-PHASE', RecordFundTARejected: 'IR-FO-TA-REJECTED-PHASE', RecordFundTAUnknown: 'IR-FO-TA-UNKNOWN-PHASE' }[name];
    cond(c, phaseRule, name === 'RecordFundTAAccepted' ? 'state.taStatus == "TA_SUBMITTED" && state.status == "TA_SUBMITTED"' : '(state.taStatus == "TA_SUBMITTED" || state.taStatus == "TA_ACCEPTED") && (state.status == "TA_SUBMITTED" || state.status == "TA_ACCEPTED")');
    before(c, 'IR-FO-TA-RECEIPT-ONCE', phaseRule);
    for (const p of c?.parameters || []) {
      equal(binding(e, p.name), `param.${p.name}`, `${name}/${p.name} actual event binding`);
      equal(e?.payloads?.find((slot) => slot.name === p.name)?.dataType, p.dataType, `${name}/${p.name} actual typed event slot`);
    }
    fold(e, { slot: 'taReceipts', op: 'put', key: 'event.receiptId', value: 'event.receiptBody' });
    cond(c, 'IR-FO-TA-RECEIPT-NONEMPTY', 'param.receiptId.nonEmpty && param.receiptBody.nonEmpty');
    guardOrder(c, [...cashEvidenceRules, 'IR-FO-TA-CORRELATION', 'IR-FO-TA-RECEIPT-NONEMPTY', 'IR-FO-TA-RECEIPT-CONFLICT', 'IR-FO-TA-RECEIPT-ONCE', phaseRule, ...(i === 1 ? ['IR-FO-TA-SHARES'] : i === 2 ? ['IR-FO-TA-REASON'] : [])]);
    const observation = ['ACCEPTED', 'CONFIRMED', 'REJECTED', 'UNKNOWN'][i];
    const status = ['TA_ACCEPTED', 'SHARES_CONFIRMED', 'TA_REJECTED'][i];
    folds(e, [{ slot: 'taReceipts', op: 'put', key: 'event.receiptId', value: 'event.receiptBody' }, { slot: 'taReference', expr: 'event.taReference' }, { slot: 'taObservation', expr: `literal:${observation}` }, ...(status ? [{ slot: 'status', expr: `literal:${status}` }, { slot: 'taStatus', expr: `literal:${status}` }] : []), ...(i === 1 ? [{ slot: 'taConfirmedShares', expr: 'event.shares' }] : i === 2 ? [{ slot: 'taRejectionReason', expr: 'event.reason' }] : [])]);
  }
  cond(command('RecordFundTARejected'), 'IR-FO-TA-REASON', 'param.reason.nonEmpty');
  cond(command('RecordFundTAConfirmed'), 'IR-FO-TA-SHARES', 'param.shares.fundCode == state.fundCode && param.shares.shares > 0 && param.shares.nav > 0');
  check(!event('FundTAOutcomeUnknownObserved')?.foldAssignments?.some((f) => ['status', 'taStatus', 'refundOutcome'].includes(f.slot)), 'TA unknown', 'unknown cannot authorize refund or change lifecycle');
  equal([taBridge.status, taBridge.trustedHostOnly, taBridge.browserMayPublish], ['bridge-pending', true, false], 'typed TA bridge trust');
  equal(taBridge.sourceEventRef, 'FundOrder.FundTASubmissionRegistered', 'TA registered source');
  equal(taBridge.requestMapping, [['requestId', 'taRequestId', 'String'], ['orderId', 'fundOrderId', 'FundOrderId'], ['paymentTxId', 'paymentTxId', 'TxId']].map(([wireField, slot, dataType]) => ({ wireField, sourceEventFieldRef: `FundOrder.FundTASubmissionRegistered.${slot}`, dataType })), 'TA request nested source refs');
  equal(taBridge.retainedRequestFields, ['investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount'].map((field) => ({ wireField: field, stateFieldRef: `FundOrder.${field}` })), 'TA original request body association');
  equal(taBridge.receiptMapping?.length, 4, 'TA receipt bridge coverage');
  for (const [i, outcome] of ['accepted', 'confirmed', 'rejected', 'unknown'].entries()) {
    const row = taBridge.receiptMapping?.find((r) => r.outcome === outcome), name = taNames[i + 1], c = command(name);
    equal(row?.commandRef, `FundOrder.${name}`, `TA ${outcome}/target command`);
    const expected = [['fundOrderId', 'orderId', 'FundOrderId'], ['paymentTxId', 'paymentTxId', 'TxId'], ['taRequestId', 'requestId', 'String'], ['taReference', 'taReference', 'String'], ['receiptId', 'receiptId', 'String'], ['receiptBody', '$canonicalBytes', 'String'], ['fundCode', 'fundCode', 'String'], ['currency', 'amount.currency', 'String'], ...(outcome === 'confirmed' ? [['shares', 'shares', 'FundShare']] : []), ...(['rejected', 'unknown'].includes(outcome) ? [['reason', outcome === 'unknown' ? '$trustedUnknownReason' : 'reason', 'String']] : [])].map(([commandParameter, wireField, dataType]) => ({ commandParameter, wireField, dataType }));
    equal(row?.parameters, expected, `TA ${outcome}/actual typed wire slots`);
    equal(row?.parameters?.map((p) => p.commandParameter), c?.parameters?.map((p) => p.name), `TA ${outcome}/full command parameter coverage`);
    for (const mapping of row?.parameters || []) equal(c?.parameters?.find((p) => p.name === mapping.commandParameter)?.dataType, mapping.dataType, `TA ${outcome}/${mapping.commandParameter} actual slot type`);
  }

  const refundRequest = command('RequestFundPurchaseRefund'), refundRequested = event('FundPurchaseRefundRequested');
  equal(refundRequest?.parameters?.map((p) => p.name), ['fundOrderId', 'refundOperationId'], 'refund no caller amount/accounts/txid');
  cond(refundRequest, 'IR-FO-CASH-V2-ONLY', 'state.contractVersion == "cash-purchase-v2"');
  cond(refundRequest, 'IR-FO-CASH-RESOURCE', 'param.fundOrderId == state.id');
  guardOrder(refundRequest, ['IR-FO-CASH-V2-ONLY', 'IR-FO-CASH-RESOURCE', 'IR-FO-REFUND-TA-REJECTED', 'IR-FO-REFUND-PAYMENT-EVIDENCE', 'IR-FO-REFUND-NEW-OP', 'IR-FO-REFUND-ONE-REQUEST']);
  equal(binding(refundRequested, 'fundOrderId'), 'param.fundOrderId', 'refund request resource binding');
  equal(binding(refundRequested, 'refundOperationId'), 'param.refundOperationId', 'refund request new operation binding');
  folds(refundRequested, [{ slot: 'refundOperationId', expr: 'event.refundOperationId' }, { slot: 'refundTxId', expr: 'event.refundTxId' }, { slot: 'refundOutcome', expr: 'literal:requested' }, { slot: 'status', expr: 'literal:REFUND_REQUESTED' }]);
  cond(refundRequest, 'IR-FO-REFUND-TA-REJECTED', 'state.status == "TA_REJECTED" && state.taStatus == "TA_REJECTED" && state.taRejectionReason.nonEmpty');
  cond(refundRequest, 'IR-FO-REFUND-PAYMENT-EVIDENCE', 'state.committedSubscriptions.get(state.selectedPaymentTxId).contains(state.amount) && state.cashPaymentFinalResults.get(state.selectedPaymentTxId).contains("succeeded")');
  cond(refundRequest, 'IR-FO-REFUND-NEW-OP', 'param.refundOperationId != state.operationId');
  cond(refundRequest, 'IR-FO-REFUND-ONE-REQUEST', 'state.refundOutcome.isEmpty');
  for (const name of ['investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount']) equal(binding(refundRequested, name), `state.${name}`, `refund retained/${name}`);
  equal(binding(refundRequested, 'paymentTxId'), 'state.selectedPaymentTxId', 'refund original payment');
  equal(binding(refundRequested, 'refundTxId'), undefined, 'refund stable txid is handler-computed not browser binding');
  fold(refundRequested, { slot: 'refundTxId', expr: 'event.refundTxId' });
  fold(refundRequested, { slot: 'refundOutcome', expr: 'literal:requested' });
  equal([refundBridge.sagaId, refundBridge.version, refundBridge.sourceEventRef], ['fund-purchase-refund', 'v1', 'FundOrder.FundPurchaseRefundRequested'], 'refund bridge identity');
  equal([refundBridge.outcomeSource, refundBridge.genericCompletionIsSoleAuthority], ['authenticated-durable-saga-outcome', false], 'refund cannot depend on old write-once completion ledger for reconciliation');
  equal(refundBridge.identityMapping, [['fundOrderId', 'fundOrderId', 'id'], ['paymentTxId', 'paymentTxId', 'selectedPaymentTxId'], ['refundOperationId', 'refundOperationId', 'refundOperationId'], ['refundTxId', 'refundTxId', 'refundTxId']].map(([commandParameter, slot, state]) => ({ commandParameter, sourceEventFieldRef: `FundOrder.FundPurchaseRefundRequested.${slot}`, stateFieldRef: `FundOrder.${state}` })), 'refund nested identity mapping');
  equal(refundBridge.exactArgs, refund.args?.map(({ slot }) => ({ slot, sourceEventFieldRef: `FundOrder.FundPurchaseRefundRequested.${slot}`, stateFieldRef: `FundOrder.${slot}` })), 'refund original exact args bridge');
  for (const row of [...(refundBridge.identityMapping || []), ...(refundBridge.exactArgs || [])]) {
    const e = fieldRef(row.sourceEventFieldRef, 'event-field', 'refund bridge'), s = row.stateFieldRef === 'FundOrder.id' ? get('aggregate', 'FundOrder')?.identifier : fieldRef(row.stateFieldRef, 'state-field', 'refund bridge');
    equal(e?.dataType, s?.dataType, 'refund bridge identity type');
  }
  equal([refundBridge.terminalLedgerRef, refundBridge.receiptLedgerRef, refundBridge.receiptKindLedgerRef], ['FundOrder.refundFinalResults', 'FundOrder.refundResultReceipts', 'FundOrder.refundResultReceiptKinds'], 'refund actual ledgers');
  equal(refund.completions?.length, 5, 'refund completion coverage');
  equal(body.refundResultBridge?.mapping?.length, 5, 'refund supplemental event bridge coverage');
  equal(refundBridge.mapping?.length, 5, 'refund reconciliation bridge coverage');
  CASH_RESULT_KINDS.forEach((kind, i) => {
    const c = command(refundCommands[i]), e = event(refundEvents[i]), terminal = i < 3;
    const sourceEvent = `CreditBalance.result-${kind}`;
    const expected = { sourceEvent, commandRef: `FundOrder.${refundCommands[i]}`, eventRef: `FundOrder.${refundEvents[i]}`, resultKind: kind };
    equal(body.refundResultBridge?.mapping?.find((m) => m.resultKind === kind), expected, `refund actual event mapping/${kind}`);
    equal(refundBridge.mapping?.find((m) => m.resultKind === kind), { ...expected, completionEventRef: sourceEvent, source: 'authenticated-durable-saga-outcome', transactionBinding: txPin }, `refund durable mapping/${kind}`);
    equal(refund.completions?.find((c) => c.kind === kind), { kind, eventRef: { aggregate: 'CreditBalance', name: `result-${kind}` }, bindings: [txPin] }, `refund completion/${kind}`);
    fieldRef(sourceEvent, 'event', `refund/${kind}`);
    equal(c?.parameters?.map((p) => [p.name, p.dataType]), [['fundOrderId', 'FundOrderId'], ['paymentTxId', 'TxId'], ['refundOperationId', 'OperationId'], ['refundTxId', 'TxId'], ['receiptId', 'String'], ['receiptBody', 'String']], `refund/${kind}/actual result slots`);
    equal(c?.produces, [refundEvents[i]], `refund/${kind}/producer`);
    cond(c, 'IR-FO-REFUND-CORRELATION', 'param.refundOperationId == state.refundOperationId && param.refundTxId == state.refundTxId && param.refundTxId != state.selectedPaymentTxId');
    cond(c, 'IR-FO-REFUND-RECEIPT-CONFLICT', '!state.refundResultReceipts.contains(param.receiptId) || state.refundResultReceipts(param.receiptId) == param.receiptBody');
    cond(c, 'IR-FO-REFUND-RECEIPT-KIND', `!state.refundResultReceipts.contains(param.receiptId) || state.refundResultReceiptKinds.get(param.receiptId).contains("${kind}")`);
    cond(c, 'IR-FO-REFUND-FINAL-CONFLICT', terminal ? `!state.refundFinalResults.contains(param.refundTxId) || state.refundFinalResults(param.refundTxId) == "${kind}"` : '!state.refundFinalResults.contains(param.refundTxId)');
    for (const ref of ['IR-FO-REFUND-RECEIPT-CONFLICT', 'IR-FO-REFUND-RECEIPT-KIND', 'IR-FO-REFUND-FINAL-CONFLICT']) before(c, ref, 'IR-FO-REFUND-RECEIPT-ONCE');
    empty(c, 'IR-FO-REFUND-RECEIPT-ONCE', 'refundResultReceipts', 'param.receiptId');
    cond(c, 'IR-FO-REFUND-RESULT-PHASE', refundPhase);
    if (terminal) {
      empty(c, 'IR-FO-REFUND-FINAL-ONCE', 'refundFinalResults', 'param.refundTxId');
      before(c, 'IR-FO-REFUND-FINAL-CONFLICT', 'IR-FO-REFUND-FINAL-ONCE');
      before(c, 'IR-FO-REFUND-FINAL-ONCE', 'IR-FO-REFUND-RESULT-PHASE');
      fold(e, { slot: 'refundFinalResults', op: 'put', key: 'event.refundTxId', value: 'event.resultKind' });
    } else check(!e?.foldAssignments?.some((f) => ['status', 'refundFinalResults'].includes(f.slot)), refundEvents[i], 'recoverable/unknown refund must stay unresolved and not occupy final map');
    equal(e?.payloads?.map((p) => [p.name, p.dataType]), [...(c?.parameters || []).map((p) => [p.name, p.dataType]), ['resultKind', 'String']], `refund/${kind}/actual typed event result slots`);
    equal(binding(e, 'resultKind'), `literal:${kind}`, `refund/${kind}/kind`);
    for (const p of c?.parameters || []) equal(binding(e, p.name), `param.${p.name}`, `refund/${kind}/${p.name} exact event binding`);
    fold(e, { slot: 'refundResultReceipts', op: 'put', key: 'event.receiptId', value: 'event.receiptBody' });
    fold(e, { slot: 'refundResultReceiptKinds', op: 'put', key: 'event.receiptId', value: 'event.resultKind' });
    cond(c, 'IR-FO-REFUND-RECEIPT', 'param.receiptId.nonEmpty && param.receiptBody.nonEmpty');
    guardOrder(c, [...cashEvidenceRules, 'IR-FO-REFUND-CORRELATION', 'IR-FO-REFUND-RECEIPT', 'IR-FO-REFUND-RECEIPT-CONFLICT', 'IR-FO-REFUND-RECEIPT-KIND', 'IR-FO-REFUND-FINAL-CONFLICT', 'IR-FO-REFUND-RECEIPT-ONCE', ...(terminal ? ['IR-FO-REFUND-FINAL-ONCE'] : []), 'IR-FO-REFUND-RESULT-PHASE']);
    folds(e, [{ slot: 'refundResultReceipts', op: 'put', key: 'event.receiptId', value: 'event.receiptBody' }, { slot: 'refundOutcome', expr: `literal:${kind}` }, ...(terminal ? [{ slot: 'status', expr: kind === 'succeeded' ? 'literal:REFUNDED' : 'literal:REFUND_FAILED' }] : []), { slot: 'refundResultReceiptKinds', op: 'put', key: 'event.receiptId', value: 'event.resultKind' }, ...(terminal ? [{ slot: 'refundFinalResults', op: 'put', key: 'event.refundTxId', value: 'event.resultKind' }] : [])]);
  });
  notices.push('Declaration checks only: authenticated first-publication association, durable reconciliation, exact receipt codecs and mixed-guard evaluation order remain unimplemented/unverified host obligations.');
  return { errors, notices, readiness: 'declaration-only', runnable: false, runtimeBindingVerified: false, checkedResultKinds: [...CASH_RESULT_KINDS] };
}
