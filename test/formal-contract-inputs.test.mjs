import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, TOOL_ROOT, loadBindings, assertSnapshotStable, sha256 } from '../tools/truth-source.mjs';
import {
  captureExistingRequest, compileProductSet, sourceRootProbes, prepareFormalInputs,
  captureProductRequest, assertPublicStable, publicFingerprint
} from '../tools/formal-contract-inputs.mjs';

const captured = captureExistingRequest();
const { request, snapshot } = captured;
const compilation = compileProductSet(request);
assert.deepEqual(compilation.diagnostics, []);
assert.ok(compilation.result);
const result = compilation.result;
const value = (input, id) => input.documents.find(doc => doc.id === id).value;
const product = id => result.products.find(row => row.id === id).payload;
const scratch = mkdtempSync(join(ROOT, '.scratch/formal-contract-tests-'));

function rejected(candidate, code, document, pointer) {
  const checked = compileProductSet(candidate);
  assert.equal(checked.result, null);
  assert.ok(checked.diagnostics.some(row => row.code === code && row.source.document === document && row.source.pointer === pointer),
    JSON.stringify(checked.diagnostics));
}

test('formal contracts preserve every original document and deterministic immutable results', () => {
  assert.deepEqual(result.documents.slice(0, request.documents.length), request.documents);
  assert.deepEqual(compileProductSet(request), compilation);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.products));
  assert.ok(Object.isFrozen(result.documents[0].value));
  assert.throws(() => { result.documents[0].value.workshop = 'mutated'; }, TypeError);
  assert.deepEqual(result.readiness, { level: 'static-contract-only', runnable: false, runtimeBindingVerified: false });
  assert.equal(product('saga-runtime-contract').runnable, false);
  assert.equal(product('saga-runtime-contract').runtimeBindingVerified, false);
});

test('formal assemblies equal existing complete binding values without bank union implementation', () => {
  const bindings = loadBindings();
  assert.deepEqual(value(result, 'bank-sagas'), bindings.saga);
  assert.deepEqual(value(result, 'bank-runtime'), bindings.runtime);
  assert.deepEqual(value(result, 'bank-execution'), bindings.execution);
  assert.deepEqual(value(result, 'bank-execution').sagaBindings, value(result, 'bank-sagas'));
});

test('formal assembly rows retain source order and actual document/pointer provenance', () => {
  for (const assembly of result.assemblies) {
    const field = assembly.kind === 'execution-bindings-union' ? 'pipelines' : 'sagas';
    const merged = value(result, assembly.id)[field];
    let offset = 0;
    for (const source of assembly.sources) {
      const rows = value(request, source)[field];
      rows.forEach((row, index) => {
        assert.deepEqual(merged[offset + index], row);
        assert.ok(assembly.provenance.some(p => p.targetPointer === `/${field}/${offset + index}` &&
          p.source.document === source && p.source.pointer === `/${field}/${index}`));
      });
      offset += rows.length;
    }
    assert.equal(offset, merged.length);
  }
});

test('formal products cover exact existing Saga and executable pipeline identities', () => {
  const sagas = snapshot.canonical.sagas.map(row => row.id);
  assert.deepEqual(sagas, ['external-bank-transfer', 'fund-subscription-pay', 'fund-purchase-payment-v2', 'fund-purchase-refund']);
  assert.deepEqual(product('saga-contract').sagas.map(row => row.definition.id), sagas);
  assert.deepEqual(product('execution-contract').sagas.map(row => row.definition.id), sagas);
  assert.deepEqual(product('saga-runtime-contract').sagas.map(row => row.sagaId), sagas);
  const execution = snapshot.canonical.pipelines.filter(row => row.execution).map(row => row.id);
  assert.deepEqual(execution, ['fund-purchase-cash-payment', 'fund-purchase-cash-refund', 'fund-purchase-invoke', 'sip-installment-execution']);
  assert.deepEqual(product('execution-contract').pipelines.map(row => row.id), execution);
});

test('document-only TA/design pipelines remain non-executable and legacy SIP is not V1', () => {
  const documentOnly = product('execution-contract').documentOnly;
  assert.deepEqual(documentOnly.map(row => row.id), ['fund-ta-settlement', 'sip-cross-bank-design-boundary']);
  assert.ok(documentOnly.every(row => row.reason === 'execution-not-declared'));
  assert.deepEqual(documentOnly.map(row => row.id), snapshot.canonical.pipelines.filter(row => !row.execution).map(row => row.id));
  assert.ok(!product('execution-contract').pipelines.some(row => row.id === 'sip-local-cash-v1'));
});

test('template transport and actual public CLI preserve full input values and products', () => {
  const prepared = prepareFormalInputs(join(scratch, 'package'));
  assert.deepEqual(captureProductRequest(join(prepared.target, 'files.json')).request, request);
  assert.deepEqual(prepared.compilation, compilation);
  assert.equal(readFileSync(join(prepared.target, 'canonical.json'), 'utf8'), snapshot.text);
  assert.deepEqual(JSON.parse(readFileSync(join(prepared.target, 'semantic-products.json'), 'utf8')), result);
  assert.equal(prepared.receipt.cli.status, 0);
  assert.equal(prepared.receipt.cli.apiResultEqual, true);
  assert.equal(prepared.receipt.completeFourFlowApplicationInput, false);
  assert.equal(prepared.receipt.consumption.continuingFreezeRequested, false);
  assert.deepEqual(prepared.receipt.publicSourceBefore, prepared.receipt.publicSourceAfter);
});

