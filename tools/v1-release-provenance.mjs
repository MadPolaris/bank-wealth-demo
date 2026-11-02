import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOOL_ROOT } from './truth-source.mjs';
import { plainPath } from './v1-release-generation.mjs';

const { readAnchorsIndex, planAnchors, verifyAnchorsPlan } = await import(pathToFileURL(join(TOOL_ROOT, 'src/core/anchors.mjs')).href);
export const bytesSha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const fileSha = file => bytesSha(readFileSync(file));
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const sidecars = ['anchors.json', 'truthsrc.ledger.json'];
const buildDirectories = ['target', 'project/target', 'project/project/target', '.bsp', '.bloop'];

export function sourceInventory(root, { afterBuild = false } = {}) {
  plainPath(root);
  assert.ok(lstatSync(root).isDirectory());
  const result = {};
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = join(directory, item.name), key = relative(root, file);
      assert.ok(!item.isSymbolicLink(), 'symlink in inventory: ' + key);
      if (afterBuild && item.isDirectory() && buildDirectories.includes(key)) continue;
      if (item.isDirectory()) walk(file);
      else { assert.ok(item.isFile(), 'non-regular inventory entry: ' + key); result[key] = fileSha(file); }
    }
  }
  walk(root);
  return result;
}

export function sourceReference(request, knowledgeKey) {
  const match = /^source:([^#]+)#(\/.*|)$/u.exec(knowledgeKey);
  assert.ok(match, 'unsupported source key: ' + knowledgeKey);
  const documents = request.documents.filter(d => d.id === match[1]);
  assert.equal(documents.length, 1, 'source document missing or ambiguous');
  const document = documents[0], pointer = match[2];
  let value = document.value, definitionVersion = value.version ?? null;
  if (pointer) for (const encoded of pointer.slice(1).split('/')) {
    assert.ok(!/~(?![01])/u.test(encoded), 'invalid JSON pointer escape');
    const token = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    assert.ok(value !== null && typeof value === 'object' && Object.hasOwn(value, token), 'source pointer missing: ' + knowledgeKey);
    value = value[token];
    if (value && typeof value === 'object' && Object.hasOwn(value, 'version')) definitionVersion = value.version;
  }
  const documentSha = bytesSha(JSON.stringify(document.value));
  return { knowledgeKey, document: document.id, pointer, schemaVersion: document.schemaVersion,
    documentSha, valueSha: bytesSha(JSON.stringify(value)), definitionVersion,
    sourceVersion: { kind: 'document-content-sha256', value: documentSha } };
}

export async function verifyGeneratedProvenance(target, request, { afterBuild = false } = {}) {
  const inventory = sourceInventory(target, { afterBuild });
  const index = readAnchorsIndex(json(join(target, 'anchors.json'))), ledger = json(join(target, 'truthsrc.ledger.json'));
  const locations = Object.values(index.anchors).flat();
  assert.ok(locations.length > 0);
  const generator = { id: locations[0].generator, version: locations[0].generatorVersion };
  const files = [...new Set(locations.map(l => l.file))].sort();
  assert.deepEqual(Object.keys(inventory).filter(f => !sidecars.includes(f)).sort(), files, 'complete generated inventory differs from anchored files');
  assert.equal(new Set(ledger.entries.map(e => e.path)).size, ledger.entries.length, 'duplicate ledger path');
  assert.deepEqual(ledger.entries.map(e => e.path).sort(), files, 'ledger inventory differs');
  for (const l of locations) {
    assert.equal(l.repo, target); assert.equal(l.generator, generator.id); assert.equal(l.generatorVersion, generator.version);
    assert.equal(l.fingerprint, inventory[l.file]); assert.equal(l.status, 'source-verified');
    assert.equal(l.verification.level, 'file'); assert.equal(l.symbol, null); assert.equal(l.span, null);
  }
  for (const entry of ledger.entries) {
    if (Object.hasOwn(entry, 'fingerprint')) assert.equal(entry.fingerprint, inventory[entry.path]);
    assert.deepEqual([...new Set(entry.knowledgeIds)].sort(), Object.keys(index.anchors).filter(k => index.anchors[k].some(l => l.file === entry.path)).sort(), 'ledger/source anchor relation differs');
  }
  const groups = Object.entries(index.anchors).map(([knowledgeKey, ls]) => ({ knowledgeKey, locations: ls.map(l => ({ ...l, expectedFingerprint: l.fingerprint })) }));
  const outcomes = files.map(file => ({ repo: target, file, outcome: 'IDENTICAL', fingerprint: inventory[file] }));
  const checked = await verifyAnchorsPlan(planAnchors({ priorIndex: index, generator, plannedKnowledgeKeys: groups, finalApplyOutcomes: outcomes }), { repoRoots: { [target]: target } });
  assert.deepEqual(checked, index);
  const references = Object.keys(index.anchors).sort().map(key => ({ ...sourceReference(request, key), files: index.anchors[key].map(l => l.file).sort() }));
  assert.ok(references.some(r => r.files.length > 1), 'expected actual 1:N source locations');
  return { target, generator, inventory, references, files: files.length, keys: references.length, locations: locations.length,
    oneToMany: true, verification: 'actual-file-sha-and-public-anchor-verifier', symbolSpanVerified: false,
    ledgerHasFingerprints: ledger.entries.every(e => Object.hasOwn(e, 'fingerprint')) };
}

export function verifyStableGeneration(left, right, { afterBuild = false } = {}) {
  const a = sourceInventory(left, { afterBuild }), b = sourceInventory(right, { afterBuild });
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), 'complete output inventory differs');
  for (const file of Object.keys(a)) if (file !== 'anchors.json') assert.equal(a[file], b[file], 'unstable generated file: ' + file);
  const normalize = root => {
    const index = json(join(root, 'anchors.json'));
    for (const locations of Object.values(index.anchors)) for (const l of locations) {
      assert.equal(l.repo, root); l.repo = '<explicit-target-root>';
    }
    return index;
  };
  assert.deepEqual(normalize(left), normalize(right), 'anchors differ beyond explicit target repo');
  return { left, right, files: Object.keys(a).length, inventory: a, normalizedOnly: ['anchors.json:anchors.*[].repo'], stable: true };
}

