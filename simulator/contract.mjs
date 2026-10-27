import { createHash } from 'node:crypto';

export const CONTRACT_ID = 'contract.cash-purchase-v2';
export const CONFIG_SCHEMA = 'bank-wealth.mock-ta/v1';
// Operational demo limits, not product minimum/precision or financial policy.
export const MAX_STRING_BYTES = 4096;
const boundedString = (value, label) => {
  if (typeof value !== 'string') throw new ContractError(`${label} must be a string`);
  if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) throw new ContractError(`${label} must be a string of at most ${MAX_STRING_BYTES} UTF-8 bytes`, 'INPUT_CAPACITY');
};

export class ContractError extends Error {
  constructor(message, code = 'INVALID_CONTRACT') {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

export function exactObject(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ContractError(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key))) {
    throw new ContractError(`${label} has missing or unexpected fields`);
  }
  if (keys.some((key) => { const property = Object.getOwnPropertyDescriptor(value, key); return !property.enumerable || !Object.hasOwn(property, 'value'); })) {
    throw new ContractError(`${label} must contain enumerable data properties, not accessors`);
  }
}

export function nonemptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new ContractError(`${label} must be a nonempty string`);
  boundedString(value, label);
}

export function safeTick(value, label = 'business tick') {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new ContractError(`${label} must be a nonnegative safe integer`);
  }
}

function dataArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new ContractError(`${label} must be a plain dense data array`);
  }
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !Object.hasOwn(property, 'value')) {
      throw new ContractError(`${label} must be a plain dense data array`);
    }
  }
}

// Canonical JSON is also the on-disk spelling. Never call input-owned methods,
// iterators, species or toJSON; read only validated own data descriptors.
export function canonicalJson(value) {
  const ancestors = new WeakSet();
  function encode(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new ContractError('Canonical JSON numbers must be safe integers');
      return String(value);
    }
    if (!value || typeof value !== 'object') throw new ContractError('Value is not canonical JSON data');
    if (ancestors.has(value)) throw new ContractError('Canonical JSON cannot contain cycles');
    ancestors.add(value);
    try {
      const entries = [];
      if (Array.isArray(value)) {
        dataArray(value, 'Canonical JSON array');
        for (let index = 0; index < value.length; index++) {
          entries.push(encode(Object.getOwnPropertyDescriptor(value, String(index)).value));
        }
        return `[${entries.join(',')}]`;
      }
      const keys = Object.keys(value).sort();
      exactObject(value, [], keys, 'Canonical JSON object');
      for (const key of keys) {
        entries.push(`${JSON.stringify(key)}:${encode(Object.getOwnPropertyDescriptor(value, key).value)}`);
      }
      return `{${entries.join(',')}}`;
    } finally { ancestors.delete(value); }
  }
  return encode(value);
}

export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const clone = (value) => JSON.parse(canonicalJson(value));
export function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateFixture(fixture, label) {
  exactObject(fixture, ['shares', 'nav'], [], label);
  for (const key of ['shares', 'nav']) {
    const value = fixture[key];
    boundedString(value, `${label}.${key}`);
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value)) {
      throw new ContractError(`${label}.${key} must be a positive canonical decimal string`);
    }
  }
}

