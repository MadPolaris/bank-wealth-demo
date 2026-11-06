import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { historicalInventory, historicalSnapshot, readHistoricalFile, HISTORICAL_REVISION } from '../tools/historical-source.mjs';
const baseline = JSON.parse(readFileSync(new URL('../docs/TRUTH-LEGACY-BASELINE.json', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const name of ['tree', 'v1/tree']) test('retired '+name+' retains every pinned file and canonical byte',()=>{
  assert.equal(HISTORICAL_REVISION, baseline.revision);
  assert.deepEqual(historicalInventory(name), baseline.trees[name].files);
  assert.equal(hash(historicalSnapshot(name).text), baseline.trees[name].canonicalSha256);
});
test('historical source reads cannot select arbitrary paths or mutable revisions',()=>{
  for(const p of ['README.md','../tree/workshop.yaml','tree/../package.json','tree/absent.yaml','v1/handwritten/scala/X.scala'])assert.throws(()=>readHistoricalFile(p),/HISTORICAL_SOURCE/);
  assert.throws(()=>historicalSnapshot('truth/bank-wealth'),/fixed tree/);
});