export async function verifyHandwrittenProvenance(root, request, mappings) {
  const inventory = sourceInventory(root), entries = mappings.entries;
  assert.equal(mappings.schemaVersion, 'bank-handwritten-source-map/v1');
  assert.equal(new Set(entries.map(e => e.file)).size, entries.length, 'duplicate handwritten mapping');
  assert.deepEqual(entries.map(e => e.file).sort(), Object.keys(inventory).sort(), 'handwritten mapping must cover exact inventory');
  const groups = new Map();
  const rows = entries.map(entry => {
    assert.ok(['implements', 'supports', 'legacy-adapter'].includes(entry.relation));
    assert.ok(typeof entry.rationale === 'string' && entry.rationale.trim());
    assert.ok(entry.sources.length > 0 && new Set(entry.sources).size === entry.sources.length);
    const references = entry.sources.map(key => {
      const ref = sourceReference(request, key);
      const locations = groups.get(key) ?? [];
      locations.push({ repo: root, file: entry.file, expectedFingerprint: inventory[entry.file] }); groups.set(key, locations);
      return ref;
    });
    return { ...entry, fingerprint: inventory[entry.file], references };
  });
  const index = await verifyAnchorsPlan(planAnchors({ generator: { id: 'bank-handwritten-source-map', version: '1' },
    plannedKnowledgeKeys: [...groups].map(([knowledgeKey, locations]) => ({ knowledgeKey, locations })),
    finalApplyOutcomes: Object.entries(inventory).map(([file, fingerprint]) => ({ repo: root, file, outcome: 'IDENTICAL', fingerprint })) }), { repoRoots: { [root]: root } });
  assert.ok(Object.values(index.anchors).flat().every(l => l.status === 'source-verified'));
  return { root, inventory, entries: rows, anchors: index, semanticMapping: 'explicit-owner-declared-not-inferred',
    verification: 'source-pointer-resolution-and-actual-file-sha', symbolSpanVerified: false };
}
