import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc, emitDoc } from '../../metarch-truthsrc/lib/shared.mjs';
import { captureProject } from '../../metarch-truthsrc/lib/project/cli.mjs';
import { verifyCurrentHandwrittenMapping, verifyHandwrittenMap } from '../tools/verify-handwritten-map.mjs';
import { readHistoricalJson } from '../tools/historical-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const map = json('docs/architecture/HANDWRITTEN-SOURCE-MAP.json');
const captured = captureProject(join(root, 'truthsrc.project.json'));
const emit = doc => emitDoc({ scalars: Object.entries(doc).filter(([,v]) => v === null || typeof v !== 'object'),
  nested: doc.origin ? {origin: doc.origin} : {}, blocks: {payload: doc.payload} });

test('current handwritten map binds exact 35 relocated files to 54 actual current source references', async () => {
  const result = await verifyHandwrittenMap();
  assert.equal(result.passed, true); assert.equal(result.files, 35); assert.equal(result.references, 54);
  assert.equal(result.precision, 'file'); assert.equal(result.symbolSpanVerified, false);
  assert.equal(result.semanticMappingVerified, false); assert.equal(result.runtimeVerified, false);
});

test('old mapping, stale source, wrong source identity and truncated or expanded inventories reject', async () => {
  await assert.rejects(verifyCurrentHandwrittenMapping(captured.request, captured.sourceIndex.snapshot,
    readHistoricalJson('v1/integration/HANDWRITTEN-SOURCE-MAP.json')));
  for (const mutate of [
    value => { value.snapshot = 'sha256:' + '0'.repeat(64); },
    value => { value.document.sha256 = 'sha256:' + '0'.repeat(64); },
    value => { value.root = 'v1/handwritten/scala'; },
    value => { value.entries[0].sources[0] = 'source:bank-v1#/hostComputations/0'; },
    value => { value.entries[0].sources[0] = 'source:bank-v1#/hostComputations/99999'; },
    value => { value.entries.pop(); },
    value => { value.entries.push({...value.entries[0], file: 'unapproved.scala'}); },
    value => { delete value.files[Object.keys(value.files)[0]]; },
    value => { value.files['unapproved.scala'] = 'sha256:' + '0'.repeat(64); },
    value => { value.references[0].valueSha = 'sha256:' + '0'.repeat(64); },
  ]) {
    const changed = structuredClone(map); mutate(changed);
    await assert.rejects(verifyCurrentHandwrittenMapping(captured.request, captured.sourceIndex.snapshot, changed));
  }
});

test('reversing only the declared evidence locators exactly reconstructs the original sixteen author files', () => {
  const relocations = json('docs/V1-REFERENCE-RELOCATIONS.json');
  assert.equal(relocations.revision, '4515b6b97d91714116b451b4e930dc81e112e528');
  assert.equal(relocations.files.length, 16);
  assert.equal(relocations.files.reduce((sum, file) => sum + file.changes.length, 0), 177);
  for (const entry of relocations.files) {
    const text = readFileSync(join(root, entry.file), 'utf8');
    assert.equal(hash(text), entry.after.sha256); assert.equal(Buffer.byteLength(text), entry.after.bytes);
    const doc = parseDoc(text, entry.file);
    for (const change of entry.changes) {
      assert.ok(/\/evidence\/\d+$/.test(change.pointer) || change.pointer === '/payload/info/artifact/body/readiness/acceptedRelease');
      const tokens = change.pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
      const key = tokens.pop(); let value = doc;
      for (const token of tokens) { assert.ok(Object.hasOwn(value, token)); value = value[token]; }
      assert.equal(value[key], change.to); value[key] = change.from;
    }
    const restored = emit(doc);
    assert.equal(hash(restored), entry.before.sha256); assert.equal(Buffer.byteLength(restored), entry.before.bytes);
    const original = execFileSync('git', ['--no-optional-locks', '-C', root, 'show', relocations.revision + ':' + entry.file]);
    assert.ok(Buffer.from(restored).equals(original), entry.file);
  }
});
