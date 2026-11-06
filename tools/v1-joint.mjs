import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, openSync, closeSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, TOOL_ROOT } from './truth-source.mjs';
import { bankApplicationRequest, V1_TREE } from './v1-inputs.mjs';
import { historicalInventory } from './historical-source.mjs';

const load = file => import(pathToFileURL(join(TOOL_ROOT, file)).href);
const { readProductRequest } = await load('lib/products/cli.mjs');
const { compileProductSet } = await load('lib/products/compile.mjs');
const { generateProductCli } = await load('lib/products/generate-cli.mjs');
const { readAnchorsIndex } = await load('src/core/anchors.mjs');
const flows = ['payment', 'refund', 'ta', 'sip'];
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const inputDirectory = flow => join(ROOT, 'v1/formal-inputs', flow + '-376');

export function fingerprints(root) {
  if (root === V1_TREE) return Object.fromEntries(historicalInventory('v1/tree').map(({ file, sha256 }) => [file.slice('v1/tree/'.length), sha256]));
  const files = {};
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (['target', '.bloop', '.bsp'].includes(item.name)) continue;
      const file = join(directory, item.name);
      assert.ok(!item.isSymbolicLink(), 'symlink is not an owned source: ' + file);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) files[relative(root, file)] = sha(file);
    }
  }
  walk(root);
  return files;
}

export function checkedTarget(target) {
  assert.ok(isAbsolute(target) && resolve(target) === target, 'absolute normalized target required');
  const relativeTarget = relative(join(ROOT, '.scratch'), target).split('/');
  assert.ok(relativeTarget.length === 3 && relativeTarget[0].startsWith('p24-p25-bank-joint-') && relativeTarget[1] === 'targets', 'target must belong to an explicit bank joint scratch round');
  assert.equal(realpathSync(target), target, 'target cannot contain symlinks');
  assert.ok(lstatSync(target).isDirectory());
  const index = readAnchorsIndex(json(join(target, 'anchors.json')));
  const locations = Object.values(index.anchors).flat();
  assert.ok(locations.length > 0 && Object.keys(index.anchors).some(key => key.startsWith('source:bank-v1#')), 'bank product source anchors required');
  for (const location of locations) {
    assert.equal(location.repo, target);
    assert.equal(location.status, 'source-verified');
    const file = join(target, location.file);
    assert.equal(realpathSync(file), file);
    assert.equal(location.fingerprint, 'sha256:' + sha(file));
  }
  return target;
}

export function checkInputs() {
  const before = fingerprints(V1_TREE), request = bankApplicationRequest({ historical: true }), compilation = compileProductSet(request);
  assert.deepEqual(compilation.diagnostics, []);
  const scopes = flows.map(flow => {
    const directory = inputDirectory(flow), captured = readProductRequest(join(directory, 'files.json'));
    assert.deepEqual(captured, request);
    assert.deepEqual(json(join(directory, 'compiled.json')), compilation.result);
    const scope = json(join(directory, 'scope.json'));
    assert.equal(scope.flow, flow);
    assert.ok(scope.sourceEntry && scope.pipeline && scope.requiredOracles.length > 0);
    return { flow, directory, sourceEntry: scope.sourceEntry, pipeline: scope.pipeline, requiredOracles: scope.requiredOracles };
  });
  assert.deepEqual(fingerprints(V1_TREE), before);
  return { products: compilation.result.products.length, scopes, runtimeVerified: false };
}

export async function planFlow(flow) {
  assert.ok(flows.includes(flow), 'unknown flow');
  checkInputs();
  const directory = inputDirectory(flow), target = join(ROOT, '.scratch', 'v1-plan-never-written');
  assert.ok(!existsSync(target), 'plan sentinel must not exist');
  const result = await generateProductCli(['--request', join(directory, 'files.json'), '--generator', join(TOOL_ROOT, 'generators/scala-cqrs-effect-application-v2'),
    '--options-json', join(directory, 'options.json'), '--out', target, '--plan']);
  assert.equal(result.applied, false);
  assert.ok(!existsSync(target), 'plan wrote a target');
  return result;
}

