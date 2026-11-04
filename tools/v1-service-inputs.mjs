// New P26-P32 service input entry. Historical *-376 inputs and v1-inputs.mjs
// are never rewritten. Importing this module performs no output writes.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, TOOL_ROOT, filesUnder, sha256 } from './truth-source.mjs';
import { V1_TREE, bankApplicationRequest, bankDomainRequest } from './v1-inputs.mjs';

const load = file => import(pathToFileURL(join(TOOL_ROOT, file)).href);
const { profileFor } = await load('lib/products/registry.mjs');
const { compileProductSet } = await load('lib/products/compile.mjs');
const { readProductRequest } = await load('lib/products/cli.mjs');
export const BANK_SERVICE_ARTIFACT = 'bank-service';
export const BANK_SERVICE_PROFILE = 'scala-cqrs-play-service@1';
const serviceVersions = new Map([['artifact-contract', '3'], ['saga-host-contract', '2'], ['effect-host-contract', '2']]);
const treeInventory = () => filesUnder(V1_TREE).map(file => [file, sha256(readFileSync(file))]);

export function bankServiceRequest() {
  // Explicit fresh-domain injection is intentional. MAIN-owned v1-inputs.mjs must
  // accept this option while making its no-argument historical API read the frozen
  // payment-376 request. At author-619 time the existing function ignores the
  // option and derives the same current tree; equality below detects a stale base.
  // DO NOT filter BankService out of an artifact document while leaving it in its
  // canonical document: both old and new profiles require complete source coverage.
  const domainRequest = bankDomainRequest();
  const request = structuredClone(bankApplicationRequest({ domainRequest }));
  assert.deepEqual(request.documents.find(d => d.id === 'bank-v1'), domainRequest.documents.find(d => d.id === 'bank-v1'),
    'bankApplicationRequest must honor explicit current domainRequest; historical default must not become the service entry');
  const canonical = request.documents.find(d => d.id === 'bank-v1');
  const services = canonical.value.artifactContracts.filter(a => Object.hasOwn(a.deployment, 'service'));
  assert.equal(services.length, 1, 'exactly one authored service artifact is required');
  assert.equal(services[0].id, BANK_SERVICE_ARTIFACT);
  assert.equal(services[0].artifact.id, 'BankService');
  assert.equal(services[0].status, 'selected');
  assert.equal(services[0].deployment.service.profile, BANK_SERVICE_PROFILE);
  for (const id of ['bank-payment-technical', 'bank-refund-technical', 'bank-sip-technical', 'bank-ta-technical'])
    assert.equal(canonical.value.artifactContracts.filter(a => a.id === id && !Object.hasOwn(a.deployment, 'service')).length, 1, 'historical artifact must remain: ' + id);
  for (const [aggregate, field, type, command, event] of [
    ['FundOrder', 'cashRequestSource', 'Option[BankCashOriginal]', 'RecordCashRequestSource', 'CashRequestSourceRecorded'],
    ['SipPlan', 'createIntent', 'Option[BankSipCreateIntent]', 'RecordSipCreateIntent', 'SipCreateIntentRecorded']
  ]) {
    const row = canonical.value.aggregates.find(a => a.name === aggregate);
    assert.ok(row, 'service requires the authored aggregate ' + aggregate);
    assert.deepEqual(row.stateFields.find(f => f.name === field), { name: field, dataType: type, default: { present: false, value: null } });
    assert.ok(row.commands.some(c => c.name === command) && row.events.some(e => e.name === event), 'durable service source command/event missing');
  }

  // Preserve every document, assembly and business host binding. Only the explicit
  // artifact/host product requirements upgrade; host binding/payload schemas stay v1.
  const artifacts = request.documents.find(d => d.id === 'artifacts');
  assert.equal(artifacts.schemaVersion, 'truthsrc.artifact-binding/v2');
  artifacts.schemaVersion = artifacts.value.schemaVersion = 'truthsrc.artifact-binding/v3';
  artifacts.value.artifacts.artifacts = canonical.value.artifactContracts.map((row, i) => ({ ...structuredClone(row),
    source: { document: canonical.id, pointer: '/artifactContracts/' + i } }));
  for (const [id, version] of serviceVersions) {
    const rows = request.requirements.filter(r => r.id === id);
    assert.equal(rows.length, 1, 'one complete requirement required: ' + id);
    const before = rows[0], profile = profileFor(id, version);
    assert.ok(profile, 'public service profile prerequisite unavailable: ' + id + '@' + version);
    assert.equal(before.version, id === 'artifact-contract' ? '2' : '1', 'service derives from the original full application request, not an already-upgraded fork');
    Object.assign(before, { version, payloadSchemaVersion: profile.payloadSchemaVersion,
      capabilities: structuredClone(profile.capabilities), requires: structuredClone(profile.requires) });
  }
  for (const id of ['hosts', 'effects']) {
    const doc = request.documents.find(d => d.id === id);
    assert.equal(doc.schemaVersion, id === 'hosts' ? 'truthsrc.saga-host-binding/v1' : 'truthsrc.effect-host-binding/v1');
    assert.equal(doc.value.schemaVersion, doc.schemaVersion);
  }
  assert.ok(request.assemblies.some(a => a.id === 'sagas') && request.assemblies.some(a => a.id === 'runtime') && request.assemblies.some(a => a.id === 'execution'));
  return request;
}

