import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { captureEvidenceFile } from '../../metarch-truthsrc/lib/verification/files.mjs';
import { verifyToolingOwnership } from '../../metarch-truthsrc/lib/verification/tooling-ownership.mjs';

const ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const MANIFEST = join(ROOT, 'docs/architecture/TOOLING-OWNERSHIP.json');
// Only Git's tracked file list plus these two explicitly admitted new tools.
// No filesystem walk, untracked cache discovery, runtime import or orchestration.
const NEW_TOOLS = ['tools/truthsrc-evidence.mjs', 'tools/truthsrc-worker-evidence.mjs'];
const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const candidateFiles = [...new Set([...tracked, ...NEW_TOOLS])];
const groups = {
  workshop: ['bank-workshop', 'bank-workshop-session', 'bank-workshop-supply', 'bank-workshop-verification',
    'bank-workshop-view', 'truthsrc-project', 'prepare-truthsrc-runtime', 'verify-handwritten-map'],
  build: ['verify-truthsrc-build', 'truthsrc-actor-tests', 'truthsrc-readside-tests', 'truthsrc-runtime-tests',
    'truthsrc-runtime-admission', 'truthsrc-runtime-jars'],
  runtime: ['verify-truthsrc-runtime', 'truthsrc-runtime-process', 'truthsrc-runtime-lease', 'truthsrc-runtime-sandbox',
    'truthsrc-runtime-config', 'truthsrc-runtime-databases', 'truthsrc-runtime-db-relay', 'truthsrc-runtime-db-exec',
    'truthsrc-runtime-http', 'truthsrc-runtime-browser', 'truthsrc-runtime-crash', 'truthsrc-runtime-ta-worker',
    'truthsrc-actor-ta-worker', 'scala/BankWorkshopMain.scala'],
  history: ['historical-source', 'historical-assets', 'truth-source', 'artifacts', 'cash-contract',
    'formal-contract-inputs', 'mock-ta', 'project', 'validate', 'qualify-domain'],
  v1: ['v1-inputs', 'v1-service-inputs', 'v1-joint', 'v1-mock-ta-worker', 'v1-service-mock-ta-worker',
    'v1-browser-check', 'v1-browser-funds', 'v1-crash-recovery', 'v1-http-acceptance'],
  release: ['v1-release.mjs', 'v1-release-orchestrate.mjs', 'v1-release-execute.py', 'v1-release-runtime.py',
    'v1-release-stage.mjs', 'v1-release-generation.mjs', 'v1-release-provenance.mjs', 'v1-release-build-evidence.mjs',
    'v1-release-cold.mjs', 'v1-release-certify.mjs', 'v1-release-dist.mjs', 'v1-release-finalize.mjs',
    'v1-release-supply.mjs', 'v1-release-supply-analysis.mjs', 'v1-repair-driver.py'],
  adapters: ['truthsrc-evidence', 'truthsrc-worker-evidence'],
};
const toolPath = name => 'tools/' + name + (extname(name) ? '' : '.mjs');
const input = () => ({ root: ROOT, candidateFiles, sourceRoots: { truthsrc: realpathSync(join(ROOT, '../metarch-truthsrc')) },
  inventory: captureEvidenceFile(MANIFEST, { parse: bytes => JSON.parse(bytes) }).value });
const byFile = inventory => new Map(inventory.entries.map(entry => [entry.file, entry]));
const read = file => readFileSync(join(ROOT, file), 'utf8');

test('exact 62 original tools plus two new adapters, with all seven groups enumerated', () => {
  assert.deepEqual(Object.values(groups).map(files => files.length), [8, 6, 14, 10, 9, 15, 2]);
  const expected = Object.values(groups).flat().map(toolPath).sort();
  assert.equal(new Set(expected).size, 64);
  const original = tracked.filter(file => file.startsWith('tools/') && !NEW_TOOLS.includes(file));
  assert.equal(original.length, 62);
  assert.deepEqual([...new Set([...original, ...NEW_TOOLS])].sort(), expected);
  assert.deepEqual(input().inventory.entries.map(entry => entry.file).sort(), expected);
  assert.deepEqual(['.mjs', '.py', '.scala'].map(extension => expected.filter(file => extname(file) === extension).length), [60, 3, 1]);
  assert.ok(expected.every(file => !file.includes('__pycache__')));
});