export async function testTarget(target, evidencePrefix) {
  checkedTarget(target);
  assert.ok(isAbsolute(evidencePrefix) && resolve(evidencePrefix) === evidencePrefix);
  const round = dirname(dirname(target));
  assert.equal(dirname(evidencePrefix), round, 'evidence must be in the same owned round');
  assert.equal(realpathSync(round), round);
  const files = ['.stdout.log', '.stderr.log', '.json'].map(suffix => evidencePrefix + suffix);
  assert.ok(files.every(file => !existsSync(file)), 'exclusive evidence prefix already exists');
  const before = { generated: fingerprints(target), handwritten: fingerprints(join(ROOT, 'v1/handwritten')), tests: fingerprints(join(ROOT, 'v1/test')) };
  const javaHome = '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home';
  const command = [join(javaHome, 'bin/java'), '-Xmx2G', '-Dsbt.server.autostart=false', '-Dsbt.supershell=false', '-Dsbt.offline=true', '-Dsbt.log.noformat=true',
    '-jar', '/usr/local/Cellar/sbt/1.10.4/libexec/bin/sbt-launch.jar', 'set offline := true',
    'set Compile / unmanagedSourceDirectories += file(' + JSON.stringify(join(ROOT, 'v1/handwritten/scala')) + ')',
    'set Test / unmanagedSourceDirectories += file(' + JSON.stringify(join(ROOT, 'v1/test/scala')) + ')', 'compile', 'Test / compile', 'test'];
  assert.ok(existsSync(command[0]) && existsSync(command[7]), 'pinned local Java and sbt launcher required; no download fallback');
  const out = openSync(files[0], 'wx'), err = openSync(files[1], 'wx');
  let child, timedOut = false, killTimer;
  try {
    child = spawn(command[0], command.slice(1), { cwd: target, env: { ...process.env, JAVA_HOME: javaHome, COURSIER_MODE: 'offline' }, stdio: ['ignore', out, err] });
  } finally { closeSync(out); closeSync(err); }
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 15000); }, 480000);
  const outcome = await new Promise(resolveExit => {
    let failure;
    child.once('error', error => { failure = error.message; });
    child.once('close', (exitCode, signal) => resolveExit({ exitCode, signal, ...(failure ? { error: failure } : {}) }));
  });
  clearTimeout(timer); clearTimeout(killTimer);
  const after = { generated: fingerprints(target), handwritten: fingerprints(join(ROOT, 'v1/handwritten')), tests: fingerprints(join(ROOT, 'v1/test')) };
  const receipt = { command, cwd: target, pid: child.pid ?? null, waited: true, timedOut, ...outcome, before, after,
    stdoutSHA: sha(files[0]), stderrSHA: sha(files[1]), generatedSourceUnchanged: JSON.stringify(before.generated) === JSON.stringify(after.generated) };
  writeFileSync(files[2], JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  assert.deepEqual(after, before, 'source changed during test execution');
  assert.ok(outcome.exitCode === 0 && !timedOut, 'joint execution failed; retain the complete evidence files');
  return { receipt: files[2], exitCode: outcome.exitCode, waited: true, timedOut };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.shift() !== '--historical') throw new Error('Frozen P24/P25 joint input. Use the root truthsrc.project.json for current generation; replay requires --historical.');
  if (args.length === 1 && args[0] === '--check') console.log(JSON.stringify(checkInputs()));
  else if (args.length === 2 && args[0] === '--plan') console.log(JSON.stringify(await planFlow(args[1])));
  else if (args.length === 4 && args[0] === '--test-target' && args[2] === '--evidence') console.log(JSON.stringify(await testTarget(args[1], args[3])));
  else throw new Error('Usage: --check | --plan payment|refund|ta|sip | --test-target /owned/target --evidence /same/round/fresh-prefix');
}
