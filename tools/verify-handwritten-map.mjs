import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProject } from '../../metarch-truthsrc/lib/project/cli.mjs';
import { captureProductJson } from '../../metarch-truthsrc/lib/products/cli.mjs';
import { bytesSha, sourceInventory, sourceReference, verifyHandwrittenProvenance } from './v1-release-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = join(ROOT, 'truthsrc.project.json');
const MAP = join(ROOT, 'docs/architecture/HANDWRITTEN-SOURCE-MAP.json');

export async function verifyCurrentHandwrittenMapping(request, snapshot, mapping) {
  assert.equal(mapping.schemaVersion, 'bank.current-handwritten-source-map/v1');
  assert.equal(mapping.project, 'truthsrc.project.json');
  assert.equal(mapping.root, 'handwritten/scala');
  assert.equal(mapping.snapshot, snapshot, 'handwritten map is stale for the current author snapshot');
  const canonical = request.documents.filter(document => document.id === 'bank-v1');
  assert.equal(canonical.length, 1);
  assert.deepEqual(mapping.document, { id: 'bank-v1', sha256: bytesSha(JSON.stringify(canonical[0].value)) }, 'handwritten map document changed');
  const inventory = sourceInventory(join(ROOT, mapping.root));
  assert.deepEqual(inventory, mapping.files, 'handwritten implementation bytes or file set changed');
  assert.equal(Object.keys(inventory).length, 35);
  const keys = [...new Set(mapping.entries.flatMap(entry => entry.sources))].sort();
  assert.deepEqual(mapping.references, keys.map(key => sourceReference(request, key)), 'handwritten source pointer or referenced value changed');
  const result = await verifyHandwrittenProvenance(join(ROOT, mapping.root), request,
    { schemaVersion: 'bank-handwritten-source-map/v1', entries: mapping.entries });
  return { schemaVersion: 'bank.current-handwritten-verification/v1', passed: true,
    snapshot, files: Object.keys(inventory).length, references: keys.length,
    precision: 'file', relation: 'explicit-owner-declared-not-inferred', symbolSpanVerified: false,
    semanticMappingVerified: false, runtimeVerified: false, verification: result.verification };
}

export async function verifyHandwrittenMap() {
  const captured = captureProject(PROJECT), map = captureProductJson(MAP);
  const result = await verifyCurrentHandwrittenMapping(captured.request, captured.sourceIndex.snapshot, map.value);
  assert.equal(captureProductJson(MAP).sha256, map.sha256, 'handwritten map changed during verification');
  const current = captureProject(PROJECT);
  assert.deepEqual(current.sources, captured.sources, 'project inputs changed during handwritten verification');
  return { ...result, map: { file: MAP, bytes: map.bytes, sha256: map.sha256 } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'Usage: node tools/verify-handwritten-map.mjs');
    console.log(JSON.stringify(await verifyHandwrittenMap()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
