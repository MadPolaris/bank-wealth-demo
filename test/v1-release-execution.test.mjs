import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkExecution } from '../tools/v1-release-orchestrate.mjs';
import { parseArgs, main } from '../tools/v1-release.mjs';

const ROOT = resolve(import.meta.dirname, '..');
function fixture() {
  const root = mkdtempSync(join(ROOT, '.scratch/release-cli-test-'));
  const javaHome = join(root, 'jdk'); mkdirSync(join(javaHome, 'bin'), { recursive: true });
  for (const name of ['java', 'javac']) writeFileSync(join(javaHome, 'bin', name), 'fixture');
  const source = join(root, 'input.json'); writeFileSync(source, '{}');
  return { root, config: { schemaVersion: 'bank-v1-execution/v2', bundle: join(root, 'candidate'), workId: 'fixture', javaHome, python: process.execPath,
    sources: Object.fromEntries(['admissionFixture', 'jsCapture', 'bcCapture', 'bcRuntime', 'support', 'options', 'license'].map(k => [k, source])) } };
}

test('execution preflight is explicit and never creates candidate output', () => {
  const { config } = fixture();
  const result = checkExecution(config);
  assert.equal(result.accepted, false);
  assert.ok(result.stages.includes('runtime-js') && result.stages.includes('recovery-bc-request-before-start'));
  assert.equal(existsSync(config.bundle), false);
});

test('execution refuses unknown commands and supplied acceptance', () => {
  const { config } = fixture();
  assert.throws(() => checkExecution({ ...config, argv: ['arbitrary'] }));
  assert.throws(() => checkExecution({ ...config, accepted: true }));
  assert.throws(() => checkExecution({ ...config, workId: '../escape' }));
  assert.throws(() => checkExecution({ ...config, bundle: '/tmp/release-candidate' }));
});

test('execution will not overwrite an existing candidate', () => {
  const { config } = fixture(); mkdirSync(config.bundle);
  writeFileSync(join(config.bundle, 'keep'), 'existing');
  assert.throws(() => checkExecution(config), /already exists/);
  assert.equal(readFileSync(join(config.bundle, 'keep'), 'utf8'), 'existing');
});

test('execution CLI cannot combine legacy manifest and execution configuration', async () => {
  const { root, config } = fixture(), file = join(root, 'config.json');
  writeFileSync(file, JSON.stringify(config));
  assert.equal(parseArgs(['--check', '--execution', file]).execution, file);
  const result = await main(['--check', '--execution', file]);
  assert.equal(result.accepted, false); assert.equal(existsSync(config.bundle), false);
  await assert.rejects(main(['--run', '--manifest', file, '--execution', file]), /cannot be combined/);
});
