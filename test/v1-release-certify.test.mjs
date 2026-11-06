import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { certifyRelease } from '../tools/v1-release-certify.mjs';
import { readHistoricalAsset } from '../tools/historical-assets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
test('missing execution cannot certify any of the original 25 requirements', async () => {
  const bundle = mkdtempSync(join(ROOT, '.scratch/certifier-test-'));
  mkdirSync(join(bundle, 'bank/v1/integration'), { recursive: true });
  writeFileSync(join(bundle, 'bank/v1/integration/ACCEPTANCE-MATRIX.md'), readHistoricalAsset('v1/integration/ACCEPTANCE-MATRIX.md'));
  const work = join(bundle, 'work'); mkdirSync(work);
  const report = await certifyRelease({ bundle, work });
  assert.equal(report.slots.length, 25);
  assert.ok(report.slots.every(s => s.status === 'blocked'));
  assert.equal(report.accepted, false);
  assert.equal(report.allOriginalRequiredProven, false);
  assert.ok(report.problems.length > 0);
});
