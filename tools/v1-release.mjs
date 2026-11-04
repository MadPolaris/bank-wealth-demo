// The v1 manifest path remains read-only and cannot promote subset receipts.
// --execution selects the separate v2 controlled execution configuration.
// Neither path accepts a caller-supplied successful release certification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_SCHEMA = 'bank-v1-release-manifest/v1';
export const REPORT_SCHEMA = 'bank-v1-release-report/v1';
export const EVIDENCE_VERIFIERS = Object.freeze([
  'generated-provenance@1', 'stable-generation@1', 'handwritten-provenance@1',
  'supply-manifest@1', 'cold-build@1', 'portable-generation@1', 'mysql-negative@1'
]);
const PHASE_CONTENT = {
  P26: ['Trusted seed authority and replay/conflict/ACK boundaries', 'Authentication, closed DTOs, authorization and zero-event rejection', 'Durable original request, stable identity, concurrency, HTTP ACK and startup assembly'],
  P27: ['Three-participant payment, order-last-commit and exact conservation', 'Original identities/targets, five delivery kinds and durable checkpoints', 'Cancellation fences, early rejection and compensation boundaries', 'UNKNOWN retention and same-identity authorized recovery', 'Durable commit decision and forward reconciliation'],
  P28: ['Paid-order TA authority, original body/resources and exact decimals', 'Correlated investment terminal status, not payment/accepted/effect success', 'Configured MockTA and durable submission/acceptance/ingestion recovery'],
  P29: ['Unique independent principal refund after correlated TA rejection', 'Original refund identity/resources and no second refund', 'Durable refund discovery, assembly, phase and delivery recovery'],
  P30: ['Durable complete finite SIP intent and exact-prefix recovery', 'Monotonic tick, future revisions and pause/backlog policy', 'Durable occurrence identity, ordered catchup and original cash dispatch', 'First trusted terminal counting and replay/ACK boundaries'],
  P31: ['Specified cross-JVM barriers, durable PB/Saga/Monarch and zero duplicate effects', 'Clean CQRS replay, transactional checkpoints, negative cases and honest pages', 'Independent dual-chain admission, fresh generation/build/tests and stable regeneration', 'Actual SHA/1:N source anchors, separate handwritten mapping and legal source-increment loop'],
  P32: ['Portable generator/ext/dependency/configuration closure and frozen runtime/licenses', 'Clean-cache existing-artifact delivery without downloads or host-cache fallback', 'Controlled complete release execution and all original required acceptance items']
};
export const PHASE_COUNTS = Object.freeze(Object.fromEntries(Object.entries(PHASE_CONTENT).map(([phase, items]) => [phase, items.length])));
const phases = Object.keys(PHASE_CONTENT);
export const REQUIRED_SLOTS = Object.freeze(phases.flatMap((phase, p) => PHASE_CONTENT[phase].map((requirement, i) => {
  const predecessors = phase === 'P31' ? phases.slice(0, p) : p ? [phases[p - 1]] : [];
  return Object.freeze({ index: `${phase}:${i + 1}`, phase, required: true, requirement,
    dependsOn: Object.freeze(predecessors.flatMap(prev => PHASE_CONTENT[prev].map((_, n) => `${prev}:${n + 1}`))) });
})));
const statuses = ['unexecuted', 'blocked', 'failed', 'skipped', 'attested'];
const outcomes = ['passed', 'failed', 'blocked', 'unexecuted', 'skipped'];
const buildDirectories = ['target', 'project/target', 'project/project/target', '.bsp', '.bloop'];
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const sorted = values => [...values].sort();
const text = (value, label) => assert.ok(typeof value === 'string' && value.trim().length > 0, `${label}: nonempty string required`);
function object(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label}: object required`);
}
function keys(value, allowed, required, label) {
  object(value, label);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label}: unknown field ${key}`);
  for (const key of required) assert.ok(Object.hasOwn(value, key), `${label}: missing ${key}`);
}
function list(value, label, nonempty = false) {
  assert.ok(Array.isArray(value) && (!nonempty || value.length > 0), `${label}: ${nonempty ? 'nonempty ' : ''}array required`);
}
function fingerprint(value) { assert.match(value, /^sha256:[0-9a-f]{64}$/u, 'explicit lowercase sha256: fingerprint required'); }
function fileRef(value) {
  keys(value, ['file', 'sha256'], ['file', 'sha256'], 'file reference');
  text(value.file, 'file'); fingerprint(value.sha256);
}
function unique(values, label) { assert.equal(new Set(values).size, values.length, `duplicate ${label}`); }
function relativeFile(file) {
  text(file, 'relative file');
  assert.ok(!isAbsolute(file) && !file.includes('\\') && !file.includes('\0') && file.split('/').every(p => p && p !== '.' && p !== '..'), 'canonical relative file required');
}

