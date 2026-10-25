import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshot, protectedFiles } from '../tools/truth-source.mjs';
import { extractArtifacts, renderProjections } from '../tools/artifacts.mjs';
import { checkProjections } from '../tools/project.mjs';

const snapshot = loadSnapshot();
test('two renders produce byte-identical projections without source mutations', () => {
  const before = protectedFiles();
  assert.deepEqual([...renderProjections(snapshot)], [...renderProjections(snapshot)]);
  assert.deepEqual(protectedFiles(), before);
});
test('checked-in derived outputs match the current truth', () => {
  assert.equal(checkProjections(snapshot).ok, true, JSON.stringify(checkProjections(snapshot)));
});
test('projection index retains exact note source pointers and proposal readiness', () => {
  const index = JSON.parse(renderProjections(snapshot).get('index.json'));
  assert.equal(index.readiness, 'design-proposal-only');
  assert.equal(index.sourceDigest, snapshot.canonicalSha256);
  for (const artifact of index.artifacts) {
    assert.equal(artifact.source.pointer, '/payload/info/artifact');
    assert.ok(snapshot.atoms.some(({ file }) => `tree/${file}` === artifact.source.file));
    assert.equal(artifact.source.line, undefined, 'do not invent line-level compiler source maps');
  }
});
test('five product planes and explicit story-map backbone are present', () => {
  const artifacts = extractArtifacts(snapshot);
  for (const category of ['ux-strategy', 'ux-scope', 'ux-structure', 'ux-skeleton', 'ux-surface']) {
    assert.ok(artifacts.some((artifact) => artifact.category === category));
  }
  const scope = artifacts.find((artifact) => artifact.category === 'ux-scope');
  assert.ok(scope.body.backbone.length >= 3);
  assert.ok(scope.body.tasks.some((task) => task.storyRef === 'PurchaseFund'));
  assert.ok(renderProjections(snapshot).get('story-map.md').includes('PurchaseFund'));
});
test('journey projection preserves membership, story, actor, action and information needs', () => {
  const structure = extractArtifacts(snapshot).find((artifact) => artifact.category === 'ux-structure');
  const rendered = renderProjections(snapshot).get('journeys.md');
  for (const journey of structure.body.journeys) {
    assert.ok(rendered.includes(journey.storyRef));
    for (const step of journey.steps) {
      assert.ok(rendered.includes(step.actor));
      assert.ok(rendered.includes(step.action));
      for (const need of step.informationNeeds) assert.ok(rendered.includes(need));
    }
  }
});
