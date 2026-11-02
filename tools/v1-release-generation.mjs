import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TOOL_ROOT } from './truth-source.mjs';

const load = file => import(pathToFileURL(join(TOOL_ROOT, file)).href);
const { readProductRequest } = await load('lib/products/cli.mjs');
const { compileProductSet } = await load('lib/products/compile.mjs');
const { generateProductCli } = await load('lib/products/generate-cli.mjs');
const json = file => JSON.parse(readFileSync(file, 'utf8'));

export function plainPath(path, fresh = false) {
  assert.ok(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !path.includes('\\') && !path.includes('\0'), 'canonical absolute path required');
  let ancestor = path;
  while (!existsSync(ancestor)) {
    assert.ok(!lstatSync(ancestor, { throwIfNoEntry: false }), 'dangling symlink is not a fresh path');
    ancestor = dirname(ancestor);
  }
  assert.equal(realpathSync(ancestor), ancestor, 'symlink ancestor forbidden');
  assert.ok(!lstatSync(ancestor).isSymbolicLink(), 'symlink forbidden');
  if (fresh) assert.ok(!existsSync(path), 'exclusive output already exists');
  else assert.ok(existsSync(path), 'input path missing');
  return path;
}

export function releaseTarget(target) {
  plainPath(target, true);
  const parts = relative(join(ROOT, 'target/bank-wealth-release-v1'), target).split('/');
  assert.equal(parts.length, 3, 'target must be ownedRoot/iteration/chain-app under bank release target');
  assert.ok(parts.slice(0, 2).every(p => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(p)), 'invalid owner or iteration');
  assert.ok(['js-app', 'bc-app'].includes(parts[2]), 'explicit chain target required');
  return target;
}

export function checkReleaseInputs(inputs) {
  plainPath(inputs);
  assert.equal(dirname(inputs), join(ROOT, 'v1/formal-inputs'));
  assert.match(inputs.slice(dirname(inputs).length + 1), /^release-[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
  for (const name of ['files.json', 'request.json', 'compiled.json', 'options.json']) plainPath(join(inputs, name));
  const request = readProductRequest(join(inputs, 'files.json'));
  assert.deepEqual(request, json(join(inputs, 'request.json')), 'file request differs from captured request');
  const result = compileProductSet(request);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.result);
  assert.deepEqual(result.result, json(join(inputs, 'compiled.json')), 'captured products are stale');
  const options = json(join(inputs, 'options.json'));
  assert.equal(options.service?.artifact, 'bank-service');
  assert.ok(options.service.externalSourceRoots.length > 0);
  for (const root of options.service.externalSourceRoots) {
    plainPath(root);
    assert.ok(lstatSync(root).isDirectory());
    assert.ok(!root.startsWith(join(ROOT, 'target') + '/') && !root.startsWith(join(ROOT, 'dist') + '/'), 'generated directory cannot be an external source');
  }
  return { request, products: result.result, options };
}

export function bcReleaseTasks(inputs, target) {
  releaseTarget(target);
  assert.ok(target.endsWith('/bc-app'));
  checkReleaseInputs(inputs);
  const properties = [
    '-Dcodegen.semanticProductsFile=' + join(inputs, 'compiled.json'),
    '-Dcodegen.productOptionsFile=' + join(inputs, 'options.json'),
    '-Dcodegen.productTargetProfile=scala-cqrs-play-service@1',
    '-Dcodegen.targetDir=' + target
  ];
  return ['set Compile / run / fork := true',
    'set Compile / run / javaOptions := Seq(' + properties.map(x => JSON.stringify(x)).join(', ') + ')',
    'runMain net.imadz.codegen.CodegenMain'];
}

export async function generateReleaseJs(inputs, target) {
  releaseTarget(target);
  assert.ok(target.endsWith('/js-app'));
  checkReleaseInputs(inputs);
  const args = ['--request', join(inputs, 'files.json'), '--generator', join(TOOL_ROOT, 'generators/scala-cqrs-play-service'),
    '--options-json', join(inputs, 'options.json'), '--out', target];
  const plan = await generateProductCli([...args, '--plan']);
  assert.equal(plan.applied, false);
  releaseTarget(target);
  const applied = await generateProductCli(args);
  assert.equal(applied.applied, true);
  return { target, args, plan, applied, milestoneAccepted: false };
}
