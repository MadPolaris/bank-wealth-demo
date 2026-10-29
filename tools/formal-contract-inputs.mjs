import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROOT, TREE, TOOL_ROOT, filesUnder, sha256, loadSnapshot, assertSnapshotStable
} from './truth-source.mjs';
import { extractArtifacts } from './artifacts.mjs';

export const TEMPLATE = join(ROOT, 'formal-inputs/existing-contracts/files.json');
const publicEntries = ['bin/truthsrc.js', 'lib/products/cli.mjs', 'lib/products/compile.mjs'];

// Include the CLI's static imports and the product command's explicit dynamic import.
// Other CLI branches are not executed by compile-products.
export function publicFingerprint() {
  const paths = new Set();
  function visit(file) {
    if (paths.has(file)) return;
    if (!file.startsWith(`${TOOL_ROOT}${sep}`) || !existsSync(file)) throw new Error(`Unavailable public dependency: ${file}`);
    paths.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) visit(resolve(dirname(file), match[1]));
  }
  publicEntries.forEach(file => visit(join(TOOL_ROOT, file)));
  filesUnder(join(TOOL_ROOT, 'schema'), name => name.endsWith('.json')).forEach(file => paths.add(file));
  const files = [...paths].sort().map(file => ({ file: relative(TOOL_ROOT, file), sha256: sha256(readFileSync(file)) }));
  const head = execFileSync('git', ['--no-optional-locks', '-C', TOOL_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { root: TOOL_ROOT, head, files, sha256: sha256(JSON.stringify({ head, files })) };
}

const importedFingerprint = publicFingerprint();
const publicCli = await import(pathToFileURL(join(TOOL_ROOT, 'lib/products/cli.mjs')).href);
const publicCompiler = await import(pathToFileURL(join(TOOL_ROOT, 'lib/products/compile.mjs')).href);
export const { captureProductRequest, captureProductJson } = publicCli;
export const { compileProductSet } = publicCompiler;

export function assertPublicStable() {
  assert.equal(publicFingerprint().sha256, importedFingerprint.sha256, 'Public product/CLI consumption closure changed; this run is invalid. Reload before retrying.');
}
assertPublicStable();

export function captureExistingRequest(snapshot = loadSnapshot()) {
  assertPublicStable();
  assertSnapshotStable(snapshot);
  const template = captureProductJson(TEMPLATE);
  const sources = [{ role: 'template', file: template.file, sha256: template.sha256, bytes: template.bytes }];
  const documents = template.value.documents.map((doc, index) => {
    if (index === 0) {
      assert.equal(doc.id, 'bank-canonical');
      return { id: doc.id, schemaVersion: doc.schemaVersion, value: snapshot.canonical };
    }
    const captured = captureProductJson(resolve(dirname(TEMPLATE), doc.file));
    sources.push({ document: doc.id, file: captured.file, sha256: captured.sha256, bytes: captured.bytes });
    return { id: doc.id, schemaVersion: doc.schemaVersion, value: captured.value };
  });
  const request = { schemaVersion: 'truthsrc.product-compilation/v1', documents,
    assemblies: template.value.assemblies, requirements: template.value.requirements, options: template.value.options };
  assertSnapshotStable(snapshot);
  assertPublicStable();
  return { snapshot, request, sources, template: template.value };
}

function locateArtifact(value, id, pointer = '') {
  if (!value || typeof value !== 'object') return null;
  if (value.info?.artifact?.id === id) return `${pointer}/info/artifact`;
  for (const [key, child] of Object.entries(value)) {
    const found = locateArtifact(child, id, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
    if (found) return found;
  }
  return null;
}

// Negative probes only: these are not claimed to be bank artifact/host bindings.
export function sourceRootProbes(snapshot) {
  const artifact = extractArtifacts(snapshot).find(row => row.id === 'contract.cash-purchase-v2');
  assert.ok(artifact, 'Real bank artifact required for the source probe');
  const pointer = locateArtifact(snapshot.canonical, artifact.id);
  assert.ok(pointer, 'Artifact body must be retained by the public tree compiler');
  const canonical = { id: 'bank-canonical', schemaVersion: 'truthsrc/v1', value: snapshot.canonical };
  const declaration = { ref: { context: 'bank-wealth-demo', kind: 'artifact', owner: [], id: artifact.id },
    valueType: null, source: { document: canonical.id, pointer }, dependencies: [] };
  const layout = { id: 'probe-reference', schemaVersion: 'truthsrc.reference-binding/v1',
    value: { schemaVersion: 'truthsrc.reference-binding/v1', layout: { contexts: ['bank-wealth-demo'], declarations: [declaration] } } };
  const referenceRequirement = { id: 'reference-layout', version: '1', payloadSchemaVersion: 'truthsrc.reference-layout/v1',
    capabilities: [{ id: 'qualified-reference-layout', version: '1' }],
    inputRoles: { canonical: canonical.id, referenceBinding: layout.id }, requires: [] };
  const positive = { schemaVersion: 'truthsrc.product-compilation/v1', documents: [canonical, layout],
    assemblies: [], requirements: [referenceRequirement], options: {} };
  const missingRoot = structuredClone(positive);
  missingRoot.documents.push({ id: 'probe-artifact', schemaVersion: 'truthsrc.artifact-binding/v2',
    value: { schemaVersion: 'truthsrc.artifact-binding/v2', artifacts: { artifacts: [] } } });
  missingRoot.requirements.push({ id: 'artifact-contract', version: '2', payloadSchemaVersion: 'truthsrc.artifact-contract/v2',
    capabilities: [{ id: 'artifact-static-contract', version: '2' }],
    inputRoles: { canonical: canonical.id, artifactBinding: 'probe-artifact' }, requires: [{ id: 'reference-layout', version: '1' }] });
  const missingPointer = structuredClone(positive);
  missingPointer.documents[1].value.layout.declarations[0].source.pointer = '/artifactContracts/0';
  return { artifact: { id: artifact.id, authoredStatus: artifact.status, treeSource: artifact.source,
    canonicalSource: { document: canonical.id, pointer } }, positive, missingRoot, missingPointer };
}

function newOutput(out, create = false) {
  if (!isAbsolute(out)) throw new Error('--out must be an absolute new bank-owned directory');
  const target = resolve(out), scratch = realpathSync(join(ROOT, '.scratch'));
  if (out !== target) throw new Error('--out must be normalized without path aliases');
  if (!target.startsWith(`${scratch}${sep}`) || target === scratch) throw new Error('--out must be inside bank .scratch');
  if (existsSync(target)) throw new Error('--out already exists; previous evidence is never overwritten');
  const parent = dirname(target);
  if (!existsSync(parent) || realpathSync(parent) !== parent) throw new Error('--out parent must already exist without symlink aliases');
  for (let p = parent; p !== scratch; p = dirname(p)) if (lstatSync(p).isSymbolicLink()) throw new Error('Symlink output parent refused');
  if (create) mkdirSync(target);
  return target;
}
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

export function prepareFormalInputs(out) {
  newOutput(out);
  const startedAt = new Date().toISOString();
  const bankCodeBefore = [fileURLToPath(import.meta.url), join(ROOT, 'tools/truth-source.mjs'), join(ROOT, 'tools/artifacts.mjs'), TEMPLATE]
    .map(file => ({ file, sha256: sha256(readFileSync(file)) }));
  const captured = captureExistingRequest();
  const before = publicFingerprint();
  const compilation = compileProductSet(captured.request);
  const probes = sourceRootProbes(captured.snapshot);
  const probeResults = Object.fromEntries(['positive', 'missingRoot', 'missingPointer'].map(key => [key, compileProductSet(probes[key])]));
  assertPublicStable();
  assertSnapshotStable(captured.snapshot);
  const target = newOutput(out, true);
  writeFileSync(join(target, 'canonical.json'), captured.snapshot.text, { flag: 'wx' });
  const manifest = { ...captured.template, documents: captured.template.documents.map((doc, index) => ({ ...doc,
    file: index === 0 ? 'canonical.json' : resolve(dirname(TEMPLATE), doc.file) })) };
  save(join(target, 'files.json'), manifest);
  const transported = captureProductRequest(join(target, 'files.json'));
  assert.deepEqual(transported.request, captured.request, 'Transport changed formal input values');
  save(join(target, 'api-result.json'), compilation);
  save(join(target, 'source-root-probes.json'), { usage: 'Negative source probes, not formal bank bindings or execution qualification',
    artifact: probes.artifact, rootPresent: Object.hasOwn(captured.snapshot.canonical, 'artifactContracts'), results: probeResults });
  for (const key of ['positive', 'missingRoot', 'missingPointer']) save(join(target, `probe-${key}.json`), probes[key]);
  const command = [process.execPath, join(TOOL_ROOT, 'bin/truthsrc.js'), 'compile-products', '--request', join(target, 'files.json'), '--out', join(target, 'semantic-products.json')];
  const cli = spawnSync(command[0], command.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(target, 'cli.stdout.log'), cli.stdout || '', { flag: 'wx' });
  writeFileSync(join(target, 'cli.stderr.log'), cli.stderr || '', { flag: 'wx' });
  const after = publicFingerprint();
  const sourceFiles = filesUnder(TREE, name => name.endsWith('.yaml')).map(file => ({ file: relative(ROOT, file), sha256: sha256(readFileSync(file)) }));
  let drift = null;
  try {
    assertPublicStable(); assertSnapshotStable(captured.snapshot);
    for (const row of bankCodeBefore) assert.equal(sha256(readFileSync(row.file)), row.sha256, `Bank consumer changed: ${row.file}`);
    for (const row of captured.sources) assert.equal(sha256(readFileSync(row.file)), row.sha256, `Captured input changed: ${row.file}`);
  } catch (error) { drift = error.message; }
  const equalCli = cli.status === 0 && existsSync(join(target, 'semantic-products.json')) &&
    JSON.stringify(JSON.parse(readFileSync(join(target, 'semantic-products.json'), 'utf8'))) === JSON.stringify(compilation.result);
  const receipt = { schemaVersion: 'bank-formal-contract-inputs/v1',
    status: !drift && compilation.result && equalCli ? 'passed' : 'failed',
    scope: 'Complete existing legacy and cash Saga/execution/runtime static contracts, not four new application inputs',
    startedAt, finishedAt: new Date().toISOString(),
    bankHead: execFileSync('git', ['--no-optional-locks', '-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    includesUncommittedSources: true, canonicalSha256: captured.snapshot.canonicalSha256, bankSourceFingerprint: captured.snapshot.sourceFingerprint,
    treeFiles: sourceFiles, bankConsumerCode: bankCodeBefore, inputs: transported.sources, originalSources: captured.sources,
    publicSourceBefore: before, publicSourceAfter: after, drift,
    command, cli: { status: cli.status, signal: cli.signal, error: cli.error?.message || null, apiResultEqual: equalCli },
    diagnostics: compilation.diagnostics, products: compilation.result?.products.map(p => ({ id: p.id, version: p.version, payloadSchemaVersion: p.payloadSchemaVersion })) || [],
    assemblies: compilation.result?.assemblies || [], readiness: compilation.result?.readiness || null,
    completeFourFlowApplicationInput: false, fundsRuntimeExecuted: false, applicationGenerated: false,
    consumption: { finished: true, continuingFreezeRequested: false, otherConsumersReleased: false, publicSourceWriteAuthorization: false } };
  save(join(target, 'receipt.json'), receipt);
  if (receipt.status !== 'passed') throw new Error(`Formal input consumption failed; preserved evidence at ${target}`);
  return { target, receipt, compilation, captured, transported, probes, probeResults };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node tools/formal-contract-inputs.mjs --out <new absolute bank .scratch directory>');
    const { target, receipt } = prepareFormalInputs(args[1]);
    console.log(JSON.stringify({ status: receipt.status, target, products: receipt.products, readiness: receipt.readiness }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