// Dependency-free path preflight: importing the old helper eagerly loads the
// sibling truth toolchain. When invoking that toolchain below, also use its
// plainPath/releaseTarget. This guard keeps absent-toolchain --check runnable.
export function checkPlainPath(path, fresh = false) {
  assert.ok(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !path.includes('\\') && !path.includes('\0'), 'canonical absolute path required');
  let ancestor = path;
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = dirname(ancestor);
  assert.ok(!lstatSync(ancestor).isSymbolicLink() && realpathSync(ancestor) === ancestor, 'symlink or aliased ancestor forbidden');
  if (fresh) assert.ok(!lstatSync(path, { throwIfNoEntry: false }), 'exclusive output already exists');
  else assert.ok(lstatSync(path, { throwIfNoEntry: false }), 'input path missing');
  return path;
}
function readBytes(file) {
  checkPlainPath(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { assert.ok(fstatSync(fd).isFile(), 'regular file required: ' + file); return readFileSync(fd); }
  finally { closeSync(fd); }
}
function reader() {
  const seen = new Map();
  return {
    seen,
    read(ref) {
      fileRef(ref);
      const bytes = readBytes(ref.file);
      assert.equal(hash(bytes), ref.sha256, 'file hash differs: ' + ref.file);
      if (seen.has(ref.file)) assert.equal(seen.get(ref.file), ref.sha256, 'inconsistent file binding: ' + ref.file);
      seen.set(ref.file, ref.sha256);
      return bytes;
    },
    recheck() { for (const [file, sha256] of seen) assert.equal(hash(readBytes(file)), sha256, 'file changed during evaluation: ' + file); }
  };
}
function inventory(root, afterBuild, io) {
  checkPlainPath(root); assert.ok(lstatSync(root).isDirectory(), 'inventory directory required');
  const files = Object.create(null);
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = join(directory, item.name), key = relative(root, file);
      assert.ok(!item.isSymbolicLink(), 'symlink in inventory: ' + file);
      if (item.isDirectory()) { if (!(afterBuild && buildDirectories.includes(key))) walk(file); }
      else {
        assert.ok(item.isFile(), 'non-regular inventory entry: ' + file);
        const sha256 = hash(readBytes(file));
        io.read({ file, sha256 }); files[key] = sha256;
      }
    }
  }
  walk(root); return files;
}
function pointerValue(value, pointer) {
  assert.ok(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')), 'RFC6901 pointer required');
  if (pointer === '') return value;
  for (const encoded of pointer.slice(1).split('/')) {
    assert.ok(!/~(?![01])/u.test(encoded), 'invalid JSON pointer escape');
    const token = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    assert.ok(value !== null && typeof value === 'object' && Object.hasOwn(value, token), 'source/result pointer missing');
    if (Array.isArray(value)) assert.match(token, /^(0|[1-9][0-9]*)$/u, 'canonical array pointer index required');
    value = value[token];
  }
  return value;
}
function reference(request, knowledgeKey) {
  const match = /^source:([^#]+)#(\/.*|)$/u.exec(knowledgeKey);
  assert.ok(match, 'unsupported source reference');
  const documents = request.documents.filter(d => d.id === match[1]);
  assert.equal(documents.length, 1, 'source document missing or ambiguous');
  const document = documents[0], pointer = match[2];
  let value = document.value, definitionVersion = value?.version ?? null;
  if (pointer) {
    let prefix = '';
    for (const encoded of pointer.slice(1).split('/')) {
      prefix += '/' + encoded; value = pointerValue(document.value, prefix);
      if (value && typeof value === 'object' && Object.hasOwn(value, 'version')) definitionVersion = value.version;
    }
  }
  const documentSha = digest(document.value);
  return { knowledgeKey, document: document.id, pointer, schemaVersion: document.schemaVersion,
    documentSha, valueSha: digest(value), definitionVersion,
    sourceVersion: { kind: 'document-content-sha256', value: documentSha } };
}
function pairs(refs) { return refs.map(r => [r.file, r.sha256]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0); }

export function validateManifest(manifest) {
  keys(manifest, ['schemaVersion', 'sourceSnapshot', 'generation', 'slots'], ['schemaVersion', 'slots'], 'manifest');
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA, 'unsupported manifest version');
  list(manifest.slots, 'slots'); unique(manifest.slots.map(s => s.index), 'slot index');
  for (const slot of manifest.slots) {
    keys(slot, ['index', 'status', 'reason', 'evidence'], ['index', 'status'], 'slot');
    assert.ok(REQUIRED_SLOTS.some(s => s.index === slot.index), 'unknown original phase slot: ' + slot.index);
    assert.ok(statuses.includes(slot.status), 'unsupported slot status (a supplied pass is not accepted)');
    if (slot.reason !== undefined) text(slot.reason, 'reason');
    if (slot.status === 'blocked' || slot.status === 'failed' || slot.status === 'skipped') text(slot.reason, 'reason');
    list(slot.evidence ?? [], 'evidence', slot.status === 'attested');
    for (const evidence of slot.evidence ?? []) {
      const common = ['kind', 'receipts', 'sourceFiles', 'references'];
      const manual = evidence.kind === 'manual-owner-declared';
      keys(evidence, [...common, ...(manual ? ['owner', 'declaredOutcome', 'scope', 'limitations'] : ['parameters', 'resultPointer'])],
        [...common, ...(manual ? ['owner', 'declaredOutcome', 'scope', 'limitations'] : ['parameters', 'resultPointer'])], 'evidence');
      assert.ok(manual || EVIDENCE_VERIFIERS.includes(evidence.kind), 'unknown concrete verifier');
      for (const name of ['receipts', 'sourceFiles', 'references']) list(evidence[name], name, true);
      for (const ref of [...evidence.receipts, ...evidence.sourceFiles]) fileRef(ref);
      unique(evidence.receipts.map(r => r.file), 'receipt'); unique(evidence.sourceFiles.map(r => r.file), 'source file');
      unique(evidence.references.map(r => r.knowledgeKey), 'source reference');
      if (manual) {
        text(evidence.owner, 'owner'); text(evidence.scope, 'scope');
        assert.ok(outcomes.includes(evidence.declaredOutcome), 'unsupported owner-declared outcome');
        list(evidence.limitations, 'limitations'); for (const limitation of evidence.limitations) text(limitation, 'limitation');
      } else {
        const concreteIn = { 'generated-provenance@1': 'P31:3', 'stable-generation@1': 'P31:3', 'handwritten-provenance@1': 'P31:4',
          'supply-manifest@1': 'P32:1', 'cold-build@1': 'P32:2', 'portable-generation@1': 'P32:1', 'mysql-negative@1': 'P31:2' };
        assert.ok(concreteIn[evidence.kind], 'verifier ' + evidence.kind + ' is not mapped to a supporting slot');
        assert.ok(slot.index === concreteIn[evidence.kind],
          evidence.kind + ' is only supporting ' + concreteIn[evidence.kind] + ' evidence');
        assert.equal(evidence.receipts.length, 1, 'concrete verifier requires one selected JSON receipt');
        const fields = { 'generated-provenance@1': ['target', 'afterBuild'], 'stable-generation@1': ['left', 'right', 'afterBuild'],
          'handwritten-provenance@1': ['root', 'mappings'], 'supply-manifest@1': ['manifest'],
          'cold-build@1': ['result'], 'portable-generation@1': ['receipt'], 'mysql-negative@1': ['runReceipt'] }[evidence.kind];
        keys(evidence.parameters, fields, fields, 'verifier parameters');
        if (evidence.kind === 'handwritten-provenance@1') fileRef(evidence.parameters.mappings);
        if (evidence.kind === 'supply-manifest@1') fileRef(evidence.parameters.manifest);
        if (evidence.kind === 'cold-build@1') fileRef(evidence.parameters.result);
        if (evidence.kind === 'portable-generation@1') fileRef(evidence.parameters.receipt);
        if (evidence.kind === 'mysql-negative@1') fileRef(evidence.parameters.runReceipt);
        else if (['target', 'left', 'right'].includes(fields[0])) assert.equal(typeof evidence.parameters.afterBuild, 'boolean', 'explicit afterBuild required');
        assert.ok(typeof evidence.resultPointer === 'string' && (evidence.resultPointer === '' || evidence.resultPointer.startsWith('/')), 'explicit result pointer required');
      }
    }
  }
  if (manifest.sourceSnapshot !== undefined) {
    const snapshot = manifest.sourceSnapshot;
    keys(snapshot, ['request', 'inventories'], ['request', 'inventories'], 'source snapshot'); fileRef(snapshot.request);
    list(snapshot.inventories, 'inventories', true); unique(snapshot.inventories.map(i => i.root), 'inventory root');
    for (const item of snapshot.inventories) {
      keys(item, ['root', 'afterBuild', 'files'], ['root', 'afterBuild', 'files'], 'inventory');
      text(item.root, 'inventory root'); assert.equal(typeof item.afterBuild, 'boolean'); object(item.files, 'inventory files');
      for (const [file, sha256] of Object.entries(item.files)) { relativeFile(file); fingerprint(sha256); }
      assert.ok(Object.keys(item.files).length > 0, 'empty source inventory is not evidence');
    }
  }
  if (manifest.generation !== undefined) {
    keys(manifest.generation, ['inputs', 'jsTarget', 'bcTarget'], ['inputs', 'jsTarget', 'bcTarget'], 'generation');
    for (const value of Object.values(manifest.generation)) text(value, 'generation path');
  }
  return manifest;
}
function verifySnapshot(snapshot, io) {
  const request = JSON.parse(io.read(snapshot.request).toString('utf8'));
  object(request, 'full request'); list(request.documents, 'full request documents', true);
  unique(request.documents.map(d => d.id), 'source document');
  for (const document of request.documents) {
    text(document.id, 'document id'); text(document.schemaVersion, 'document schemaVersion');
    assert.ok(Object.hasOwn(document, 'value'), 'source document value required');
  }
  const sources = [];
  for (const item of snapshot.inventories) {
    const actual = inventory(item.root, item.afterBuild, io);
    assert.deepEqual({ ...actual }, { ...item.files }, 'complete source inventory differs: ' + item.root);
    sources.push(...Object.entries(actual).map(([file, sha256]) => ({ file: join(item.root, file), sha256 })));
  }
  unique(sources.map(s => s.file), 'overlapping source inventory file');
  assert.ok(sources.some(s => s.file === snapshot.request.file && s.sha256 === snapshot.request.sha256), 'full captured request must belong to source inventory');
  return { request, sources, sha256: digest({ request: snapshot.request, files: pairs(sources) }) };
}
function snapshotStillMatches(snapshot, io) {
  for (const item of snapshot.inventories) assert.deepEqual({ ...inventory(item.root, item.afterBuild, io) }, { ...item.files }, 'source inventory changed during evaluation');
  io.recheck();
}
function mustBeInventoried(snapshot, root, afterBuild) {
  assert.ok(snapshot.inventories.some(i => i.root === root && i.afterBuild === afterBuild), 'verifier requires complete inventoried directory: ' + root);
}
async function verifyEvidence(evidence, snapshot, source, io) {
  // Whole supplied source window, not just whichever one file a caller selected.
  assert.deepEqual(pairs(evidence.sourceFiles), pairs(source.sources), 'receipt must bind the complete supplied source snapshot');
  for (const ref of evidence.sourceFiles) io.read(ref);
  for (const ref of evidence.references) assert.deepEqual(ref, reference(source.request, ref.knowledgeKey), 'source reference/version/hash differs');
  const receipts = evidence.receipts.map(ref => {
    const bytes = io.read(ref);
    return { ...ref, bytes: bytes.length, format: ref.file.endsWith('.json') ? 'json' : 'opaque-bytes',
      ...(ref.file.endsWith('.json') ? { recorded: JSON.parse(bytes.toString('utf8')) } : {}) };
  });
  if (evidence.kind === 'manual-owner-declared') {
    return { kind: evidence.kind, state: 'manual-owner-declared', owner: evidence.owner,
      declaredOutcome: evidence.declaredOutcome, scope: evidence.scope, limitations: evidence.limitations,
      receipts, sourceSnapshotSha256: source.sha256, sourceFiles: evidence.sourceFiles,
      references: evidence.references, originalItemCertified: false,
      sourceWindowBinding: 'owner-declared historical association; current bytes/hashes verified, historical execution not auto-certified' };
  }
  const parameters = evidence.parameters;
  if (evidence.kind === 'generated-provenance@1') mustBeInventoried(snapshot, parameters.target, parameters.afterBuild);
  else if (evidence.kind === 'stable-generation@1') {
    assert.notEqual(parameters.left, parameters.right, 'independent regeneration directories required');
    mustBeInventoried(snapshot, parameters.left, parameters.afterBuild); mustBeInventoried(snapshot, parameters.right, parameters.afterBuild);
  } else if (evidence.kind === 'supply-manifest@1' || evidence.kind === 'cold-build@1' || evidence.kind === 'portable-generation@1' || evidence.kind === 'mysql-negative@1') {
    // P32/P31-2 execution receipts: recompute from the recorded artifact, no directories re-run here.
    const recorded0 = JSON.parse(io.read(evidence.receipts[0]).toString('utf8'));
    let actual;
    if (evidence.kind === 'supply-manifest@1') {
      const manifestFile = JSON.parse(io.read(evidence.parameters.manifest).toString('utf8'));
      list(manifestFile.files, 'supply files');
      list(manifestFile.unresolved, 'supply unresolved');
      const files = manifestFile.files;
      const unresolved = manifestFile.unresolved;
      actual = { schemaVersion: manifestFile.schemaVersion, status: manifestFile.status, fileCount: Array.isArray(files) ? files.length : Object.keys(files).length,
        unresolvedCount: unresolved.length, unresolvedCodes: sorted(unresolved.map(u => u.code)) };
      assert.ok(manifestFile.schemaVersion === 'bank-existing-supply-manifest/v1', 'supply manifest schema differs');
    } else if (evidence.kind === 'cold-build@1') {
      const result = JSON.parse(io.read(evidence.parameters.result).toString('utf8'));
      assert.equal(result.schemaVersion, 'bank-cold-build/v1', 'cold result schema differs');
      assert.ok(['passed', 'blocked', 'failed'].includes(result.status), 'cold result status required');
      for (const field of ['noNetwork', 'sourceUnchanged', 'suppliesUnchanged', 'testPhase']) assert.equal(typeof result[field], 'boolean', 'explicit cold result boolean required: ' + field);
      actual = { schemaVersion: result.schemaVersion, status: result.status, noNetwork: result.noNetwork === true,
        sourceUnchanged: result.sourceUnchanged === true, suppliesUnchanged: result.suppliesUnchanged === true,
        testPhase: result.testPhase === true, prefilledBridges: Array.isArray(result.prefilledDerivedBridges) ? result.prefilledDerivedBridges.length : result.prefilledBridges ?? 0 };
    } else if (evidence.kind === 'portable-generation@1') {
      const receipt = JSON.parse(io.read(evidence.parameters.receipt).toString('utf8'));
      text(receipt.target, 'recorded generation target');
      assert.ok(receipt.milestoneAccepted == null || typeof receipt.milestoneAccepted === 'boolean', 'recorded milestoneAccepted must be boolean or null');
      actual = { target: receipt.target, milestoneAccepted: receipt.milestoneAccepted ?? null };
    } else {
      const run = JSON.parse(io.read(evidence.parameters.runReceipt).toString('utf8'));
      assert.ok(Number.isInteger(run.exitCode), 'explicit execution exitCode required');
      assert.equal(typeof run.waited, 'boolean', 'explicit execution waited required');
      assert.equal(typeof run.timedOut, 'boolean', 'explicit execution timedOut required');
      actual = { exitCode: run.exitCode, waited: run.waited, timedOut: run.timedOut };
    }
    assert.deepEqual(pointerValue(recorded0, evidence.resultPointer), actual, 'recorded execution outcome differs from recomputed artifact');
    return { kind: evidence.kind, state: 'recorded-summary-only', receipts, sourceSnapshotSha256: source.sha256,
      sourceFiles: evidence.sourceFiles, references: evidence.references, recordedSummary: actual,
      originalItemCertified: false, executionVerified: false,
      limitation: 'Only hashes and JSON summary agreement were checked. Execution logs, commands, classpath, output inventory, license applicability and historical source binding have not been verified.' };
  }
  else {
    mustBeInventoried(snapshot, parameters.root, false);
    assert.ok(source.sources.some(s => s.file === parameters.mappings.file && s.sha256 === parameters.mappings.sha256), 'mapping bytes must belong to source snapshot');
  }
  const provenance = await import('./v1-release-provenance.mjs');
  const actual = evidence.kind === 'generated-provenance@1'
    ? await provenance.verifyGeneratedProvenance(parameters.target, source.request, { afterBuild: parameters.afterBuild })
    : evidence.kind === 'stable-generation@1'
      ? provenance.verifyStableGeneration(parameters.left, parameters.right, { afterBuild: parameters.afterBuild })
      : await provenance.verifyHandwrittenProvenance(parameters.root, source.request, JSON.parse(io.read(parameters.mappings).toString('utf8')));
  const recorded = JSON.parse(io.read(evidence.receipts[0]).toString('utf8'));
  assert.deepEqual(pointerValue(recorded, evidence.resultPointer), actual, 'actual verifier outcome differs from receipt bytes');
  return { kind: evidence.kind, state: 'subset-verified', receipts, sourceSnapshotSha256: source.sha256,
    sourceFiles: evidence.sourceFiles, references: evidence.references, actual,
    originalItemCertified: false,
    limitation: 'Concrete provenance verification is not full original-item acceptance, legal-increment runtime proof, or portable delivery.' };
}
function blankSlots() {
  return REQUIRED_SLOTS.map(s => ({ ...s, localStatus: 'unexecuted', status: 'unexecuted', evidence: [],
    reason: 'Required original phase slot has no executed, source-bound evidence.' }));
}
function reportBase(manifest) {
  return { schemaVersion: REPORT_SCHEMA, manifestSchemaVersion: MANIFEST_SCHEMA,
    manifestSha256: manifest === undefined ? null : digest(manifest),
    indexing: 'phase-local filing indices; not exact formal original package names', phaseCounts: PHASE_COUNTS,
    slots: blankSlots(), sourceSnapshot: { status: 'unexecuted' }, problems: [],
    allOriginalRequiredProven: false, accepted: false, distCreated: false,
    sourceCoverage: 'Complete supplied inventories are verified; completeness of the declared release source scope is not auto-certified.',
    unsupported: [
      'No full-original-item certifier is registered. Manual declarations and concrete subset verifiers cannot close any original acceptance item.',
      'No controlled BC/build/test/recovery/service execution permit or portable ext/supply/clean-cache/delivery API is integrated.',
      'No modern Mongo compatibility certification is inferred from LevelDB, H2, isolated Mongo 4.4, or older browser/database evidence.'
    ] };
}
function finish(report) {
  const slots = new Map(report.slots.map(s => [s.index, s]));
  for (const slot of report.slots) {
    slot.blockedBy = slot.dependsOn.filter(index => slots.get(index).status !== 'proven');
    if (slot.blockedBy.length && !['failed', 'unexecuted', 'skipped'].includes(slot.localStatus)) slot.status = 'blocked';
  }
  report.allOriginalRequiredProven = report.slots.length === 25 && report.slots.every(s => s.required && s.status === 'proven');
  // Acceptance additionally needs the actual executor/delivery, absent in v1.
  report.status = report.problems.length || report.slots.some(s => s.localStatus === 'failed') ? 'failed' : 'blocked';
  report.exitCode = report.status === 'failed' ? 1 : 2;
  return report;
}

// Read-only, no dependency injection of pass flags, commands, verifier callbacks,
// or substitute result arrays. Missing slots are synthesized, never omitted.
export async function evaluate(manifest) {
  const report = reportBase(manifest);
  if (manifest === undefined) return finish(report);
  const io = reader();
  try {
    validateManifest(manifest);
    if (!manifest.sourceSnapshot) {
      report.sourceSnapshot = { status: 'blocked', reason: 'No source snapshot supplied; evidence cannot be evaluated.' };
      for (const slot of report.slots) {
        const entry = manifest.slots.find(s => s.index === slot.index);
        if (!entry) continue;
        slot.localStatus = slot.status = entry.status === 'attested' ? 'blocked' : entry.status;
        slot.reason = entry.status === 'attested' ? 'Attestation has no source snapshot.' : entry.reason ?? 'Not executed.';
      }
      return finish(report);
    }
    const source = verifySnapshot(manifest.sourceSnapshot, io);
    report.sourceSnapshot = { status: 'verified', sha256: source.sha256, request: manifest.sourceSnapshot.request,
      inventories: manifest.sourceSnapshot.inventories, files: source.sources.length };
    for (const slot of report.slots) {
      const entry = manifest.slots.find(s => s.index === slot.index);
      if (!entry) continue;
      slot.localStatus = slot.status = entry.status;
      slot.reason = entry.reason ?? (entry.status === 'attested' ? 'Evidence is not full original-item certification.' : 'Not executed.');
      try {
        for (const evidence of entry.evidence ?? []) slot.evidence.push(await verifyEvidence(evidence, manifest.sourceSnapshot, source, io));
        if (entry.status === 'attested') {
          const manual = slot.evidence.filter(e => e.kind === 'manual-owner-declared');
          const adverse = manual.find(e => e.declaredOutcome !== 'passed');
          const unverified = slot.evidence.some(e => e.state === 'recorded-summary-only');
          slot.localStatus = slot.status = adverse ? adverse.declaredOutcome
            : manual.length ? 'manual-owner-declared' : unverified ? 'blocked' : 'partial';
          if (unverified && !adverse) slot.reason = 'Recorded JSON summaries are not independently verified execution evidence.';
          if (adverse) slot.reason = 'Owner explicitly declared ' + adverse.declaredOutcome + '; no successful override is allowed.';
        }
      } catch (error) {
        slot.localStatus = slot.status = 'failed'; slot.reason = error.message;
        report.problems.push({ index: slot.index, message: error.message });
      }
    }
    snapshotStillMatches(manifest.sourceSnapshot, io);
  } catch (error) {
    report.problems.push({ stage: 'manifest-or-source', message: error.message });
    report.sourceSnapshot = { status: 'failed', reason: error.message };
    for (const slot of report.slots) if (['partial', 'manual-owner-declared', 'attested'].includes(slot.localStatus)) {
      slot.localStatus = slot.status = 'failed'; slot.reason = 'Source/receipt drift invalidates the evidence window.';
    }
  }
  return finish(report);
}

async function checkGeneration(manifest) {
  if (!manifest?.generation) return { status: 'unexecuted', reason: 'No explicit captured inputs and fresh dual-chain targets supplied.' };
  assert.ok(manifest.sourceSnapshot, 'generation planning requires a source snapshot');
  const { inputs, jsTarget, bcTarget } = manifest.generation;
  checkPlainPath(inputs); checkPlainPath(jsTarget, true); checkPlainPath(bcTarget, true);
  for (const root of [join(ROOT, 'v1/tree'), join(ROOT, 'v1/handwritten'), join(ROOT, 'v1/test'), join(ROOT, 'tools'), inputs]) mustBeInventoried(manifest.sourceSnapshot, root, false);
  assert.equal(manifest.sourceSnapshot.request.file, join(inputs, 'request.json'), 'snapshot must bind the selected captured request');
  const generation = await import('./v1-release-generation.mjs');
  generation.plainPath(inputs); generation.releaseTarget(jsTarget); generation.releaseTarget(bcTarget);
  assert.ok(jsTarget.endsWith('/js-app') && bcTarget.endsWith('/bc-app'), 'explicit JS and BC target selection required');
  const checked = generation.checkReleaseInputs(inputs);
  const { bankServiceRequest } = await import('./v1-service-inputs.mjs');
  assert.deepEqual(checked.request, bankServiceRequest(), 'capture does not equal current authored complete service request');
  const tasks = generation.bcReleaseTasks(inputs, bcTarget); // Fixed helper-produced tasks, never supplied shell/config.
  return { status: 'verified', inputs, jsTarget, bcTarget, bcTaskCount: tasks.length,
    generationRun: false, detail: 'Current-source admission and fresh-target planning only; generateReleaseJs and BC tasks were NOT executed.' };
}

export async function orchestrate(options = {}) {
  keys(options, ['mode', 'manifest'], ['mode'], 'orchestration options');
  const { mode, manifest } = options;
  assert.ok(mode === 'check' || mode === 'run', 'explicit check or run mode required');
  // Sequential, read-only actual steps; there is no arbitrary action dispatcher.
  const report = await evaluate(manifest);
  report.mode = mode;
  report.steps = [
    { step: 'source-snapshot', ...report.sourceSnapshot },
    { step: 'acceptance-evidence', status: report.status, detail: 'Actual evidence verification is recorded per original slot.' }
  ];
  if (report.status === 'failed') report.steps.push({ step: 'captured-input-admission', status: 'blocked', reason: 'Invalid manifest/source/evidence; no toolchain invocation.' });
  else {
    try { report.steps.push({ step: 'captured-input-admission', ...await checkGeneration(manifest) }); }
    catch (error) {
      report.steps.push({ step: 'captured-input-admission', status: 'failed', reason: error.message });
      report.problems.push({ stage: 'captured-input-admission', message: error.message });
    }
  }
  for (const step of ['js-generation', 'bc-generation', 'dual-chain-build-and-tests', 'recovery-http-and-database']) {
    report.steps.push({ step, status: mode === 'check' ? 'unexecuted' : 'blocked', reason: mode === 'check'
      ? 'Explicit --check forbids execution/source generation.'
      : 'No controlled complete-release executor and resource permit is integrated; no action started.' });
  }
  report.steps.push(
    { step: 'portable-supply-and-licenses', status: 'blocked', reason: 'No complete supply and license verifier is integrated; JSON summaries do not establish closure or artifact availability.' },
    { step: 'clean-cache-delivery', status: 'unexecuted', reason: 'No cold build is executed here. Recorded summaries do not verify historical execution, empty caches, full test coverage or deployment.' },
    { step: 'original-required-result-gate', status: report.allOriginalRequiredProven ? 'verified' : 'blocked', required: 25,
      reason: 'Only full original-item certification may satisfy the definitive gate; subset evidence and owner declarations are not automatic certification.' },
    { step: 'dist-promotion', status: 'blocked', reason: 'All original required results plus supply licensing closure must be proven. No dist writer is implemented or called.' }
  );
  // Imports/validation must not invalidate the source window observed above.
  if (manifest?.sourceSnapshot && report.sourceSnapshot.status === 'verified') {
    try { verifySnapshot(manifest.sourceSnapshot, reader()); }
    catch (error) {
      report.problems.push({ stage: 'final-source-recheck', message: error.message });
      report.sourceSnapshot.status = 'failed';
      for (const slot of report.slots) if (['partial', 'manual-owner-declared'].includes(slot.localStatus)) slot.localStatus = slot.status = 'failed';
    }
  }
  return finish(report);
}

export function parseArgs(args) {
  list(args, 'arguments');
  const result = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    assert.ok(['--check', '--run', '--manifest', '--output', '--execution'].includes(flag), 'unknown argument: ' + flag);
    assert.ok(!seen.has(flag), 'duplicate argument: ' + flag); seen.add(flag);
    if (flag === '--check' || flag === '--run') {
      assert.ok(!result.mode, 'choose exactly one of --check and --run'); result.mode = flag.slice(2);
    } else {
      const value = args[++i];
      assert.ok(typeof value === 'string' && !value.startsWith('--'), 'missing value for ' + flag);
      result[flag.slice(2)] = checkPlainPath(value, flag === '--output');
    }
  }
  assert.ok(result.mode, 'explicit --check or --run required');
  if (result.output) {
    assert.ok(result.output.startsWith(join(ROOT, '.scratch') + '/') && result.output.endsWith('.json'), 'CLI report must be a fresh JSON file under bank .scratch');
    assert.ok(lstatSync(checkPlainPath(dirname(result.output))).isDirectory(), 'existing report parent required; no directories are created');
  }
  return result;
}

// Data-only exclusive output. Existing/dangling links, aliases, overwrite and
// implicit mkdir are rejected. The CLI further confines this to bank .scratch.
export function writeReport(file, report) {
  assert.equal(report.schemaVersion, REPORT_SCHEMA, 'release report required');
  assert.ok(report.accepted === false && report.distCreated === false && report.allOriginalRequiredProven === false,
    'this read-only implementation cannot write a supplied successful release certification');
  checkPlainPath(file, true);
  assert.ok(lstatSync(checkPlainPath(dirname(file))).isDirectory(), 'existing output parent required');
  assert.ok(![join(ROOT, 'dist'), join(ROOT, 'target')].some(root => file === root || file.startsWith(root + '/')), 'report cannot create delivery/generated output');
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); }
  finally { closeSync(fd); }
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.execution) {
    assert.ok(!options.manifest && !options.output, 'execution configuration cannot be combined with v1 evidence manifests or output');
    const config = JSON.parse(readBytes(options.execution).toString('utf8'));
    const { checkExecution, runExecution } = await import('./v1-release-orchestrate.mjs');
    return options.mode === 'check' ? { ...checkExecution(config), exitCode: 2 } : runExecution(config, options.execution);
  }
  const bytes = options.manifest ? readBytes(options.manifest) : undefined;
  const report = await orchestrate({ mode: options.mode, manifest: bytes ? JSON.parse(bytes.toString('utf8')) : undefined });
  if (options.manifest) {
    assert.ok(readBytes(options.manifest).equals(bytes), 'manifest changed during validation');
    report.manifestFile = { file: options.manifest, sha256: hash(bytes), bytes: bytes.length };
  }
  if (options.output) writeReport(options.output, report);
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await main();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exitCode = report.exitCode;
  } catch (error) {
    process.stderr.write(JSON.stringify({ schemaVersion: REPORT_SCHEMA, status: 'failed', accepted: false, distCreated: false,
      error: error.message, usage: '--check|--run [--manifest /absolute/manifest.json] [--output /absolute/bank/.scratch/fresh-report.json]' }) + '\n');
    process.exitCode = 1;
  }
}