export function bankServiceOptions(options, externalSourceRoots) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options), 'MAIN supplies the complete captured generator options, including existing runtime pins');
  assert.ok(Array.isArray(externalSourceRoots) && externalSourceRoots.length > 0, 'explicit external handwritten source/test mounts required; no generated-directory copies');
  for (const root of externalSourceRoots) {
    assert.ok(isAbsolute(root) && resolve(root) === root && !root.includes('\\') && !root.includes('\0'), 'canonical absolute external mount required');
    assert.ok(!root.startsWith(join(ROOT, 'target') + '/') && !root.startsWith(join(ROOT, 'dist') + '/'), 'generated artifacts cannot masquerade as handwritten mounts');
    assert.ok(existsSync(root) && lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'existing owned plain external source directory required');
  }
  assert.equal(new Set(externalSourceRoots).size, externalSourceRoots.length);
  const result = structuredClone(options);
  assert.ok(result.packages?.some(p => p.context === 'bankwealth' && p.package === 'example.bankwealth'), 'explicit package mapping required');
  result.service = { artifact: BANK_SERVICE_ARTIFACT, externalSourceRoots: [...externalSourceRoots] };
  return result;
}

function protectedInputs() {
  const rows = [];
  for (const dir of ['tree', 'compiled', 'isolation-zone', 'qualification', 'v1/formal-inputs'])
    for (const file of filesUnder(join(ROOT, dir))) rows.push([file, sha256(readFileSync(file))]);
  for (const name of ['bindings.json', 'execution-bindings.json', 'runtime-binding.json', 'wealth-bindings.json', 'wealth-execution-bindings.json', 'wealth-runtime-binding.json', 'tools/v1-inputs.mjs']) {
    const file = join(ROOT, name);
    if (existsSync(file)) rows.push([file, sha256(readFileSync(file))]);
  }
  return rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

export function writeBankServiceInputs(target, options, scope) {
  assert.ok(isAbsolute(target) && resolve(target) === target, 'explicit canonical absolute output required');
  assert.equal(dirname(target), join(ROOT, 'v1/formal-inputs'), 'only a fresh owned formal-inputs/release-* directory may be written');
  assert.match(relative(join(ROOT, 'v1/formal-inputs'), target), /^release-[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
  assert.ok(!existsSync(target), 'service input output must be exclusive and fresh');
  assert.ok(lstatSync(dirname(target)).isDirectory() && !lstatSync(dirname(target)).isSymbolicLink(), 'plain existing formal-input parent required');
  assert.ok(scope && typeof scope === 'object' && !Array.isArray(scope), 'MAIN supplies an explicit new scope receipt, not a historical pass');
  const preparedOptions = bankServiceOptions(options, options?.service?.externalSourceRoots);
  assert.deepEqual(preparedOptions, options, 'caller must explicitly select bank-service and external roots');
  const before = treeInventory(), protectedBefore = protectedInputs();
  const request = bankServiceRequest(), compiled = compileProductSet(request);
  assert.deepEqual(compiled.diagnostics, [], 'public product compiler rejected service input; no output directory created');
  assert.ok(compiled.result, 'complete service product set required');
  assert.ok(Buffer.byteLength(JSON.stringify(compiled.result)) <= 8 * 1024 * 1024, 'full product set exceeds public capacity');
  const output = new Map();
  const stage = (name, value) => {
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/u);
    assert.ok(!output.has(name), 'output path collision: ' + name);
    output.set(name, JSON.stringify(value) + '\n');
  };
  for (const document of request.documents) stage(document.id + '.json', document.value);
  stage('files.json', { schemaVersion: 'truthsrc.product-input-files/v1',
    documents: request.documents.map(d => ({ id: d.id, schemaVersion: d.schemaVersion, file: d.id + '.json' })),
    assemblies: request.assemblies, requirements: request.requirements, options: request.options });
  stage('request.json', request); stage('compiled.json', compiled.result); stage('options.json', options); stage('scope.json', scope);
  // Every target path and every protected original is checked before first mkdir/write.
  for (const name of output.keys()) assert.ok(!existsSync(join(target, name)), 'new output path is occupied');
  assert.deepEqual(treeInventory(), before, 'source changed during input derivation');
  assert.deepEqual(protectedInputs(), protectedBefore, 'protected original changed during input derivation');
  assert.ok(!existsSync(target), 'output directory raced');
  mkdirSync(target); // non-recursive exclusive directory create; an occupied path fails.
  for (const [name, text] of output) writeFileSync(join(target, name), text, { flag: 'wx' });
  const captured = readProductRequest(join(target, 'files.json'));
  assert.deepEqual(captured, request, 'public file-request capture must equal the API request');
  assert.deepEqual(compileProductSet(captured), compiled, 'public CLI/API product compilation must match');
  assert.deepEqual(treeInventory(), before);
  const after = protectedInputs().filter(([file]) => !file.startsWith(target + '/'));
  assert.deepEqual(after, protectedBefore, 'historical inputs/tree/bindings changed');
  return { status: 'complete-service-inputs-static-only', target, profile: BANK_SERVICE_PROFILE,
    artifact: BANK_SERVICE_ARTIFACT, products: compiled.result.products.length,
    canonicalSHA: sha256(JSON.stringify(request.documents.find(d => d.id === 'bank-v1').value)),
    targetFiles: [...output].map(([name, text]) => ({ file: join(target, name), sha256: sha256(text) })),
    generationRun: false, runtimeVerified: false, milestoneAccepted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.shift() !== '--historical') throw new Error('Frozen V1 source service-input adapter. Current generation uses tools/truthsrc-project.mjs; historical use requires --historical.');
  if (args.length === 1 && args[0] === '--check-service') {
    const request = bankServiceRequest(), compiled = compileProductSet(request);
    assert.deepEqual(compiled.diagnostics, []); assert.ok(compiled.result);
    console.log(JSON.stringify({ status: 'service-input-static-check-not-generation', profile: BANK_SERVICE_PROFILE,
      artifact: BANK_SERVICE_ARTIFACT, products: compiled.result.products.length, generationRun: false, runtimeVerified: false }));
  } else {
    assert.equal(args.length, 6);
    assert.equal(args[0], '--write-service'); assert.equal(args[2], '--options'); assert.equal(args[4], '--scope');
    assert.ok(isAbsolute(args[3]) && isAbsolute(args[5]), 'explicit absolute MAIN-owned options/scope files required');
    const options = JSON.parse(readFileSync(args[3], 'utf8')), scope = JSON.parse(readFileSync(args[5], 'utf8'));
    console.log(JSON.stringify(writeBankServiceInputs(args[1], options, scope)));
  }
}
