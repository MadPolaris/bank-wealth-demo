// TEST ONLY: an isolated, read-only inspector invocation over owned synthetic
// receipts. Its response is not a workshop/report CLI contract or real evidence.
// No --experimental-test-module-mocks, global loader or production source edit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureRuntimeFile } from '../tools/truthsrc-evidence.mjs';
import { configureTestAdmission, admissionObservation } from './bank-workshop-admission-loader.mjs';

async function main() {
  assert.equal(process.argv.length, 4, 'test helper requires explicit owned root and admission file');
  const [root, admissionFile] = process.argv.slice(2);
  configureTestAdmission(root, admissionFile);
  const options = JSON.parse(readFileSync(0, 'utf8'));
  const allowed = ['evidence', 'buildEvidence', 'round', 'lease', 'runtimeVersion', 'runtimeSupply', 'preparedRuntime', 'legacy'];
  assert.ok(Object.keys(options).every(key => allowed.includes(key)), 'not a workshop/report CLI');
  for (const key of ['evidence', 'buildEvidence', 'round', 'lease'])
    assert.ok(typeof options[key] === 'string' && resolve(options[key]) === options[key] && options[key].startsWith(root + '/'),
      'inspector paths must belong to this test fixture');
  if (typeof options.runtimeSupply === 'string') assert.ok(options.runtimeSupply.startsWith(root + '/'));

  const inspectorUrl = new URL('../tools/bank-workshop-verification.mjs', import.meta.url);
  const loaderUrl = new URL('./bank-workshop-admission-loader.mjs', import.meta.url);
  // Source is bytes, NOT JSON. No transforms of the real inspector or its helpers.
  const sources = [inspectorUrl, loaderUrl, new URL(import.meta.url)].map(url => {
    const file = fileURLToPath(url); return { file, captured: captureRuntimeFile(file, { json: false }) };
  });
  register(loaderUrl, { parentURL: import.meta.url });
  const { inspectService } = await import(inspectorUrl.href);
  let outcome;
  try { outcome = { accepted: true, inspection: await inspectService(options) }; }
  catch (error) { outcome = { accepted: false, error: { name: error.name, code: error.code ?? null, message: error.message } }; }
  for (const { file, captured } of sources)
    assert.deepEqual(captureRuntimeFile(file, { json: false }).value, captured.value, 'inspector/helper source changed');
  process.stdout.write(JSON.stringify({ schemaVersion: 'bank.workshop-inspector-test-double/v1',
    executionKind: 'test-double', fullPipelinePassed: false, ...outcome, admission: admissionObservation() }) + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
