import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bytesSha, sourceInventory, sourceReference, verifyGeneratedProvenance, verifyHandwrittenProvenance, verifyStableGeneration } from '../tools/v1-release-provenance.mjs';

const request = { documents: [{ id: 'fixture', schemaVersion: 'truthsrc/v1', value: { artifacts: [{ version: '1', name: 'fixture' }], 'slash/key': { '~value': 7 } } }] };
const key = 'source:fixture#/artifacts/0';
async function fresh(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bank-provenance-')));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function output(root) {
  mkdirSync(root);
  writeFileSync(join(root, 'file.scala'), 'object Fixture {}\n');
  writeFileSync(join(root, 'truthsrc.ledger.json'), '{"entries":[]}\n');
  writeFileSync(join(root, 'anchors.json'), JSON.stringify({ version: 'fixture', anchors: { [key]: [{ repo: root, file: 'file.scala' }] } }));
}

test('source references carry content version, declared version and exact RFC6901 pointer', () => {
  const ref = sourceReference(request, key);
  assert.equal(ref.definitionVersion, '1');
  assert.equal(ref.sourceVersion.value, bytesSha(JSON.stringify(request.documents[0].value)));
  assert.equal(ref.valueSha, bytesSha(JSON.stringify(request.documents[0].value.artifacts[0])));
  assert.equal(sourceReference(request, 'source:fixture#/slash~1key/~0value').valueSha, bytesSha('7'));
  for (const missing of ['source:missing#/artifacts/0', 'source:fixture#/artifacts/3', 'source:fixture#/slash~2key', 'source:fixture#/__proto__', 'other'])
    assert.throws(() => sourceReference(request, missing));
});

test('stability checks every file and allows only explicit anchor repo relocation', () => fresh(root => {
  const a = join(root, 'a'), b = join(root, 'b'); output(a); output(b);
  assert.equal(verifyStableGeneration(a, b).stable, true);
  writeFileSync(join(b, 'extra.scala'), 'extra');
  assert.throws(() => verifyStableGeneration(a, b), /inventory differs/u);
}));

test('stability rejects changed source, ledger and non-repo anchor metadata', () => fresh(root => {
  for (const file of ['file.scala', 'truthsrc.ledger.json', 'anchors.json']) {
    const a = join(root, file + '-a'), b = join(root, file + '-b'); output(a); output(b);
    if (file === 'anchors.json') {
      const value = JSON.parse(readFileSync(join(b, file), 'utf8')); value.anchors[key][0].unapproved = true;
      writeFileSync(join(b, file), JSON.stringify(value));
    } else writeFileSync(join(b, file), 'changed');
    assert.throws(() => verifyStableGeneration(a, b));
  }
}));

test('build exclusions are explicit directories, not arbitrary nested names', () => fresh(root => {
  mkdirSync(join(root, 'target')); writeFileSync(join(root, 'target', 'classes'), 'build');
  mkdirSync(join(root, 'source')); mkdirSync(join(root, 'source', 'target')); writeFileSync(join(root, 'source', 'target', 'file'), 'source');
  assert.deepEqual(Object.keys(sourceInventory(root, { afterBuild: true })), ['source/target/file']);
  assert.equal(Object.keys(sourceInventory(root)).length, 2);
}));

test('generated provenance rejects stale bytes, missing or extra files and asymmetric source relations', () => fresh(async root => {
  const key2 = 'source:fixture#/slash~1key/~0value';
  const map = { schemaVersion: 'bank-handwritten-source-map/v1', entries: ['One.scala', 'Two.scala'].map(file => ({ file, relation: 'supports', rationale: 'fixture', sources: [key] })) };
  for (const e of map.entries) writeFileSync(join(root, e.file), 'object ' + e.file.split('.')[0] + ' {}\n');
  const verified = await verifyHandwrittenProvenance(root, request, map);
  const indexFile = join(root, 'anchors.json'), ledgerFile = join(root, 'truthsrc.ledger.json');
  const ledger = { entries: map.entries.map(e => ({ path: e.file, knowledgeIds: [key], fingerprint: verified.inventory[e.file] })) };
  const restore = () => { writeFileSync(indexFile, JSON.stringify(verified.anchors)); writeFileSync(ledgerFile, JSON.stringify(ledger)); };
  restore(); assert.equal((await verifyGeneratedProvenance(root, request)).oneToMany, true);
  writeFileSync(join(root, 'One.scala'), 'changed');
  await assert.rejects(verifyGeneratedProvenance(root, request));
  writeFileSync(join(root, 'One.scala'), 'object One {}\n');
  const badLedger = structuredClone(ledger); badLedger.entries[0].knowledgeIds = [key2];
  writeFileSync(ledgerFile, JSON.stringify(badLedger));
  await assert.rejects(verifyGeneratedProvenance(root, request), /relation differs/u);
  restore(); writeFileSync(join(root, 'Extra.scala'), 'extra');
  await assert.rejects(verifyGeneratedProvenance(root, request), /inventory differs/u);
}));

test('handwritten mappings verify actual file bytes independently of generated provenance', () => fresh(async root => {
  writeFileSync(join(root, 'Adapter.scala'), 'object Adapter {}\n');
  const map = { schemaVersion: 'bank-handwritten-source-map/v1', entries: [{ file: 'Adapter.scala', relation: 'supports', rationale: 'fixture adapter', sources: [key] }] };
  const result = await verifyHandwrittenProvenance(root, request, map);
  assert.equal(result.anchors.anchors[key][0].status, 'source-verified');
  assert.equal(result.entries[0].fingerprint, bytesSha(readFileSync(join(root, 'Adapter.scala'))));
  assert.equal(result.entries[0].references[0].definitionVersion, '1');
  await assert.rejects(verifyHandwrittenProvenance(root, request, { ...map, entries: [] }), /exact inventory/u);
  await assert.rejects(verifyHandwrittenProvenance(root, request, { ...map, entries: [map.entries[0], map.entries[0]] }), /duplicate/u);
  await assert.rejects(verifyHandwrittenProvenance(root, request, { ...map, entries: [{ ...map.entries[0], sources: ['source:fixture#/missing'] }] }), /pointer missing/u);
}));
