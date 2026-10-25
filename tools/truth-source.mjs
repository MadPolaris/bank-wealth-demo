import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TREE = join(ROOT, 'tree');
export const TOOL_ROOT = resolve(process.env.TRUTHSRC_ROOT || join(ROOT, '../metarch-truthsrc'));
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function filesUnder(directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => entry.isDirectory()
      ? filesUnder(join(directory, entry.name), predicate)
      : predicate(entry.name) ? [join(directory, entry.name)] : []);
}

function gitHead(directory) {
  try { return execFileSync('git', ['--no-optional-locks', '-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

// Fingerprint the local import closure, including schemas read at module initialization.
// Never imports a CLI, generator, cache synchronizer, or runtime host.
const entrypoints = ['lib/shared.mjs', 'lib/compile.mjs', 'lib/validate.mjs', 'lib/decompose.mjs',
  'lib/saga/compile.mjs', 'lib/execution/compile.mjs'];
function dependencyPaths() {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    if (!file.startsWith(`${TOOL_ROOT}/`) || !existsSync(file)) throw new Error(`Unavailable truthsrc dependency: ${file}`);
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      visit(resolve(dirname(file), match[1]));
    }
  }
  for (const entry of entrypoints) visit(join(TOOL_ROOT, entry));
  for (const schema of filesUnder(join(TOOL_ROOT, 'schema'), (name) => name.endsWith('.json'))) visited.add(schema);
  return [...visited].sort();
}

export function toolFingerprint() {
  const sources = dependencyPaths().map((file) => ({ file: relative(TOOL_ROOT, file), sha256: sha256(readFileSync(file)) }));
  const head = gitHead(TOOL_ROOT);
  return { head, sha256: sha256(JSON.stringify({ head, sources })), sources };
}

const loadedFingerprint = toolFingerprint();
const load = (path) => import(pathToFileURL(join(TOOL_ROOT, path)).href);
const [shared, compiler, validator, decomposer, sagaCompiler, executionCompiler] = await Promise.all(entrypoints.map(load));
if (toolFingerprint().sha256 !== loadedFingerprint.sha256) throw new Error('Truthsrc sources changed while importing; retry against a stable snapshot.');
export const { parseDoc, emitDoc, slug, STAGE_CODE, listInboxStages, NOTE_TYPES, ATOM_KINDS } = shared;

export function assertToolStable() {
  if (toolFingerprint().sha256 !== loadedFingerprint.sha256) {
    throw new Error('Concurrent truthsrc source change invalidates this verification run; reload before retrying.');
  }
}

export function sourceFingerprint(tree = TREE, root = ROOT) {
  const files = filesUnder(tree, (name) => name.endsWith('.yaml'));
  for (const binding of ['bindings.json', 'execution-bindings.json', 'runtime-binding.json']) files.push(join(root, binding));
  return sha256(JSON.stringify(files.sort().map((file) => [relative(root, file), sha256(readFileSync(file))])));
}

export function assertSnapshotStable(snapshot, root = ROOT) {
  assertToolStable();
  if (sourceFingerprint(snapshot.tree, root) !== snapshot.sourceFingerprint) {
    throw new Error('Concurrent bank-wealth truth/binding change invalidates this snapshot; reload before reporting or publishing.');
  }
}

export function loadSnapshot(tree = TREE, root = ROOT) {
  assertToolStable();
  const fingerprint = sourceFingerprint(tree, root);
  const text = compiler.compileTree(tree);
  const canonical = JSON.parse(text);
  const atoms = filesUnder(tree, (name) => name.endsWith('.yaml')).map((file) => ({
    file: relative(tree, file), doc: parseDoc(readFileSync(file, 'utf8'), file),
  }));
  const snapshot = { canonical, text, canonicalSha256: sha256(text), atoms, tree, tool: loadedFingerprint, sourceFingerprint: fingerprint };
  assertSnapshotStable(snapshot, root);
  return snapshot;
}

export function sourceGates(snapshot, root = ROOT) {
  assertSnapshotStable(snapshot, root);
  const structure = validator.validateTree(snapshot.tree);
  const saga = sagaCompiler.compileSagas(snapshot.canonical, JSON.parse(readFileSync(join(root, 'bindings.json'), 'utf8')));
  const execution = executionCompiler.compileExecution(snapshot.canonical, JSON.parse(readFileSync(join(root, 'execution-bindings.json'), 'utf8')));
  assertSnapshotStable(snapshot, root);
  return { structure, saga: { ok: !!saga.ir, diagnostics: saga.diagnostics }, execution: { ok: !!execution.ir, diagnostics: execution.diagnostics } };
}

export function roundtripLocal(snapshot) {
  assertSnapshotStable(snapshot);
  const scratch = join(ROOT, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const temp = mkdtempSync(join(scratch, 'roundtrip-'));
  try {
    decomposer.decomposeCanonical(snapshot.text, temp);
    if (compiler.compileTree(temp) !== snapshot.text) return { ok: false, stage: 'canonical', message: 'Canonical bytes differ after decomposition.' };
    const originals = filesUnder(snapshot.tree, (name) => name.endsWith('.yaml'));
    const regenerated = filesUnder(temp, (name) => name.endsWith('.yaml'));
    const oldPaths = originals.map((file) => relative(snapshot.tree, file));
    const newPaths = regenerated.map((file) => relative(temp, file));
    if (JSON.stringify(oldPaths) !== JSON.stringify(newPaths)) return {
      ok: false, stage: 'paths', missing: oldPaths.filter((file) => !newPaths.includes(file)), added: newPaths.filter((file) => !oldPaths.includes(file)),
    };
    const differences = oldPaths.filter((file) => !readFileSync(join(snapshot.tree, file)).equals(readFileSync(join(temp, file))));
    assertSnapshotStable(snapshot);
    return differences.length ? { ok: false, stage: 'bytes', differences } : { ok: true, atoms: oldPaths.length };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function protectedFiles(root = ROOT) {
  const directories = ['tree/sagas', 'tree/pipelines', 'compiled'];
  const files = directories.flatMap((directory) => filesUnder(join(root, directory)));
  for (const file of ['bindings.json', 'execution-bindings.json', 'runtime-binding.json',
    'isolation-zone/generated-scaffold/FundOrderGeneratedContract.scala',
    'isolation-zone/handwritten-adapter/FundOrderIsolationAdapter.scala']) files.push(join(root, file));
  return files.sort().map((file) => ({ file: relative(root, file), sha256: sha256(readFileSync(file)) }));
}

export function declarationIndex(canonical) {
  const index = new Map();
  const add = (kind, id, value) => index.set(`${kind}:${id}`, value);
  for (const aggregate of canonical.aggregates || []) {
    add('aggregate', aggregate.name, aggregate);
    for (const field of aggregate.stateFields || []) add('state-field', `${aggregate.name}.${field.name}`, field);
    for (const command of aggregate.commands || []) add('command', `${aggregate.name}.${command.name}`, { ...command, aggregate: aggregate.name });
    for (const event of aggregate.events || []) {
      add('event', `${aggregate.name}.${event.name}`, { ...event, aggregate: aggregate.name });
      for (const field of event.payloads || []) add('event-field', `${aggregate.name}.${event.name}.${field.name}`, field);
    }
  }
  for (const view of canonical.readModels || []) {
    add('read-model', view.name, view);
    for (const field of view.fields || []) add('read-model-field', `${view.name}.${field.name}`, field);
  }
  for (const story of canonical.stories || []) add('story', story.name, story);
  for (const session of canonical.sessions || []) for (const scope of session.scopes || []) for (const note of scope.notes || []) {
    if (note.type === 'role') add('role', note.name, note);
    if (note.type === 'externalSystem') add('external-system', note.name, note);
  }
  return index;
}
