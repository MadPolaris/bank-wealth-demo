import { canonicalJson, clone, deepFreeze, digest, exactObject, nonemptyString, safeTick, validateMockConfiguration, validateRequest } from './contract.mjs';
import { attachCleanupError, Journal, JournalError } from './journal.mjs';

export class ConflictError extends Error {
  constructor(requestId) {
    super(`Request ${requestId} already exists with a different payload`);
    this.name = 'ConflictError';
    this.code = 'REQUEST_CONFLICT';
    this.requestId = requestId;
  }
}

const terminal = (outcome) => outcome === 'confirmed' || outcome === 'rejected';
const scenarioFor = (configuration, request) => configuration.scenarios.find((scenario) => scenario.id === request.scenario);
const receiptId = (requestId, stage) => `mock-ta-receipt-${digest(canonicalJson(['receipt', requestId, stage]))}`;
const reference = (requestId) => `mock-ta-${digest(canonicalJson(['ta-reference', requestId]))}`;

function makeReceipt(request, outcome, tick, scenario) {
  const stage = terminal(outcome) ? 'final' : outcome;
  const receipt = { receiptId: receiptId(request.requestId, stage), requestId: request.requestId,
    orderId: request.orderId, paymentTxId: request.paymentTxId, taReference: reference(request.requestId),
    investorAccountId: request.investorAccountId, fundCollectionAccountId: request.fundCollectionAccountId,
    fundCode: request.fundCode, amount: request.amount, outcome, businessTick: tick };
  if (outcome === 'confirmed') receipt.shares = { fundCode: request.fundCode, ...scenario.fixture };
  if (outcome === 'rejected') receipt.reason = scenario.reason;
  return deepFreeze(receipt);
}

function initialEvent(state, request, configuration) {
  const scenario = scenarioFor(configuration, request);
  const dueTick = terminal(scenario.outcome) ? state.tick + scenario.delayTicks : null;
  if (dueTick !== null) safeTick(dueTick, 'request deadline');
  const receipts = [makeReceipt(request, 'accepted', state.tick, scenario)];
  if (scenario.outcome === 'unknown') receipts.push(makeReceipt(request, 'unknown', state.tick, scenario));
  if (dueTick === state.tick) receipts.push(makeReceipt(request, scenario.outcome, state.tick, scenario));
  return { kind: 'RequestSubmitted', tick: state.tick, request, scenarioId: scenario.id, dueTick, receipts };
}

function advanceEvent(state, tick, configuration) {
  safeTick(tick);
  if (tick < state.tick) throw new JournalError('Business clock cannot roll back');
  const receipts = [];
  // Lexical ID order, independent of locale and request submission order.
  for (const [, entry] of [...state.requests].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (entry.dueTick !== null && entry.dueTick <= tick && !entry.receipts.some((receipt) => terminal(receipt.outcome))) {
      const scenario = scenarioFor(configuration, entry.request);
      receipts.push(makeReceipt(entry.request, scenario.outcome, tick, scenario));
    }
  }
  return { kind: 'ClockAdvanced', fromTick: state.tick, tick, receipts };
}

// Replay recalculates each decision and checks the entire event, including all correlation,
// scenario/deadline/receipt bodies. A clock operation is one record, not partial receipt events.
function fold(state, event, configuration) {
  let expected;
  if (event?.kind === 'RequestSubmitted') {
    exactObject(event, ['kind', 'tick', 'request', 'scenarioId', 'dueTick', 'receipts'], [], 'submit event');
    const request = validateRequest(event.request, configuration);
    if (state.requests.has(request.requestId)) throw new JournalError('Journal contains a duplicate request submission');
    expected = initialEvent(state, request, configuration);
  } else if (event?.kind === 'ClockAdvanced') {
    exactObject(event, ['kind', 'fromTick', 'tick', 'receipts'], [], 'clock event');
    expected = advanceEvent(state, event.tick, configuration);
  } else throw new JournalError('Unknown MockTA journal event');
  if (canonicalJson(event) !== canonicalJson(expected)) throw new JournalError('MockTA event violates canonical state transition');
  const requests = new Map(state.requests);
  if (event.kind === 'RequestSubmitted') {
    requests.set(event.request.requestId, deepFreeze({ request: clone(event.request), submittedTick: event.tick,
      dueTick: event.dueTick, receipts: clone(event.receipts) }));
  } else {
    for (const receipt of event.receipts) {
      const entry = requests.get(receipt.requestId);
      requests.set(receipt.requestId, deepFreeze({ ...entry, receipts: [...entry.receipts, clone(receipt)] }));
    }
  }
  return { tick: event.tick, requests };
}

