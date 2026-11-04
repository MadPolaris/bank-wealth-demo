import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const buildDirectories = new Set(['target', 'project/target', 'project/project/target', '.bsp', '.bloop']);
export function buildInventory(root, afterBuild = false) {
  assert.equal(realpathSync(root), root, 'aliased source root');
  const result = {};
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), key = relative(root, path);
      assert.ok(!entry.isSymbolicLink(), 'source symlink');
      if (afterBuild && buildDirectories.has(key)) continue;
      if (entry.isDirectory()) walk(path);
      else { assert.ok(entry.isFile()); result[key] = sha(path); }
    }
  }
  walk(root);
  return result;
}
export function verifyReleaseBuild(file, target) {
  assert.equal(realpathSync(file), file);
  const build = json(file);
  assert.equal(build.schemaVersion, 'bank-release-build/v2');
  assert.equal(build.target, target);
  assert.equal(realpathSync(target), target);
  const parts = relative(join(ROOT, 'target/bank-wealth-release-v1'), target).split('/');
  assert.equal(parts.length, 3);
  assert.ok(parts.every(p => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(p)));
  assert.ok(['js-app', 'bc-app'].includes(parts[2]));
  const e = build.execution;
  assert.equal(e.exitCode, 0); assert.equal(e.waited, true); assert.equal(e.timedOut, false);
  assert.equal(e.cancelled, null); assert.equal(e.lingeringProcessGroup, false);
  for (const row of Object.values(e.logs)) assert.equal(sha(row.file), row.sha256, 'build log drift');
  const command = e.argv;
  assert.ok(command.includes('compile') && command.includes('Test / compile') && command.at(-1) === 'test');
  assert.equal(build.cachesInitiallyEmpty, true); assert.equal(build.bridgePrefilled, false);
  const text = readFileSync(e.logs['stdout.log'].file, 'utf8');
  const counts = [...text.matchAll(/Total number of tests run: (\d+)/g)];
  assert.equal(counts.length, 1); assert.ok(Number(counts[0][1]) > 0);
  assert.equal(Number(counts[0][1]), build.tests.count);
  assert.match(text, /Tests: succeeded \d+, failed 0, canceled 0, ignored 0, pending 0/);
  assert.ok(text.includes('All tests passed.'));
  const suites = {}; let currentSuite;
  for (const line of text.split('\n')) {
    const match = /^\[info\] ([A-Za-z0-9_]+Spec):$/.exec(line);
    if (match) { currentSuite = match[1]; suites[currentSuite] = []; }
    else if (line.startsWith('[info] - ') && currentSuite) suites[currentSuite].push(line.slice('[info] - '.length));
  }
  assert.deepEqual(suites, build.tests.suites);
  assert.equal(Object.values(suites).flat().length, build.tests.count);
  assert.deepEqual(buildInventory(target, true), build.source.generated);
  assert.deepEqual(buildInventory(join(ROOT, 'v1/handwritten')), build.source.handwritten);
  assert.deepEqual(buildInventory(join(ROOT, 'v1/test')), build.source.tests);
  const exportFile = join(target, 'target/streams/test/fullClasspath/_global/streams/export');
  assert.deepEqual(readFileSync(exportFile, 'utf8').trim().split(':'), build.classpath);
  assert.equal(new Set(build.classpath).size, build.classpath.length);
  assert.deepEqual(Object.keys(build.classpathInventory), build.classpath);
  const supply = join(dirname(ROOT), 'supply');
  for (const [path, value] of Object.entries(build.classpathInventory)) {
    assert.ok(path.startsWith(target + '/') || path.startsWith(supply + '/'), 'classpath outside release');
    if (typeof value === 'string') { assert.equal(realpathSync(path), path); assert.equal(sha(path), value); }
    else if (value.absent) {
      assert.ok(['main', 'test', 'public/main'].some(name => path === join(target, 'target/web', name.startsWith('public') ? name : 'classes/' + name)));
      assert.equal(existsSync(path), false);
    } else { assert.ok(lstatSync(path).isDirectory()); assert.deepEqual(buildInventory(path), value); }
  }
  assert.ok(build.classpath.includes(join(target, 'target/scala-2.13/test-classes')));
  return build;
}