test('existing public CLI output is refused without overwriting previous evidence', () => {
  const file = join(scratch, 'package/semantic-products.json');
  const before = sha256(readFileSync(file));
  const cli = spawnSync(process.execPath, [join(TOOL_ROOT, 'bin/truthsrc.js'), 'compile-products',
    '--request', join(scratch, 'package/files.json'), '--out', file], { encoding: 'utf8', timeout: 120000 });
  writeFileSync(join(scratch, 'overwrite-refused.stdout.log'), cli.stdout || '', { flag: 'wx' });
  writeFileSync(join(scratch, 'overwrite-refused.stderr.log'), cli.stderr || '', { flag: 'wx' });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /EEXIST|already exists/);
  assert.equal(sha256(readFileSync(file)), before);
});

for (const [label, out] of [
  ['outside bank scratch', join(ROOT, 'formal-inputs/forbidden-output')],
  ['relative target', 'relative-output'],
  ['existing target', scratch],
  ['normalized alias', `${scratch}/../alias-output`]
]) test(`formal input transport refuses ${label}`, () => {
  const before = publicFingerprint();
  assert.throws(() => prepareFormalInputs(out), /--out/);
  assert.deepEqual(publicFingerprint(), before);
});

test('formal input transport refuses a symlink parent without following it', () => {
  symlinkSync(scratch, join(scratch, 'alias'));
  const out = join(scratch, 'alias/new-package');
  assert.throws(() => prepareFormalInputs(out), /symlink/);
  assert.equal(existsSync(join(scratch, 'new-package')), false);
});

const mutations = [
  ['duplicate binding', 'PRODUCT_ASSEMBLY_DUPLICATE', 'saga-wealth', '/sagas/2', r => value(r, 'saga-wealth').sagas.push(structuredClone(value(r, 'saga-wealth').sagas[0]))],
  ['forward assembly', 'PRODUCT_ASSEMBLY_SOURCE', 'request', '/assemblies/0', r => { r.assemblies[0].sources[0] = 'bank-runtime'; }],
  ['runtime target', 'PRODUCT_ASSEMBLY_TARGET', 'runtime-wealth', '/target', r => { value(r, 'runtime-wealth').target.runtime = 'wrong-runtime'; }],
  ['nested Saga conflict', 'PRODUCT_ASSEMBLY_NESTED', 'execution-base', '/sagaBindings', r => { value(r, 'execution-base').sagaBindings.sagas.pop(); }],
  ['runtime codec version', 'RUNTIME_CODEC_MISMATCH', 'bank-runtime', '/sagas/2/argsCodec/version', r => { value(r, 'runtime-wealth').sagas[0].argsCodec.version = 'wrong-codec'; }],
  ['canonical role mismatch', 'PRODUCT_ROLE', 'request', '', r => {
    r.documents.push({ ...structuredClone(r.documents[0]), id: 'different-canonical' });
    r.requirements[1].inputRoles.canonical = 'different-canonical';
  }],
  ['missing prerequisite', 'PRODUCT_DEPENDENCY', 'request', '/requirements/0', r => { r.requirements = r.requirements.filter(row => row.id !== 'saga-contract'); }],
  ['wrong capability', 'PRODUCT_CAPABILITY', 'request', '/requirements/0', r => { r.requirements[0].capabilities[0].version = '99'; }]
];
for (const [label, code, document, pointer, mutate] of mutations) test(`formal contract mutation rejects ${label}`, () => {
  assert.deepEqual(compileProductSet(request).diagnostics, []);
  const candidate = structuredClone(request);
  mutate(candidate);
  rejected(candidate, code, document, pointer);
});

test('formal Saga checker rejects omission of actual payment command amount binding', () => {
  const candidate = structuredClone(request);
  const saga = candidate.documents[0].value.sagas.find(row => row.id === 'fund-purchase-payment-v2');
  const bindings = saga.payload.steps[0].phases.prepare.bindings;
  assert.ok(bindings.some(row => row.slot === 'amount'));
  saga.payload.steps[0].phases.prepare.bindings = bindings.filter(row => row.slot !== 'amount');
  rejected(candidate, 'SAGA_COVERAGE', 'bank-canonical', '/sagas/2/payload/steps/0/phases/prepare/bindings');
});

const probes = sourceRootProbes(snapshot);
test('real bank artifact is preserved at a resolvable canonical note source', () => {
  assert.equal(probes.artifact.id, 'contract.cash-purchase-v2');
  assert.equal(probes.artifact.authoredStatus, 'demo-proposal');
  assert.equal(probes.artifact.treeSource.file, 'tree/inbox/refining/question-rf-cash-purchase-v2-contract-0.yaml');
  const positive = compileProductSet(probes.positive);
  assert.deepEqual(positive.diagnostics, []);
  assert.equal(positive.result.products[0].id, 'reference-layout');
});

test('public artifact contract rejects absent root instead of lifting refining prose', () => {
  assert.equal(Object.hasOwn(snapshot.canonical, 'artifactContracts'), false);
  rejected(probes.missingRoot, 'PRODUCT_SHAPE', 'bank-canonical', '/artifactContracts');
});

test('public reference source rejects nonexistent formal artifact root pointer', () => {
  rejected(probes.missingPointer, 'PRODUCT_SOURCE', 'bank-canonical', '/artifactContracts/0');
});

test('all captured bank/public sources remain unchanged after the full test session', () => {
  assertSnapshotStable(snapshot);
  assertPublicStable();
  for (const row of captured.sources) assert.equal(sha256(readFileSync(row.file)), row.sha256, row.file);
});
