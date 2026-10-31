import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from '../tools/truth-source.mjs';
import { checkInputs, checkedTarget, testTarget } from '../tools/v1-joint.mjs';

test('joint input check retains four complete scopes without claiming runtime execution', () => {
  const result = checkInputs();
  assert.equal(result.products, 14);
  assert.deepEqual(result.scopes.map(scope => scope.flow), ['payment', 'refund', 'ta', 'sip']);
  assert.equal(result.runtimeVerified, false);
  assert.equal(new Set(result.scopes.flatMap(scope => scope.requiredOracles)).size, 30);
});

test('joint replay refuses shared applications and nonexclusive output before spawning Java', async () => {
  assert.throws(() => checkedTarget(join(ROOT, '../ingested-app')));
  assert.throws(() => checkedTarget(join(ROOT, 'v1')));
  await assert.rejects(testTarget(join(ROOT, '../metarch-app'), join(ROOT, 'not-evidence')));
});
