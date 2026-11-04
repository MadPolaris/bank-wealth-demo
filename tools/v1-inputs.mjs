import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, TOOL_ROOT, filesUnder, sha256 } from './truth-source.mjs';

const load = file => import(pathToFileURL(join(TOOL_ROOT, file)).href);
const { compileTree } = await load('lib/compile.mjs');
const { canonicalType } = await load('lib/domain-products/values.mjs');
const { compileReferences } = await load('lib/domain-products/references.mjs');
const { deriveDecisions } = await load('lib/domain-products/decision.mjs');
const { deriveDependencies } = await load('lib/domain-products/dependencies.mjs');
const { deriveFolds } = await load('lib/domain-products/folds.mjs');
const { deriveExternalEvents } = await load('lib/domain-products/external-events.mjs');
const { profileFor } = await load('lib/products/registry.mjs');
const { readProductRequest } = await load('lib/products/cli.mjs');
const { compileProductSet } = await load('lib/products/compile.mjs');
const { deriveProductDesigns } = await load('lib/products/designs.mjs');

export const V1_TREE = join(ROOT, 'v1/tree');
const context = 'bankwealth';
const reference = (kind, id, owner = []) => ({ context, kind, owner, id });
const source = pointer => ({ document: 'bank-v1', pointer });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Author the bank's explicit qualified source index; type syntax is resolved only by the public API.
export function bankLayout(canonical) {
  const declarations = [];
  const add = (ref, pointer, valueType = null, dependencies = []) => {
    const row = { ref, valueType, source: source(pointer), dependencies };
    declarations.push(row);
    return row;
  };
  for (const [i, type] of canonical.valueObjects.entries()) add(reference('type', type.name), '/valueObjects/' + i);
  const layout = { contexts: [context], declarations };
  const refs = type => type.form === 'nominal' ? [type.ref] : type.form === 'record' ? type.members : ['optional', 'sequence'].includes(type.form) ? refs(type.element) : type.form === 'map' ? [...refs(type.key), ...refs(type.value)] : [];
  const unique = items => items.filter((r, i) => items.findIndex(x => same(r, x)) === i);
  const valueType = (raw, pointer) => canonicalType(raw, context, layout, source(pointer));
  for (const [i, type] of canonical.valueObjects.entries()) {
    const declaration = declarations.find(d => d.ref.kind === 'type' && d.ref.id === type.name);
    if (type.dataType) {
      declaration.valueType = valueType(type.dataType, declaration.source.pointer);
      declaration.dependencies = refs(declaration.valueType);
    } else {
      const members = type.fields.map(field => reference('member', field.name, [type.name]));
      declaration.valueType = { form: 'record', members };
      declaration.dependencies = members;
      type.fields.forEach((field, fi) => {
        const pointer = '/valueObjects/' + i + '/fields/' + fi, t = valueType(field.dataType, pointer);
        add(members[fi], pointer, t, unique([declaration.ref, ...refs(t)]));
      });
    }
  }
  for (const [i, aggregate] of canonical.aggregates.entries()) {
    assert.equal(aggregate.context, context);
    const parent = reference('aggregate', aggregate.name);
    add(parent, '/aggregates/' + i);
    aggregate.stateFields.forEach((field, fi) => {
      const pointer = '/aggregates/' + i + '/stateFields/' + fi, t = valueType(field.dataType, pointer);
      add(reference('state-field', field.name, [aggregate.name]), pointer, t, unique([parent, ...refs(t)]));
    });
    for (const [family, kind, slots, slotKind] of [['commands', 'command', 'parameters', 'parameter'], ['events', 'event', 'payloads', 'event-slot']]) {
      aggregate[family].forEach((row, ci) => {
        const pointer = '/aggregates/' + i + '/' + family + '/' + ci, ref = reference(kind, row.name, [aggregate.name]);
        add(ref, pointer, null, [parent]);
        row[slots].forEach((field, si) => {
          const p = pointer + '/' + slots + '/' + si, t = valueType(field.dataType, p);
          add(reference(slotKind, field.name, [aggregate.name, row.name]), p, t, unique([ref, ...refs(t)]));
        });
      });
    }
  }
  for (const [family, kind, identity] of [['ports', 'port', 'name'], ['sagas', 'saga', 'id'], ['pipelines', 'pipeline', 'id']]) {
    for (const [i, row] of (canonical[family] ?? []).entries()) add(reference(kind, row[identity]), '/' + family + '/' + i);
  }
  for (const [i, row] of (canonical.artifactContracts ?? []).entries()) add(row.artifact, '/artifactContracts/' + i);
  for (const [i, row] of (canonical.productDesigns ?? []).entries()) add(row.artifact, '/productDesigns/' + i);
  return layout;
}

