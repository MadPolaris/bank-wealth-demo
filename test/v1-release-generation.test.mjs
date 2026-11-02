import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT } from '../tools/truth-source.mjs';
import { plainPath, releaseTarget } from '../tools/v1-release-generation.mjs';

const fresh = fn => {
  const root = mkdtempSync(join(tmpdir(), 'bank-release-path-'));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('release target requires explicit owned iteration and chain', () => {
  const root = join(ROOT, 'target/bank-wealth-release-v1');
  assert.equal(releaseTarget(join(root, 'path-contract-test', 'new-iteration', 'js-app')), join(root, 'path-contract-test', 'new-iteration', 'js-app'));
  for (const value of [join(ROOT, 'v1', 'js-app'), join(root, 'owner', 'js-app'), join(root, 'owner', 'iteration', 'other'), join(root, 'owner', 'iteration', 'js-app', 'nested'), 'relative'])
    assert.throws(() => releaseTarget(value));
});

test('plain paths reject occupied outputs, traversal, NUL and missing inputs', () => fresh(root => {
  const file = join(root, 'existing'); writeFileSync(file, 'keep');
  assert.throws(() => plainPath(file, true));
  assert.throws(() => plainPath(root + '/../bad', true));
  assert.throws(() => plainPath(root + '/bad\0', true));
  assert.throws(() => plainPath(join(root, 'absent')));
}));

test('plain paths reject existing and dangling symlinks and aliased ancestors', () => fresh(root => {
  const actual = join(root, 'actual'); mkdirSync(actual);
  symlinkSync(actual, join(root, 'alias'));
  symlinkSync(join(root, 'missing'), join(root, 'dangling'));
  assert.throws(() => plainPath(join(root, 'alias')));
  assert.throws(() => plainPath(join(root, 'alias', 'fresh'), true));
  assert.throws(() => plainPath(join(root, 'dangling'), true));
}));
