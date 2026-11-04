import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyBundleFiles, verifyDistributionSupply } from '../tools/v1-release-dist.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(files = { 'source.txt': sha('original') }) {
  const root = mkdtempSync(join(ROOT, '.scratch/dist-test-'));
  writeFileSync(join(root, 'source.txt'), 'original');
  writeFileSync(join(root, 'BUNDLE.json'), JSON.stringify({ schemaVersion: 'bank-v1-bundle/v2', files }));
  return root;
}
test('distribution inventory checks actual immutable source bytes', () => {
  const root = fixture(); verifyBundleFiles(root);
  writeFileSync(join(root, 'source.txt'), 'changed');
  assert.throws(() => verifyBundleFiles(root), /fingerprint differs/);
});
test('distribution inventory rejects traversal and symlink aliases', () => {
  assert.throws(() => verifyBundleFiles(fixture({ '../source': sha('x') })));
  const root = fixture({ alias: sha('original') }); symlinkSync(join(root, 'source.txt'), join(root, 'alias'));
  assert.throws(() => verifyBundleFiles(root));
});
test('incomplete source inventory cannot satisfy distribution closure', () => {
  const root = fixture();
  assert.throws(() => verifyDistributionSupply(root), /missing distribution component/);
  assert.equal(readFileSync(join(root, 'source.txt'), 'utf8'), 'original');
});
