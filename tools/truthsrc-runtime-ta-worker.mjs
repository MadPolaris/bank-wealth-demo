import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactObject } from '../simulator/contract.mjs';
import { absoluteWorkerPath, physicalWorkerPath, readPinnedJson, runConfiguredWorker } from './truthsrc-actor-ta-worker.mjs';

const bank = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rounds = path.join(bank, '.local', 'mock-ta');
const fixtureFile = path.join(bank, 'test', 'fixtures', 'truthsrc-actor-ta.json');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Closed names from v1-crash-recovery.mjs, not an import of its historical controller.
// Export for the runtime controller; no wildcard case owners or additional scenes.
export const RUNTIME_TA_CRASH_CASES = Object.freeze([
  'request-before-start',
  'refund-before-assembly',
  'refund-prepare',
  'refund-collection-commit',
  'refund-investor-commit',
  'payment-prepare',
  'payment-investor-commit',
  'payment-collection-commit',
  'ta-register-before-assembly',
  'ta-intent-before-submit',
  'ta-submitted-before-bank-accept',
  'ta-accepted-before-effect-reply',
  'ta-confirmed-before-ingest',
  'ta-rejected-after-ingest-before-ack',
  'payment-succeeded-before-delivery-ack',
  'refund-succeeded-before-delivery-ack',
  'sip-intent-before-create',
  'sip-create-before-append',
  'sip-append-before-next',
  'sip-before-seal',
  'sip-tick-before-catchup',
  'sip-occurrence-before-dispatch',
  'sip-terminal-before-bridge',
  'sip-terminal-ack-lost',
]);

function loadInputs() {
  const [journalPath, owned] = process.argv.slice(2);
  if (process.argv.length !== 4) fail('WORKER_PATH', 'Expected only journal absolute path and owned runtime directory');
  absoluteWorkerPath(journalPath); absoluteWorkerPath(owned);
  const roundRoot = path.dirname(owned);
  const ownerName = path.basename(owned);
  if (path.dirname(roundRoot) !== rounds || !path.basename(roundRoot).startsWith('truthsrc-runtime-')
    || path.basename(roundRoot) === 'truthsrc-runtime-'
    || (ownerName !== 'service' && !RUNTIME_TA_CRASH_CASES.some((name) => ownerName === `case-${name}`))
    || journalPath !== path.join(owned, 'ta.jsonl')) {
    fail('WORKER_PATH', 'Paths must belong to a direct runtime round and a fixed case or service owner');
  }
  const roundIdentity = physicalWorkerPath(roundRoot, 'directory');
  const ownedIdentity = physicalWorkerPath(owned, 'directory');
  const configFile = process.env.BANK_RUNTIME_TA_CONFIG;
  const configSha256 = process.env.BANK_RUNTIME_TA_CONFIG_SHA256;
  if (!configFile || !configSha256) fail('WORKER_CONFIG', 'BANK_RUNTIME_TA_CONFIG and BANK_RUNTIME_TA_CONFIG_SHA256 are required');
  absoluteWorkerPath(configFile);
  if (!configFile.startsWith(roundRoot + path.sep)) fail('WORKER_PATH', 'Configuration must be captured inside this runtime round');
  const { value: config } = readPinnedJson(configFile, configSha256);
  exactObject(config, ['schemaVersion', 'ownedRoot', 'fixture'], [], 'runtime TA configuration');
  exactObject(config.fixture, ['file', 'sha256'], [], 'runtime TA fixture reference');
  if (config.schemaVersion !== 'bank.truthsrc-runtime-ta/v1' || config.ownedRoot !== roundRoot) {
    fail('WORKER_CONFIG', 'Runtime TA schema or round ownership mismatch');
  }
  if (config.fixture.file !== fixtureFile) fail('WORKER_PATH', 'Only the fixed repository actor TA fixture is allowed');
  const captured = readPinnedJson(config.fixture.file, config.fixture.sha256);
  const fixture = captured.value;
  exactObject(fixture, ['schemaVersion', 'interpretation', 'source', 'configuration'], [], 'actor TA fixture');
  exactObject(fixture.source, ['file', 'pointer', 'sha256'], [], 'actor TA fixture provenance');
  if (typeof fixture.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fixture.source.sha256)) {
    fail('WORKER_SHA256', 'historical source digest must be a lowercase SHA-256');
  }
  if (fixture.schemaVersion !== 'bank.truthsrc-actor-ta-fixture/v1'
    || fixture.interpretation !== 'historical-frozen-test-fixture'
    || fixture.source.file !== 'tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml'
    || fixture.source.pointer !== '/payload/info/artifact/body/mockConfiguration'
    || !Array.isArray(fixture.configuration?.scenarios) || fixture.configuration.scenarios.length !== 7) {
    fail('WORKER_CONFIG', 'Expected the seven-scenario historical frozen test fixture');
  }
  physicalWorkerPath(journalPath, 'file', true);
  physicalWorkerPath(`${journalPath}.lock`, 'file', true);
  return { journalPath, owned, roundRoot, roundIdentity, ownedIdentity,
    receiptSchema: 'bank.truthsrc-runtime-ta-worker/v1',
    configSha256, fixtureSha256: captured.sha256, configuration: fixture.configuration };
}

// EOF (including loss of the JVM stdin writer) uses the same clean-close lifecycle.
// The caller must keep stdout drainable and await exit/receipt, never delete a lock.
export async function runWorker() { return runConfiguredWorker(loadInputs); }

if (process.argv[1] === fileURLToPath(import.meta.url)) await runWorker();
