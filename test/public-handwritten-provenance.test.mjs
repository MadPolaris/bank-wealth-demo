import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureProject } from '../../metarch-truthsrc/lib/project/cli.mjs';
import { bytesSha, sourceInventory, sourceReference, verifyHandwrittenSources } from '../../metarch-truthsrc/lib/handwritten-provenance.mjs';
import { verifyCurrentHandwrittenMapping } from '../tools/verify-handwritten-map.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapFile = join(root, 'docs/architecture/HANDWRITTEN-SOURCE-MAP.json');
const mapBytes = readFileSync(mapFile), mapping = JSON.parse(mapBytes);
// This suite does not need roundtrip's disposable author reconstruction. The separately
// allowed retirement suite still exercises the unmodified full capture/output entrypoint.
const captured = captureProject(join(root, 'truthsrc.project.json'), { roundtripCheck: false });
const sourceRoot = join(root, 'handwritten/scala');
const bankPolicy = { generator: { id: 'bank-handwritten-source-map', version: '1' },
  allowedRelations: ['implements', 'supports', 'legacy-adapter'] };
const current = map => verifyCurrentHandwrittenMapping(captured.request, captured.sourceIndex.snapshot, map);

test('current bank adapter preserves the exact fixed 35-file/54-reference output contract', async () => {
  assert.deepEqual(sourceInventory(sourceRoot), mapping.files);
  const result = await current(mapping);
  assert.deepEqual(result, { schemaVersion: 'bank.current-handwritten-verification/v1', passed: true,
    snapshot: captured.sourceIndex.snapshot, files: 35, references: 54, precision: 'file',
    relation: 'explicit-owner-declared-not-inferred', symbolSpanVerified: false,
    semanticMappingVerified: false, runtimeVerified: false,
    verification: 'source-pointer-resolution-and-actual-file-sha' });
  assert.deepEqual(readFileSync(mapFile), mapBytes);
  assert.deepEqual(sourceInventory(sourceRoot), mapping.files);
});

test('public evidence retains every bank inventory hash, source version and declared relationship', async () => {
  const result = await verifyHandwrittenSources(sourceRoot, captured.request, mapping.entries, bankPolicy);
  assert.deepEqual(result.inventory, mapping.files);
  const references = new Map();
  for (const entry of result.entries) {
    assert.deepEqual(mapping.entries.find(row => row.file === entry.file),
      { file: entry.file, relation: entry.relation, rationale: entry.rationale, sources: entry.sources });
    assert.equal(entry.fingerprint, mapping.files[entry.file]);
    for (const reference of entry.references) references.set(reference.knowledgeKey, reference);
  }
  assert.deepEqual([...references.values()].sort((a, b) => a.knowledgeKey.localeCompare(b.knowledgeKey, 'en')),
    [...mapping.references].sort((a, b) => a.knowledgeKey.localeCompare(b.knowledgeKey, 'en')));
  assert.equal(Object.keys(result.anchors.anchors).length, 54);
  const locations = Object.values(result.anchors.anchors).flat();
  assert.equal(locations.length, mapping.entries.reduce((sum, row) => sum + row.sources.length, 0));
  for (const location of locations) {
    assert.equal(location.generator, bankPolicy.generator.id); assert.equal(location.generatorVersion, '1');
    assert.equal(location.fingerprint, mapping.files[location.file]); assert.equal(location.status, 'source-verified');
    assert.equal(location.verification.level, 'file'); assert.equal(location.symbol, null); assert.equal(location.span, null);
  }
});

test('bank schemas, project, root, document and snapshot policies stay local and fail closed', async () => {
  for (const mutate of [
    value => { value.schemaVersion = 'garden.source-map/v1'; },
    value => { value.project = 'another.project.json'; },
    value => { value.root = 'v1/handwritten/scala'; },
    value => { value.document.id = 'another-document'; },
    value => { value.document.sha256 = bytesSha('stale document'); },
    value => { value.snapshot = bytesSha('stale snapshot'); },
    value => { value.files[Object.keys(value.files)[0]] = bytesSha('stale implementation'); },
  ]) {
    const changed = structuredClone(mapping); mutate(changed); await assert.rejects(current(changed));
  }
});