test('public checker captures all declared source references without importing bank tools or reading local outputs', t => {
  const options = input(), before = JSON.stringify(options);
  const result = verifyToolingOwnership(options);
  assert.equal(result.passed, true);
  assert.equal(result.toolCount, 64);
  assert.equal(JSON.stringify(options), before);
  for (const entry of options.inventory.entries) {
    assert.equal(entry.provenance.kind, 'engineering-authored', entry.file);
    assert.ok(entry.consumers.length > 0, entry.file + ': declared caller/reference required');
  }
  assert.equal(result.declaration, 'owner-declared-not-semantic-proof');
  for (const key of ['semanticsVerified', 'executionVerified', 'importClosureVerified', 'candidateCompletenessVerified']) {
    assert.equal(result[key], false);
  }
  for (const reference of result.references) {
    const file = relative(ROOT, reference.file);
    assert.doesNotMatch(file, /^(?:\.truthsrc|generated|target|\.local|\.scratch|dist)\//);
    assert.match(reference.sha256, /^[a-f0-9]{64}$/);
  }
  t.diagnostic(`64 tool files; ${result.references.length} distinct captured source references; no bank modules executed`);
});

test('bank inventory rejects omitted, duplicated and newly unlisted tools', () => {
  const omitted = input(); omitted.inventory.entries.pop();
  assert.throws(() => verifyToolingOwnership(omitted), /exact candidate/);
  const duplicated = input(); duplicated.inventory.entries.push(structuredClone(duplicated.inventory.entries[0]));
  assert.throws(() => verifyToolingOwnership(duplicated), /duplicate/);
  const added = input(); added.candidateFiles = [...candidateFiles, 'tools/new-unclassified.mjs'];
  assert.throws(() => verifyToolingOwnership(added), /exact candidate/);
});

test('historical reuse, transitively loaded old build evidence and paused qualification remain explicit', () => {
  const entries = byFile(input().inventory);
  for (const name of ['historical-source', 'historical-assets', 'v1-crash-recovery', 'v1-browser-funds',
    'v1-browser-check', 'v1-release-build-evidence', 'v1-mock-ta-worker']) {
    assert.equal(entries.get(toolPath(name)).lifecycle, 'shared-historical', name);
  }
  const oldBuild = entries.get(toolPath('v1-release-build-evidence'));
  assert.match(oldBuild.consumers[0].note, /current recovery runner does not call verifyReleaseBuild/);
  assert.equal(entries.get(toolPath('qualify-domain')).lifecycle, 'paused');
  assert.equal(entries.get(toolPath('qualify-domain')).publicMechanism.status, 'paused');
  assert.equal(entries.get(toolPath('v1-release-provenance')).publicMechanism.status, 'historical-local');
  assert.ok(read('tools/truthsrc-runtime-crash.mjs').includes("from './v1-crash-recovery.mjs'"));
  assert.ok(read('tools/truthsrc-runtime-browser.mjs').includes("from './v1-browser-funds.mjs'"));
  assert.ok(read('tools/v1-crash-recovery.mjs').includes("from './v1-release-build-evidence.mjs'"));
});

test('public targets distinguish actual adapters from bank-owned lease, actor and snapshot policies', () => {
  const entries = byFile(input().inventory);
  const target = (name, module, consumer) => {
    const mechanism = entries.get(toolPath(name)).publicMechanism;
    assert.ok(mechanism.targets.some(row => row.file === module && row.consumer === toolPath(consumer)), name);
    return mechanism;
  };
  assert.equal(target('truthsrc-runtime-process', 'lib/verification/process.mjs', 'truthsrc-runtime-process').status, 'migrated');
  assert.equal(target('truthsrc-worker-evidence', 'lib/verification/worker-evidence.mjs', 'truthsrc-worker-evidence').status, 'migrated');
  assert.equal(target('truthsrc-evidence', 'lib/verification/files.mjs', 'truthsrc-evidence').status, 'migrated');
  assert.equal(target('verify-handwritten-map', 'lib/handwritten-provenance.mjs', 'verify-handwritten-map').status, 'migrated');
  assert.equal(target('truthsrc-actor-tests', 'lib/verification/worker-evidence.mjs', 'truthsrc-actor-tests').status, 'partial');
  assert.equal(target('truthsrc-runtime-lease', 'lib/verification/lease.mjs', 'truthsrc-runtime-lease').status, 'migrated');
  assert.equal(target('bank-workshop-verification', 'lib/verification/runner.mjs', 'bank-workshop-verification').status, 'partial');
  assert.equal(target('verify-truthsrc-build', 'lib/verification/inventory.mjs', 'verify-truthsrc-build').status, 'partial');
  assert.equal(target('truthsrc-runtime-tests', 'lib/verification/outcome.mjs', 'truthsrc-runtime-tests').status, 'partial');
  assert.ok(read('tools/truthsrc-runtime-lease.mjs').includes("from './truthsrc-evidence.mjs'"));
  for (const name of ['bank-workshop-supply', 'verify-truthsrc-build', 'truthsrc-runtime-admission']) {
    assert.equal(entries.get(toolPath(name)).publicMechanism.status, 'partial');
    assert.match(entries.get(toolPath(name)).responsibility.policy, /snapshot|guard/i);
  }
});

test('recipe describes all 13 tracked directories, local outputs and independent authoring inputs', () => {
  const directories = ['truth', 'bindings', 'handwritten', 'test', 'simulator', 'tools', 'docs', 'third-party',
    'formal-inputs', 'projections', 'compiled', 'isolation-zone', 'qualification'];
  const actual = [...new Set(tracked.filter(file => file.includes('/') && !file.startsWith('.')).map(file => file.split('/')[0]))].sort();
  assert.deepEqual(actual, [...directories].sort());
  const recipe = read('docs/BUILD-RECIPE.md');
  for (const directory of [...directories, '.truthsrc', 'generated', 'target', '.local', '.scratch', 'dist']) {
    assert.ok(recipe.includes('`' + directory + '/`'), directory);
  }
  const project = JSON.parse(read('truthsrc.project.json'));
  assert.equal(project.tree, 'truth/bank-wealth');
  assert.equal(project.documents.length, 8);
  assert.equal(project.products.length, 14);
  for (const file of ['bindings.json', 'runtime-binding.json', 'execution-bindings.json',
    'wealth-bindings.json', 'wealth-runtime-binding.json', 'wealth-execution-bindings.json']) {
    assert.ok(tracked.includes(file)); assert.ok(recipe.includes('`' + file + '`'), file);
  }
  assert.equal(tracked.filter(file => file.startsWith('handwritten/scala/') && file.endsWith('.scala')).length, 35);
  assert.equal(tracked.filter(file => file.startsWith('test/scala/') && file.endsWith('.scala')).length, 31);
  assert.equal(tracked.filter(file => file.startsWith('third-party/')).length, 14);
  for (const fact of ['actor64', 'readside47', 'clean1134', '90秒', 'R2', 'OPEN', 'P3', 'TOOLING-OWNERSHIP.json']) {
    assert.ok(recipe.includes(fact), fact);
  }
});

test('new documentation is reachable and its local file links resolve without runtime artifacts', () => {
  assert.ok(read('README.md').includes('docs/BUILD-RECIPE.md'));
  assert.ok(read('docs/architecture/README.md').includes('../BUILD-RECIPE.md'));
  assert.ok(read('docs/architecture/README.md').includes('TOOLING-OWNERSHIP.json'));
  const file = join(ROOT, 'docs/BUILD-RECIPE.md');
  for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^(?:https?:|#)/.test(link)) continue;
    const destination = resolve(dirname(file), link.split('#')[0]);
    assert.ok(existsSync(destination), link);
    assert.doesNotMatch(relative(ROOT, destination), /^(?:\.truthsrc|generated|target|\.local|\.scratch|dist)\//);
  }
});