export function validateMockConfiguration(configuration) {
  exactObject(configuration, ['schemaVersion', 'currency', 'feesMinorUnits', 'refundMode', 'initialBusinessTick', 'scenarios'], [], 'mockConfiguration');
  if (configuration.schemaVersion !== CONFIG_SCHEMA || configuration.currency !== 'CNY'
    || configuration.feesMinorUnits !== '0' || configuration.refundMode !== 'full-principal') {
    throw new ContractError('Unsupported MockTA schema, currency, fees or refund policy');
  }
  safeTick(configuration.initialBusinessTick, 'initialBusinessTick');
  dataArray(configuration.scenarios, 'scenarios');
  if (!configuration.scenarios.length) throw new ContractError('scenarios must be a nonempty array');
  const ids = new Set();
  for (let index = 0; index < configuration.scenarios.length; index++) {
    const scenario = Object.getOwnPropertyDescriptor(configuration.scenarios, String(index)).value;
    exactObject(scenario, ['id', 'outcome', 'delayTicks'], ['fixture', 'reason', 'delivery', 'conflictFixture'], 'scenario');
    nonemptyString(scenario.id, 'scenario.id');
    if (ids.has(scenario.id)) throw new ContractError(`Duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
    safeTick(scenario.delayTicks, `${scenario.id}.delayTicks`);
    if (!Number.isSafeInteger(configuration.initialBusinessTick + scenario.delayTicks)) throw new ContractError('Scenario deadline exceeds safe clock');
    if (!['accepted', 'confirmed', 'rejected', 'unknown'].includes(scenario.outcome)) throw new ContractError(`Unsupported outcome ${scenario.outcome}`);
    if (scenario.outcome === 'confirmed') validateFixture(scenario.fixture, `${scenario.id}.fixture`);
    else if (Object.hasOwn(scenario, 'fixture')) throw new ContractError('Only confirmed scenarios have share fixtures');
    if (scenario.outcome === 'rejected') nonemptyString(scenario.reason, `${scenario.id}.reason`);
    else if (Object.hasOwn(scenario, 'reason')) throw new ContractError('Only rejected scenarios have rejection reasons');
    if (['accepted', 'unknown'].includes(scenario.outcome) && scenario.delayTicks !== 0) throw new ContractError('Pending-only scenarios must have zero delayTicks');
    if (Object.hasOwn(scenario, 'delivery')) {
      if (scenario.outcome !== 'confirmed' || !['identical-duplicate', 'conflicting-duplicate'].includes(scenario.delivery)) {
        throw new ContractError('Duplicate delivery requires a confirmed scenario and a known delivery mode');
      }
    }
    if (scenario.delivery === 'conflicting-duplicate') {
      validateFixture(scenario.conflictFixture, `${scenario.id}.conflictFixture`);
      if (canonicalJson(scenario.fixture) === canonicalJson(scenario.conflictFixture)) throw new ContractError('conflictFixture must differ from fixture');
    } else if (Object.hasOwn(scenario, 'conflictFixture')) throw new ContractError('conflictFixture requires conflicting-duplicate delivery');
  }
  return configuration;
}

// The new truth artifact is the only authority. Older mock-ta proposals are never a fallback.
export function loadMockContract(snapshot) {
  // Validate original data before any detached projection/structuredClone can normalize
  // prototypes or invoke accessors. This loader is not a UI artifact projection.
  const artifacts = snapshot.atoms.filter(({ doc }) => doc.kind === 'note' && doc.payload?.info?.artifact?.id === CONTRACT_ID)
    .map(({ doc }) => doc.payload.info.artifact);
  if (artifacts.length !== 1 || artifacts[0].category !== 'cash-purchase-contract') {
    throw new ContractError(`Expected exactly one ${CONTRACT_ID} cash-purchase-contract artifact`, 'MISSING_CONTRACT');
  }
  if (!artifacts[0].body?.mockConfiguration) throw new ContractError(`${CONTRACT_ID}.body.mockConfiguration is missing`, 'MISSING_CONTRACT');
  const original = artifacts[0].body.mockConfiguration;
  validateMockConfiguration(original);
  const configuration = clone(original);
  return deepFreeze(configuration);
}

export function validateRequest(input, configuration) {
  const fields = ['requestId', 'orderId', 'paymentTxId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'scenario'];
  exactObject(input, [...fields, 'amount'], [], 'request');
  // Check the complete ORIGINAL fixed shape before any recursive serialization.
  // Object/array-valued string slots (including small shared DAGs) fail immediately.
  for (const key of fields) nonemptyString(input[key], key);
  if (input.investorAccountId === input.fundCollectionAccountId) throw new ContractError('Investor and fund collection accounts must differ', 'INVALID_REQUEST');
  exactObject(input.amount, ['minorUnits', 'currency'], [], 'amount');
  boundedString(input.amount.minorUnits, 'amount.minorUnits');
  if (typeof input.amount.minorUnits !== 'string' || !/^[1-9]\d*$/.test(input.amount.minorUnits)) {
    throw new ContractError('amount.minorUnits must be a positive canonical integer string', 'INVALID_REQUEST');
  }
  if (typeof input.amount.currency !== 'string' || input.amount.currency !== configuration.currency) throw new ContractError('Unsupported request currency', 'INVALID_REQUEST');
  if (!configuration.scenarios.some((scenario) => scenario.id === input.scenario)) throw new ContractError('Unknown configured scenario', 'INVALID_REQUEST');
  const request = { amount: { minorUnits: input.amount.minorUnits, currency: input.amount.currency } };
  for (const key of fields) request[key] = input[key];
  return deepFreeze(request);
}