test('bank reference membership rejects self-consistent 53- and 55-key maps', async () => {
  const counts = new Map();
  for (const key of mapping.entries.flatMap(entry => entry.sources)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const removed = [...counts].find(([, count]) => count === 1)[0];
  const smaller = structuredClone(mapping);
  for (const entry of smaller.entries) {
    entry.sources = entry.sources.filter(key => key !== removed);
    if (!entry.sources.length) entry.sources = [[...counts.keys()].find(key => key !== removed)];
  }
  smaller.references = smaller.references.filter(reference => reference.knowledgeKey !== removed);
  await assert.rejects(current(smaller), /retain 54 source references/);
  const larger = structuredClone(mapping), extra = 'source:bank-v1#';
  assert.ok(!counts.has(extra)); larger.entries[0].sources.push(extra);
  larger.references.push(sourceReference(captured.request, extra));
  larger.references.sort((a, b) => a.knowledgeKey < b.knowledgeKey ? -1 : a.knowledgeKey > b.knowledgeKey ? 1 : 0);
  await assert.rejects(current(larger), /retain 54 source references/);
});

test('bank adapter retains relation, rationale, unique-source and exact-file checks', async () => {
  for (const mutate of [
    value => { value.entries[0].relation = 'cultivates'; },
    value => { value.entries[0].rationale = ' '; },
    value => { value.entries[0].sources.push(value.entries[0].sources[0]); },
    value => { value.entries.push(structuredClone(value.entries[0])); },
  ]) {
    const changed = structuredClone(mapping); mutate(changed); await assert.rejects(current(changed));
  }
});

test('fresh adapter import uses public installed-lib mechanism with no bank historical import closure', () => {
  const adapter = pathToFileURL(join(root, 'tools/verify-handwritten-map.mjs')).href;
  const tool = pathToFileURL(resolve(root, '../metarch-truthsrc/lib/handwritten-provenance.mjs')).href;
  const loader = `
    import assert from 'node:assert/strict';
    let port;
    export function initialize(data) { port = data.port; }
    export async function resolve(specifier, context, nextResolve) {
      const result = await nextResolve(specifier, context);
      if (result.url.startsWith(${JSON.stringify(pathToFileURL(root + '/').href)}))
        assert.equal(result.url, ${JSON.stringify(adapter)}, 'current adapter loaded a bank helper or historical dependency');
      assert.ok(!/\\/(?:truth-source|v1-release-provenance|v1-release-generation|historical-assets|historical-source)\\.mjs$/.test(result.url));
      port.postMessage(result.url);
      return result;
    }
  `;
  const code = `
    import { register } from 'node:module';
    import { MessageChannel } from 'node:worker_threads';
    const { port1, port2 } = new MessageChannel();
    const seen = new Set();
    const sentinel = 'data:text/javascript,export default 1';
    let complete;
    const done = new Promise(resolve => { complete = resolve; });
    port1.on('message', url => { seen.add(url); if (url === sentinel) complete(); });
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loader)}),
      { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });
    await import(${JSON.stringify(adapter)});
    await import(sentinel);
    await done;
    port1.close();
    console.log(JSON.stringify([...seen]));
  `;
  const loaded = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15000 }));
  assert.ok(loaded.includes(tool));
  assert.ok(loaded.some(url => url.endsWith('/src/core/anchors.mjs')));
  const manifest = JSON.parse(readFileSync(resolve(root, '../metarch-truthsrc/package.json'), 'utf8'));
  assert.ok(manifest.files.includes('lib/')); assert.ok(manifest.files.includes('src/'));
});