// Duplicate *deliveries* never overwrite or add a second canonical final receipt.
function deliveries(receipts, state, configuration) {
  const result = [], conflicts = [];
  for (const receipt of receipts) {
    result.push(receipt);
    if (receipt.outcome !== 'confirmed') continue;
    const scenario = scenarioFor(configuration, state.requests.get(receipt.requestId).request);
    if (scenario.delivery === 'identical-duplicate') result.push(receipt);
    if (scenario.delivery === 'conflicting-duplicate') {
      const conflictingReceipt = { ...receipt, shares: { fundCode: receipt.fundCode, ...scenario.conflictFixture } };
      result.push(conflictingReceipt);
      conflicts.push({ code: 'RECEIPT_CONFLICT', receiptId: receipt.receiptId,
        canonicalReceipt: receipt, conflictingReceipt });
    }
  }
  return { receipts: result, conflicts };
}

/** Local external-TA simulation only. No account balances, payment/refund execution,
 * FundOrder commands, HTTP host, Saga or Monarch. Recovery is close/reopen of this journal. */
export class PersistentMockTACore {
  #configuration;
  #journal;
  #state;

  constructor({ configuration, journalPath, journalIO } = {}) {
    validateMockConfiguration(configuration);
    this.#configuration = deepFreeze(clone(configuration));
    nonemptyString(journalPath, 'journalPath');
    const configDigest = digest(canonicalJson(this.#configuration));
    const initialization = { kind: 'Initialized', tick: this.#configuration.initialBusinessTick };
    let recovered = { tick: this.#configuration.initialBusinessTick, requests: new Map() };
    this.#journal = new Journal({ journalPath, configDigest, ...(journalIO ? { io: journalIO } : {}),
      validateReplay: (events) => {
        if (!events.length) return;
        if (canonicalJson(events[0]) !== canonicalJson(initialization)) throw new JournalError('Journal must start with the configured initialization');
        for (const event of events.slice(1)) recovered = fold(recovered, event, this.#configuration);
      },
    });
    // Fully validated replay is exposed only after Journal's successful reopen fsync.
    this.#state = recovered;
    try {
      if (!this.#journal.events.length) this.#journal.append(initialization);
    } catch (error) {
      try { this.#journal.close(); } catch (cleanup) { attachCleanupError(error, cleanup); }
      throw error;
    }
  }

  get configuration() { return this.#configuration; }
  get businessTick() {
    this.#journal.assertUsable();
    const tick = this.#state.tick;
    this.#journal.assertUsable();
    return tick;
  }
  get journalPath() { return this.#journal.path; }

  #commit(event) {
    const next = fold(this.#state, event, this.#configuration);
    this.#journal.append(event);
    this.#state = next;
  }

  submit(input) {
    this.#journal.assertUsable();
    const request = validateRequest(input, this.#configuration);
    const existing = this.#state.requests.get(request.requestId);
    if (existing) {
      if (canonicalJson(existing.request) !== canonicalJson(request)) throw new ConflictError(request.requestId);
      return this.query(request.requestId);
    }
    this.#commit(initialEvent(this.#state, request, this.#configuration));
    return this.query(request.requestId);
  }

  query(requestId) {
    this.#journal.assertUsable();
    nonemptyString(requestId, 'requestId');
    const entry = this.#state.requests.get(requestId);
    if (!entry) {
      const response = { requestId, businessTick: this.#state.tick, status: 'unknown', pending: true,
      observation: { outcome: 'unknown', reason: 'REQUEST_NOT_FOUND', businessTick: this.#state.tick },
        receipts: [], canonicalReceipts: [], conflicts: [] };
      this.#journal.assertUsable();
      return response;
    }
    const last = entry.receipts.at(-1);
    const response = clone({ requestId, request: entry.request, businessTick: this.#state.tick,
      submittedTick: entry.submittedTick, dueTick: entry.dueTick, status: last.outcome,
      pending: !terminal(last.outcome), canonicalReceipts: entry.receipts,
      ...deliveries(entry.receipts, this.#state, this.#configuration) });
    this.#journal.assertUsable();
    return response;
  }

  advanceBusinessClock(ticks) {
    this.#journal.assertUsable();
    safeTick(ticks, 'ticks');
    const tick = this.#state.tick + ticks;
    safeTick(tick, 'advanced business tick');
    const event = advanceEvent(this.#state, tick, this.#configuration);
    // A zero advance with no due decisions is a read-only no-op, not another journal record.
    if (ticks !== 0 || event.receipts.length) this.#commit(event);
    const response = clone({ businessTick: this.#state.tick, canonicalReceipts: event.receipts,
      ...deliveries(event.receipts, this.#state, this.#configuration),
      pendingRequestIds: [...this.#state.requests].filter(([, entry]) => !entry.receipts.some((receipt) => terminal(receipt.outcome)))
        .map(([requestId]) => requestId).sort() });
    this.#journal.assertUsable();
    return response;
  }

  advanceClock(ticks) { return this.advanceBusinessClock(ticks); }
  close() { this.#journal.close(); }
}