export function bankExactTypes(canonical) {
  const member = (name, id) => reference('member', id, [name]);
  return ['Money', 'AmountDecimal'].map(name => {
    const i = canonical.valueObjects.findIndex(t => t.name === name);
    assert.ok(i >= 0);
    const t = canonical.valueObjects[i], unit = name === 'Money';
    return { domain: reference('type', name), version: t.version, source: source('/valueObjects/' + i), form: unit ? 'unit-decimal' : 'decimal',
      precision: 38, scale: 2, amountMember: unit ? member(name, 'amount') : null, unitMember: unit ? member(name, 'currency') : null, units: unit ? ['CNY'] : [] };
  });
}

export function deriveBankDomainInputs() {
  const text = compileTree(V1_TREE), value = JSON.parse(text);
  const canonical = { id: 'bank-v1', schemaVersion: 'truthsrc/v1', value };
  const layout = bankLayout(value);
  const references = { id: 'references', schemaVersion: 'truthsrc.reference-binding/v1', value: { schemaVersion: 'truthsrc.reference-binding/v1', layout } };
  compileReferences(references, canonical, [canonical, references]);
  const types = bankExactTypes(value);
  const decisions = deriveDecisions(canonical, layout, { types }, '4');
  const externalEvents = deriveExternalEvents(canonical, layout, 'truthsrc.domain-external-event-binding/v2');
  const dependencies = deriveDependencies(canonical, layout, decisions, types, externalEvents, 'truthsrc.domain-dependency-binding/v6');
  const folds = deriveFolds(canonical, layout, dependencies, types, 'truthsrc.domain-fold-binding/v6');
  return { text, canonical, layout, types, decisions, externalEvents, dependencies, folds };
}

export function bankExactCodecs(canonical) {
  return ['Money', 'AmountDecimal'].map((name, i) => {
    const unit = name === 'Money', version = canonical.valueObjects.find(t => t.name === name).version;
    const carrier = suffix => ({ ref: reference('type', name + suffix), version,
      amountMember: unit ? reference('member', 'minorUnits', [name + suffix]) : null,
      unitMember: unit ? reference('member', 'currency', [name + suffix]) : null });
    return { domain: reference('type', name), domainVersion: version, id: 'bank-v1-' + name + '-minor-units', version: '1',
      format: 'minor-units-text', wire: carrier('Wire'), po: carrier('PO'), source: { document: 'codecs', pointer: '/codecs/' + i } };
  });
}

// This complete domain-only request is a prerequisite, not one of the four application/joint requests.
export function bankDomainRequest() {
  const inputs = deriveBankDomainInputs();
  const document = (id, schemaVersion, key, value) => ({ id, schemaVersion, value: { schemaVersion, [key]: value } });
  const documents = [inputs.canonical,
    document('references', 'truthsrc.reference-binding/v1', 'layout', inputs.layout),
    document('types', 'truthsrc.exact-type-binding/v1', 'types', inputs.types),
    document('codecs', 'truthsrc.exact-codec-binding/v1', 'codecs', bankExactCodecs(inputs.canonical.value)),
    document('decisions', 'truthsrc.domain-semantic-binding/v4', 'decisions', inputs.decisions),
    document('dependencies', 'truthsrc.domain-dependency-binding/v6', 'dependencies', inputs.dependencies),
    document('folds', 'truthsrc.domain-fold-binding/v6', 'folds', inputs.folds),
    document('external', 'truthsrc.domain-external-event-binding/v2', 'externalEvents', inputs.externalEvents)];
  const requirements = [
    ['reference-layout', '1', 'referenceBinding', 'references'], ['exact-value-types', '1', 'exactTypeBinding', 'types'],
    ['exact-value-codecs', '1', 'exactCodecBinding', 'codecs'], ['domain-decision', '4', 'semanticBinding', 'decisions'],
    ['domain-dependencies', '6', 'dependencyBinding', 'dependencies'], ['domain-folds', '6', 'foldBinding', 'folds'],
    ['domain-external-events', '2', 'externalEventBinding', 'external']
  ].map(([id, version, role, document]) => {
    const p = profileFor(id, version);
    return { id, version, payloadSchemaVersion: p.payloadSchemaVersion, capabilities: p.capabilities, requires: p.requires,
      inputRoles: { canonical: 'bank-v1', [role]: document } };
  });
  return { schemaVersion: 'truthsrc.product-compilation/v1', documents, assemblies: [], requirements, options: {} };
}

