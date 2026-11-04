import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildInventory, verifyReleaseBuild } from '../tools/v1-release-build-evidence.mjs';

const ROOT = resolve(import.meta.dirname, '..');
function fixture(value) {
  const root = mkdtempSync(join(ROOT, '.scratch/build-evidence-test-'));
  const file = join(root, 'BUILD.json'); writeFileSync(file, JSON.stringify(value));
  return { root, file };
}

test('a supplied successful build summary is not sufficient execution evidence', () => {
  const { root, file } = fixture({ schemaVersion: 'bank-release-build/v2', target: '/tmp/arbitrary', execution: { exitCode: 0, waited: true }, tests: { count: 141 }, sourceUnchanged: true });
  assert.throws(() => verifyReleaseBuild(file, root));
});

test('an old summary cannot masquerade as the v2 executable build receipt', () => {
  const { root, file } = fixture({ schemaVersion: 'bank-cold-build/v1', status: 'passed', tests: 141 });
  assert.throws(() => verifyReleaseBuild(file, root));
});

test('generated inventory excludes only concrete build roots, not similarly named source directories', () => {
  const { root } = fixture({});
  mkdirSync(join(root, 'project/target'), { recursive: true });
  mkdirSync(join(root, 'app/target'), { recursive: true });
  writeFileSync(join(root, 'project/target/cache'), 'cache');
  writeFileSync(join(root, 'app/target/Important.scala'), 'source');
  const result = buildInventory(root, true);
  assert.ok(Object.hasOwn(result, 'app/target/Important.scala'));
  assert.equal(Object.hasOwn(result, 'project/target/cache'), false);
  assert.equal(readFileSync(join(root, 'project/target/cache'), 'utf8'), 'cache');
});
