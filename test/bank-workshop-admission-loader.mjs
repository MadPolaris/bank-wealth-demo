// TEST ONLY. No production import, CLI option, publication or admission bypass.
// register() loads a separate hook-thread instance; the child configures the
// main-thread instance, which is the replacement module's exact resolved URL.
import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRuntimeFile, safePath } from '../tools/truthsrc-evidence.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const INSPECTOR = new URL('../tools/bank-workshop-verification.mjs', import.meta.url).href;
const ADMISSION = new URL('../tools/truthsrc-runtime-admission.mjs', import.meta.url).href;
let fixture;
let calls = 0, unchangedChecks = 0;

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (context.parentURL === INSPECTOR && specifier === './truthsrc-runtime-admission.mjs' && result.url === ADMISSION)
    return { url: import.meta.url, shortCircuit: true };
  return result;
}

export function configureTestAdmission(root, file) {
  assert.equal(fixture, undefined, 'one synthetic fixture per inspector child');
  assert.equal(dirname(root), TEST_ROOT, 'only direct owned test temporaries are admitted');
  assert.match(basename(root), /^bank-workshop-test-[A-Za-z0-9]+$/);
  safePath(root, 'directory');
  const marker = captureRuntimeFile(join(root, 'test-fixture.json'), { json: true }).value;
  assert.deepEqual(marker, { schemaVersion: 'bank.workshop-test-fixture/v1', executionKind: 'test-double' });
  assert.equal(file, join(root, 'target/synthetic-build/test-admission.json'));
  const captured = captureRuntimeFile(file, { json: false });
  const descriptor = JSON.parse(captured.value.toString('utf8'));
  assert.equal(descriptor.schemaVersion, 'bank.workshop-test-admission/v1');
  assert.equal(descriptor.executionKind, 'test-double');
  assert.equal(descriptor.buildEvidence, dirname(file));
  assert.equal(descriptor.before?.testDouble, true);
  fixture = { file, bytes: captured.value, descriptor };
}

export function admissionObservation() { return { calls, unchangedChecks }; }

export async function admitRuntimeBuild(buildEvidence) {
  assert.ok(fixture, 'synthetic admission is available only in the configured test child');
  calls++;
  assert.equal(buildEvidence, fixture.descriptor.buildEvidence, 'unexpected synthetic build selection');
  const { before, preparedRuntime } = structuredClone(fixture.descriptor);
  return { before, ...(preparedRuntime === undefined ? {} : { preparedRuntime }),
    assertUnchanged: async () => {
      const current = captureRuntimeFile(fixture.file, { json: false });
      assert.deepEqual(current.value, fixture.bytes, 'synthetic admission descriptor bytes changed');
      unchangedChecks++;
    } };
}