export function writeBankDomainInputs(target) {
  assert.ok(!existsSync(target), 'domain input output must be a fresh owned directory');
  const before = filesUnder(V1_TREE).map(file => [file, sha256(readFileSync(file))]);
  const request = bankDomainRequest(), compilation = compileProductSet(request);
  assert.deepEqual(compilation.diagnostics, []);
  assert.ok(compilation.result);
  mkdirSync(target, { recursive: true });
  const write = (name, value) => writeFileSync(join(target, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  for (const document of request.documents) write(document.id + '.json', document.value);
  const files = { schemaVersion: 'truthsrc.product-input-files/v1',
    documents: request.documents.map(({ id, schemaVersion }) => ({ id, schemaVersion, file: id + '.json' })),
    assemblies: [], requirements: request.requirements, options: request.options };
  write('files.json', files);
  const captured = readProductRequest(join(target, 'files.json'));
  assert.deepEqual(captured, request);
  assert.deepEqual(compileProductSet(captured), compilation);
  write('request.json', captured);
  write('compiled.json', compilation.result);
  write('options.json', { packages: [{ context, package: 'example.bankwealth' }], verificationCases: [] });
  const after = filesUnder(V1_TREE).map(file => [file, sha256(readFileSync(file))]);
  assert.deepEqual(after, before);
  return { status: 'complete-domain-prerequisite-not-application-joint', target, products: compilation.result.products.length,
    requestBytes: Buffer.byteLength(JSON.stringify(request)), applicationRequests: 0, runtimeVerified: false };
}

export function bankApplicationRequest({ domainRequest, historical = false } = {}) {
  if (!domainRequest) {
    assert.equal(historical, true, 'Frozen request requires explicit historical:true; current input comes from root truthsrc.project.json');
    return JSON.parse(readFileSync(join(ROOT, 'v1/formal-inputs/payment-376/request.json'), 'utf8'));
  }
  const request = structuredClone(domainRequest), canonical = request.documents[0];
  const sources = [['payment', 'payment-authored-165', ['sagas', 'runtime', 'execution']],
    ['refund', 'refund-authored-282', ['sagas', 'runtime', 'execution']],
    ['sip', 'sip-authored-307', ['execution']], ['ta', 'ta-authored-297', ['execution']]];
  for (const [flow, directory, names] of sources) for (const name of names) {
    const value = JSON.parse(readFileSync(join(ROOT, 'v1/formal-inputs', directory, name + '.json'), 'utf8'));
    request.documents.push({ id: flow + '-' + name, schemaVersion: value.schemaVersion, value });
  }
  request.assemblies = [
    { id: 'sagas', kind: 'saga-bindings-union', sources: ['payment-sagas', 'refund-sagas'] },
    { id: 'runtime', kind: 'runtime-bindings-union', sources: ['payment-runtime', 'refund-runtime'] },
    { id: 'execution', kind: 'execution-bindings-union', sources: ['payment-execution', 'refund-execution', 'sip-execution', 'ta-execution'], sagaBinding: 'sagas' },
  ];
  for (const [id, schemaVersion, key, family] of [
    ['hosts', 'truthsrc.saga-host-binding/v1', 'hosts', 'sagaHosts'],
    ['artifacts', 'truthsrc.artifact-binding/v2', 'artifacts', 'artifactContracts'],
    ['effects', 'truthsrc.effect-host-binding/v1', 'effects', 'effectHosts'],
  ]) {
    const rows = canonical.value[family].map((value, i) => ({ ...value, source: { document: canonical.id, pointer: '/' + family + '/' + i } }));
    request.documents.push({ id, schemaVersion, value: { schemaVersion, [key]: { [id === 'effects' ? 'hosts' : key]: rows } } });
  }
  const layout = request.documents.find(d => d.id === 'references').value.layout;
  request.documents.push({ id: 'designs', schemaVersion: 'truthsrc.product-design-binding/v1', value: {
    schemaVersion: 'truthsrc.product-design-binding/v1', designs: deriveProductDesigns(canonical, layout) } });
  for (const [id, version, roles] of [
    ['saga-contract', '1', { sagaBinding: 'sagas' }], ['saga-runtime-contract', '1', { sagaBinding: 'sagas', runtimeBinding: 'runtime' }],
    ['execution-contract', '1', { sagaBinding: 'sagas', executionBinding: 'execution' }], ['artifact-contract', '2', { artifactBinding: 'artifacts' }],
    ['saga-host-contract', '1', { hostBinding: 'hosts' }], ['effect-host-contract', '1', { effectBinding: 'effects' }], ['product-design', '1', { designBinding: 'designs' }],
  ]) {
    const p = profileFor(id, version);
    request.requirements.push({ id, version, payloadSchemaVersion: p.payloadSchemaVersion, capabilities: p.capabilities, requires: p.requires,
      inputRoles: { canonical: canonical.id, ...roles } });
  }
  return request;
}

export function writeBankApplicationInputs(target, scope, options) {
  assert.ok(!existsSync(target), 'application request needs a fresh owned directory');
  const before = filesUnder(V1_TREE).map(file => [file, sha256(readFileSync(file))]);
  const request = bankApplicationRequest({ historical: true }), compiled = compileProductSet(request);
  assert.deepEqual(compiled.diagnostics, []);
  const text = JSON.stringify(compiled.result) + '\n';
  assert.ok(Buffer.byteLength(text) <= 8 * 1024 * 1024, 'complete compact product set exceeds public capacity');
  mkdirSync(target, { recursive: true });
  const write = (name, value) => writeFileSync(join(target, name), JSON.stringify(value) + '\n', { flag: 'wx' });
  for (const d of request.documents) write(d.id + '.json', d.value);
  write('files.json', { schemaVersion: 'truthsrc.product-input-files/v1', documents: request.documents.map(d => ({ id: d.id, schemaVersion: d.schemaVersion, file: d.id + '.json' })),
    assemblies: request.assemblies, requirements: request.requirements, options: request.options });
  assert.deepEqual(readProductRequest(join(target, 'files.json')), request);
  write('request.json', request); write('compiled.json', compiled.result); write('options.json', options); write('scope.json', scope);
  assert.deepEqual(filesUnder(V1_TREE).map(file => [file, sha256(readFileSync(file))]), before);
  return { target, products: compiled.result.products.length, canonicalSHA: sha256(JSON.stringify(request.documents[0].value)), runtimeVerified: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.shift() !== '--historical') throw new Error('Frozen V1 source adapter. Current generation uses tools/truthsrc-project.mjs; historical use requires --historical.');
  if (args.length === 2 && args[0] === '--write-domain') {
    console.log(JSON.stringify(writeBankDomainInputs(args[1])));
  } else {
    assert.deepEqual(args, ['--check-domain']);
    const result = deriveBankDomainInputs();
    console.log(JSON.stringify({ status: 'domain-input-derived-not-full-request', canonicalSha256: sha256(result.text),
      declarations: result.layout.declarations.length, exactTypes: result.types.length, commands: result.decisions.commands.length,
      events: result.dependencies.events.length, defaults: result.folds.defaults.length, hosts: result.dependencies.hosts.length,
      fullRequest: false, runtimeVerified: false }));
  }
}
