import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MANIFEST_SCHEMA, REPORT_SCHEMA, PHASE_COUNTS, REQUIRED_SLOTS, checkPlainPath, evaluate, main, orchestrate, parseArgs, validateManifest, writeReport } from '../tools/v1-release.mjs';

const BANK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const fileRef = file => ({ file, sha256: sha(readFileSync(file)) });
const save = (file, value) => writeFileSync(file, JSON.stringify(value) + '\n', { flag: 'wx' });
const key = 'source:fixture#/artifacts/0';
const request = { documents: [{ id: 'fixture', schemaVersion: 'truthsrc/v1', value: {
  version: 'root-version', artifacts: [{ version: '1', name: 'Fixture' }], 'slash/key': { '~value': 7 }
} }] };
const sourceReference = () => {
  const documentSha = sha(JSON.stringify(request.documents[0].value));
  return { knowledgeKey: key, document: 'fixture', pointer: '/artifacts/0', schemaVersion: 'truthsrc/v1',
    documentSha, valueSha: sha(JSON.stringify(request.documents[0].value.artifacts[0])), definitionVersion: '1',
    sourceVersion: { kind: 'document-content-sha256', value: documentSha } };
};
function inventory(root) {
  const files = {};
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name), relative = prefix + name;
      if (lstatSync(file).isDirectory()) walk(file, relative + '/');
      else files[relative] = sha(readFileSync(file));
    }
  }
  walk(root); return files;
}
const sourceFiles = snapshot => snapshot.inventories.flatMap(i => Object.entries(i.files).map(([file, sha256]) => ({ file: join(i.root, file), sha256 })));
async function fresh(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bank-v1-release-')));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function fixture(root) {
  const source = join(root, 'source'); mkdirSync(source);
  const requestFile = join(source, 'request.json'); save(requestFile, request);
  writeFileSync(join(source, 'Owner.scala'), 'object Owner {}\n', { flag: 'wx' });
  const receipt = join(root, 'actual.json');
  save(receipt, { schemaVersion: 'fixture-receipt/v1', exitCode: 0, waited: true, actualScope: 'fixture only, not a bank acceptance run' });
  const sourceSnapshot = { request: fileRef(requestFile), inventories: [{ root: source, afterBuild: false, files: inventory(source) }] };
  const evidence = { kind: 'manual-owner-declared', owner: 'fixture-owner', declaredOutcome: 'passed',
    scope: 'Explicit fixture association; no real acceptance is claimed', limitations: ['Not a bank release receipt'],
    receipts: [fileRef(receipt)], sourceFiles: sourceFiles(sourceSnapshot), references: [sourceReference()] };
  const manifest = { schemaVersion: MANIFEST_SCHEMA, sourceSnapshot,
    slots: [{ index: 'P26:1', status: 'attested', evidence: [evidence] }] };
  return { source, receipt, requestFile, evidence, manifest };
}
const slot = (report, index = 'P26:1') => report.slots.find(s => s.index === index);
const notReleased = report => {
  assert.equal(report.accepted, false); assert.equal(report.allOriginalRequiredProven, false);
  assert.equal(report.distCreated, false); assert.equal(report.slots.length, 25);
  assert.ok(report.exitCode === 1 || report.exitCode === 2);
};

// These tests construct private byte fixtures only. They never start child
// processes, build applications, invoke generators, copy ext, or promote dist.
test('original phase slots preserve 25 filing indices and immutable required dependencies', () => {
  assert.deepEqual(PHASE_COUNTS, { P26: 3, P27: 5, P28: 3, P29: 3, P30: 4, P31: 4, P32: 3 });
  assert.equal(REQUIRED_SLOTS.length, 25); assert.equal(new Set(REQUIRED_SLOTS.map(s => s.index)).size, 25);
  assert.deepEqual(REQUIRED_SLOTS.find(s => s.index === 'P27:1').dependsOn, ['P26:1', 'P26:2', 'P26:3']);
  assert.deepEqual(REQUIRED_SLOTS.find(s => s.index === 'P31:1').dependsOn, REQUIRED_SLOTS.filter(s => ['P26', 'P27', 'P28', 'P29', 'P30'].includes(s.phase)).map(s => s.index));
  assert.deepEqual(REQUIRED_SLOTS.find(s => s.index === 'P32:1').dependsOn, ['P31:1', 'P31:2', 'P31:3', 'P31:4']);
  assert.ok(REQUIRED_SLOTS.every(s => s.required && Object.isFrozen(s) && Object.isFrozen(s.dependsOn)));
});

test('absent manifest and empty slots fail closed with structured unexecuted/blocked results', async () => {
  for (const manifest of [undefined, { schemaVersion: MANIFEST_SCHEMA, slots: [] }]) {
    const report = await evaluate(manifest); notReleased(report);
    assert.equal(report.exitCode, 2); assert.equal(report.status, 'blocked');
    assert.ok(report.slots.every(s => s.status === 'unexecuted'));
  }
  const report = await main(['--check']); notReleased(report);
  assert.equal(report.mode, 'check');
  assert.equal(report.steps.find(s => s.step === 'js-generation').status, 'unexecuted');
  assert.equal(report.steps.find(s => s.step === 'portable-supply-and-licenses').status, 'blocked');
});

test('missing snapshot cannot hide declared failed/skipped/blocked or promote attested evidence', async () => fresh(async root => {
  const { manifest } = fixture(root); delete manifest.sourceSnapshot;
  manifest.slots.push({ index: 'P26:2', status: 'failed', reason: 'Actual failure remains' },
    { index: 'P26:3', status: 'skipped', reason: 'Not executed' },
    { index: 'P27:1', status: 'blocked', reason: 'No permit' });
  const report = await evaluate(manifest); notReleased(report);
  assert.equal(slot(report).status, 'blocked'); assert.equal(slot(report, 'P26:2').status, 'failed');
  assert.equal(slot(report, 'P26:3').status, 'skipped'); assert.equal(report.exitCode, 1);
}));

test('a byte-bound owner declaration exposes actual receipts but never auto-certifies original acceptance', async () => fresh(async root => {
  const { manifest, receipt, evidence } = fixture(root);
  const report = await evaluate(manifest); notReleased(report);
  assert.equal(report.sourceSnapshot.status, 'verified'); assert.equal(slot(report).status, 'manual-owner-declared');
  const actual = slot(report).evidence[0];
  assert.equal(actual.declaredOutcome, 'passed'); assert.equal(actual.originalItemCertified, false);
  assert.equal(actual.receipts[0].file, receipt); assert.equal(actual.receipts[0].sha256, evidence.receipts[0].sha256);
  assert.equal(actual.receipts[0].bytes, readFileSync(receipt).length);
  assert.equal(actual.receipts[0].recorded.exitCode, 0); assert.deepEqual(actual.references, evidence.references);
  assert.equal(actual.sourceSnapshotSha256, report.sourceSnapshot.sha256);
  assert.match(actual.sourceWindowBinding, /historical execution not auto-certified/u);
}));

test('25 declared passes and subset counts do not close the original result gate or phase dependencies', async () => fresh(async root => {
  const { manifest, evidence } = fixture(root);
  manifest.slots = REQUIRED_SLOTS.map(s => ({ index: s.index, status: 'attested', evidence: [structuredClone(evidence)] }));
  const report = await evaluate(manifest); notReleased(report);
  assert.equal(report.status, 'blocked'); assert.ok(report.slots.every(s => s.localStatus === 'manual-owner-declared'));
  assert.equal(slot(report, 'P27:1').status, 'blocked');
  assert.deepEqual(slot(report, 'P27:1').blockedBy, ['P26:1', 'P26:2', 'P26:3']);
  assert.equal(slot(report, 'P32:3').status, 'blocked'); assert.equal(slot(report, 'P32:3').blockedBy.length, 4);
}));

test('unexecuted, skipped, blocked, and failed evidence cannot be overridden by a declared pass', async () => fresh(async root => {
  for (const status of ['unexecuted', 'skipped', 'blocked', 'failed']) {
    const { manifest, evidence } = fixture(joinFixture(root, status));
    manifest.slots[0].status = status; manifest.slots[0].reason = 'Original result ' + status;
    const report = await evaluate(manifest); notReleased(report);
    assert.equal(slot(report).status, status);
    assert.equal(slot(report).evidence[0].declaredOutcome, evidence.declaredOutcome);
    assert.equal(report.exitCode, status === 'failed' ? 1 : 2);
  }
}));
function joinFixture(root, name) { const directory = join(root, name); mkdirSync(directory); return directory; }

test('adverse manual outcome survives a second declaration of success', async () => fresh(async root => {
  const { manifest, evidence } = fixture(root);
  const failed = structuredClone(evidence); failed.declaredOutcome = 'failed';
  manifest.slots[0].evidence.push(failed);
  const report = await evaluate(manifest); notReleased(report);
  assert.equal(slot(report).status, 'failed'); assert.equal(report.exitCode, 1);
}));

test('unknown versions, duplicate/misnumbered slots, pass flags and dependency overrides are rejected', async () => fresh(async root => {
  const { manifest } = fixture(root);
  for (const mutate of [
    m => { m.schemaVersion = 'bank-v1-release-manifest/v2'; },
    m => { m.slots.push(structuredClone(m.slots[0])); },
    m => { m.slots[0].index = 'P26-1'; },
    m => { m.slots[0].index = 'P27:6'; },
    m => { m.slots[0].status = 'passed'; },
    m => { m.pass = true; }, m => { m.accepted = true; },
    m => { m.slots[0].required = false; }, m => { m.slots[0].dependsOn = []; },
    m => { m.slots[0].evidence[0].pass = true; },
    m => { m.slots[0].evidence[0].receipts[0].pass = true; },
    m => { m.commands = ['sh -c arbitrary']; }
  ]) {
    const invalid = structuredClone(manifest); mutate(invalid);
    assert.throws(() => validateManifest(invalid));
    const report = await evaluate(invalid); notReleased(report); assert.equal(report.exitCode, 1);
  }
}));

test('missing, altered or falsely fingerprinted actual receipts fail closed', async () => fresh(async root => {
  for (const mode of ['missing', 'tampered', 'wrong-hash', 'bad-json']) {
    const { manifest, receipt, evidence } = fixture(joinFixture(root, mode));
    if (mode === 'missing') rmSync(receipt);
    if (mode === 'tampered') writeFileSync(receipt, '{"exitCode":9}\n');
    if (mode === 'wrong-hash') evidence.receipts[0].sha256 = 'sha256:' + '0'.repeat(64);
    if (mode === 'bad-json') { writeFileSync(receipt, '{broken'); evidence.receipts[0] = fileRef(receipt); }
    const report = await evaluate(manifest); notReleased(report);
    assert.equal(slot(report).localStatus, 'failed'); assert.equal(report.exitCode, 1);
  }
}));

test('changed, missing and added source files invalidate the complete declared inventory', async () => fresh(async root => {
  for (const mode of ['changed', 'missing', 'added']) {
    const { manifest, source } = fixture(joinFixture(root, mode));
    if (mode === 'changed') writeFileSync(join(source, 'Owner.scala'), 'changed\n');
    if (mode === 'missing') rmSync(join(source, 'Owner.scala'));
    if (mode === 'added') writeFileSync(join(source, 'Unrecorded.scala'), 'new\n');
    const report = await evaluate(manifest); notReleased(report);
    assert.equal(report.sourceSnapshot.status, 'failed'); assert.equal(report.exitCode, 1);
  }
}));

test('an old receipt cannot use a changed source window or selective subset of the current snapshot', async () => fresh(async root => {
  const { manifest, source, evidence } = fixture(root);
  writeFileSync(join(source, 'New.scala'), 'new source\n');
  manifest.sourceSnapshot.inventories[0].files = inventory(source);
  let report = await evaluate(manifest); notReleased(report); assert.equal(slot(report).localStatus, 'failed');
  assert.match(slot(report).reason, /complete supplied source snapshot/u);
  evidence.sourceFiles = sourceFiles(manifest.sourceSnapshot);
  evidence.sourceFiles.pop();
  report = await evaluate(manifest); notReleased(report); assert.equal(slot(report).localStatus, 'failed');
}));

test('full request bytes must be inventoried, unambiguous and equal to their declared hash', async () => fresh(async root => {
  for (const mode of ['uninventoried', 'stale-bytes', 'duplicate-document']) {
    const { manifest, requestFile, source, evidence } = fixture(joinFixture(root, mode));
    if (mode === 'uninventoried') {
      const elsewhere = join(dirname(source), 'outside-request.json'); save(elsewhere, request);
      manifest.sourceSnapshot.request = fileRef(elsewhere);
    } else if (mode === 'stale-bytes') writeFileSync(requestFile, JSON.stringify(request) + '\n\n');
    else {
      writeFileSync(requestFile, JSON.stringify({ documents: [...request.documents, ...request.documents] }));
      manifest.sourceSnapshot.request = fileRef(requestFile);
      manifest.sourceSnapshot.inventories[0].files = inventory(source); evidence.sourceFiles = sourceFiles(manifest.sourceSnapshot);
    }
    const report = await evaluate(manifest); notReleased(report); assert.equal(report.exitCode, 1);
  }
}));

test('source pointers, full versions and content hashes cannot be fabricated', async () => fresh(async root => {
  const { manifest } = fixture(root);
  for (const mutate of [
    ref => { ref.knowledgeKey = 'source:missing#/artifacts/0'; },
    ref => { ref.knowledgeKey = 'source:fixture#/artifacts/1'; },
    ref => { ref.knowledgeKey = 'source:fixture#/slash~2key'; },
    ref => { ref.knowledgeKey = 'source:fixture#/__proto__'; },
    ref => { ref.knowledgeKey = 'source:fixture#/artifacts/length'; },
    ref => { ref.valueSha = 'sha256:' + '0'.repeat(64); },
    ref => { ref.documentSha = 'sha256:' + '0'.repeat(64); },
    ref => { ref.definitionVersion = 'invented'; },
    ref => { ref.schemaVersion = 'invented'; },
    ref => { ref.sourceVersion.value = 'sha256:' + '0'.repeat(64); },
    ref => { delete ref.pointer; }
  ]) {
    const invalid = structuredClone(manifest); mutate(invalid.slots[0].evidence[0].references[0]);
    const report = await evaluate(invalid); notReleased(report); assert.equal(slot(report).localStatus, 'failed');
  }
}));

test('relative paths, traversal, noncanonical inventories and symlink inputs are rejected', async () => fresh(async root => {
  const { manifest, source, receipt } = fixture(root);
  const alias = join(root, 'alias'); symlinkSync(source, alias);
  const receiptAlias = join(root, 'receipt-alias.json'); symlinkSync(receipt, receiptAlias);
  const dangling = join(root, 'dangling'); symlinkSync(join(root, 'absent'), dangling);
  for (const path of ['relative', root + '/../traversal', root + '//double', root + '/nul\0', root + '/back\\slash', alias, join(alias, 'fresh'), dangling]) {
    assert.throws(() => checkPlainPath(path, true));
  }
  const invalid = structuredClone(manifest); invalid.slots[0].evidence[0].receipts[0].file = receiptAlias;
  let report = await evaluate(invalid); notReleased(report); assert.equal(slot(report).localStatus, 'failed');
  symlinkSync(receipt, join(source, 'linked.json'));
  report = await evaluate(manifest); notReleased(report); assert.equal(report.sourceSnapshot.status, 'failed');
  for (const file of ['../escape', './dot', '/absolute', 'nested//double', 'back\\slash']) {
    const bad = structuredClone(manifest); bad.sourceSnapshot.inventories[0].files[file] = sha('anything');
    assert.throws(() => validateManifest(bad));
  }
}));

function stableFixture(root) {
  const f = fixture(root), left = join(root, 'left'), right = join(root, 'right');
  for (const target of [left, right]) {
    mkdirSync(target); writeFileSync(join(target, 'Fixture.scala'), 'object Fixture {}\n');
    save(join(target, 'truthsrc.ledger.json'), { entries: [] });
    save(join(target, 'anchors.json'), { version: 'fixture', anchors: { [key]: [{ repo: target, file: 'Fixture.scala' }] } });
    f.manifest.sourceSnapshot.inventories.push({ root: target, afterBuild: false, files: inventory(target) });
  }
  const actual = { left, right, files: 3, inventory: inventory(left), normalizedOnly: ['anchors.json:anchors.*[].repo'], stable: true };
  const receipt = join(root, 'stable-receipt.json'); save(receipt, { actual });
  const evidence = { kind: 'stable-generation@1', receipts: [fileRef(receipt)], sourceFiles: sourceFiles(f.manifest.sourceSnapshot),
    references: [sourceReference()], resultPointer: '/actual', parameters: { left, right, afterBuild: false } };
  f.manifest.slots = [{ index: 'P31:3', status: 'attested', evidence: [evidence] }];
  return { ...f, left, right, actual, evidence, stableReceipt: receipt };
}

test('known stable-generation verifier recomputes actual files but is only subset evidence, not original P31 acceptance', async () => fresh(async root => {
  const { manifest, actual } = stableFixture(root);
  const report = await evaluate(manifest); notReleased(report);
  const verified = slot(report, 'P31:3');
  assert.equal(verified.localStatus, 'partial'); assert.equal(verified.status, 'blocked');
  assert.equal(verified.evidence[0].state, 'subset-verified'); assert.deepEqual(verified.evidence[0].actual, actual);
  assert.equal(verified.evidence[0].originalItemCertified, false);
}));

test('a supplied true verifier result cannot override a different actual result', async () => fresh(async root => {
  const { manifest, stableReceipt, actual, evidence } = stableFixture(root);
  writeFileSync(stableReceipt, JSON.stringify({ actual: { ...actual, files: 999, stable: true } }));
  evidence.receipts[0] = fileRef(stableReceipt);
  const report = await evaluate(manifest); notReleased(report);
  assert.equal(slot(report, 'P31:3').localStatus, 'failed');
  assert.match(slot(report, 'P31:3').reason, /actual verifier outcome differs/u);
}));

test('concrete verifier rejects unsafe scope/configuration before invoking the public toolchain', async () => fresh(async root => {
  const { manifest } = stableFixture(root);
  for (const mutate of [
    e => { e.kind = 'run-arbitrary-command'; },
    e => { e.parameters.command = 'touch dist/v1'; },
    e => { e.parameters.right = e.parameters.left; },
    e => { e.parameters.right = join(root, 'undeclared'); },
    e => { e.resultPointer = 'not-a-pointer'; },
    e => { e.kind = 'generated-provenance@1'; e.parameters = { target: join(root, 'undeclared'), afterBuild: false }; },
    e => { e.kind = 'handwritten-provenance@1'; e.parameters = { root: manifest.sourceSnapshot.inventories[0].root, mappings: fileRef(join(root, 'actual.json')) }; }
  ]) {
    const invalid = structuredClone(manifest); mutate(invalid.slots[0].evidence[0]);
    const report = await evaluate(invalid); notReleased(report); assert.equal(report.exitCode, 1);
  }
  const wrongSlot = structuredClone(manifest); wrongSlot.slots[0].index = 'P26:1';
  assert.throws(() => validateManifest(wrongSlot), /only supporting P31/u);
}));

test('occupied generation targets cause a failed preflight and no new target or dist', async () => fresh(async root => {
  const { manifest, source } = fixture(root);
  const jsTarget = join(root, 'js-app'); mkdirSync(jsTarget);
  const bcTarget = join(root, 'bc-app');
  manifest.generation = { inputs: source, jsTarget, bcTarget };
  const report = await orchestrate({ mode: 'run', manifest }); notReleased(report);
  assert.equal(report.steps.find(s => s.step === 'captured-input-admission').status, 'failed');
  assert.equal(existsSync(bcTarget), false); assert.equal(existsSync(join(root, 'dist')), false);
}));

test('--run transparently blocks execution and leaves owned fixture bytes and directory inventory unchanged', async () => fresh(async root => {
  const { manifest } = fixture(root);
  const manifestFile = join(root, 'manifest.json'); save(manifestFile, manifest);
  const before = inventory(root), distWasPresent = existsSync(join(BANK, 'dist/v1'));
  const report = await main(['--run', '--manifest', manifestFile]); notReleased(report);
  assert.equal(report.mode, 'run'); assert.deepEqual(inventory(root), before);
  assert.equal(existsSync(join(BANK, 'dist/v1')), distWasPresent);
  assert.equal(report.steps.find(s => s.step === 'js-generation').status, 'blocked');
  assert.equal(report.steps.find(s => s.step === 'bc-generation').status, 'blocked');
  assert.equal(report.steps.find(s => s.step === 'clean-cache-delivery').status, 'unexecuted');
  assert.equal(report.steps.find(s => s.step === 'dist-promotion').status, 'blocked');
  assert.equal(report.manifestFile.sha256, sha(readFileSync(manifestFile)));
  await assert.rejects(orchestrate({ mode: 'run', manifest, pass: true }), /unknown field/u);
  await assert.rejects(orchestrate({ mode: 'run', manifest, executor: () => assert.fail('not permitted') }), /unknown field/u);
}));

test('CLI requires one explicit mode and strictly rejects unknown/duplicate/unsafe arguments', async () => fresh(async root => {
  const input = join(root, 'manifest.json'); save(input, { schemaVersion: MANIFEST_SCHEMA, slots: [] });
  assert.deepEqual(parseArgs(['--check']), { mode: 'check' });
  assert.deepEqual(parseArgs(['--run', '--manifest', input]), { mode: 'run', manifest: input });
  for (const args of [[], ['--check', '--run'], ['--check', '--check'], ['--check', '--unknown'], ['--pass', 'true'],
    ['--check', '--manifest'], ['--check', '--manifest', '--output'], ['--check', '--manifest', input, '--manifest', input],
    ['--check', '--manifest', 'relative'], ['--check', '--manifest=' + input], ['--check', '--'],
    ['--check', '--output', join(root, 'outside-bank.json')], ['--check', '--output', input],
    ['--check', '--output', join(BANK, 'dist/v1/report.json')], ['--check', '--output', join(BANK, '.scratch/missing-parent-fixture/report.json')]
  ]) assert.throws(() => parseArgs(args));
  assert.equal(readFileSync(input, 'utf8'), JSON.stringify({ schemaVersion: MANIFEST_SCHEMA, slots: [] }) + '\n');
}));

test('report writes are exclusive, do not create parents, reject links and cannot certify supplied success', async () => fresh(async root => {
  const report = await evaluate();
  const output = join(root, 'report.json'); writeReport(output, report);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).schemaVersion, REPORT_SCHEMA);
  const before = readFileSync(output); assert.throws(() => writeReport(output, report), /already exists/u);
  assert.ok(readFileSync(output).equals(before));
  const alias = join(root, 'alias'); symlinkSync(root, alias);
  const dangling = join(root, 'dangling.json'); symlinkSync(join(root, 'missing'), dangling);
  for (const path of [join(alias, 'fresh.json'), dangling, join(root, 'absent-parent/report.json'), join(BANK, 'dist/v1/report.json')]) {
    assert.throws(() => writeReport(path, report));
  }
  assert.equal(existsSync(join(root, 'absent-parent')), false);
  const forged = join(root, 'forged.json');
  assert.throws(() => writeReport(forged, { ...report, accepted: true })); assert.equal(existsSync(forged), false);
}));

test('execution-receipt verifiers recompute supply/cold/portable/mysql artifacts within their mapped slots only', async () => fresh(async root => {
  const f = fixture(root);
  const supplyManifest = join(root, 'SUPPLY-MANIFEST.json');
  save(supplyManifest, { schemaVersion: 'bank-existing-supply-manifest/v1', status: 'captured-blocked', files: [{ file: 'maven/a.jar' }], unresolved: [{ code: 'missing-license-evidence' }, { code: 'missing-license-evidence' }] });
  const supplyReceipt = join(root, 'supply-receipt.json');
  const supplyActual = { schemaVersion: 'bank-existing-supply-manifest/v1', status: 'captured-blocked', fileCount: 1, unresolvedCount: 2, unresolvedCodes: ['missing-license-evidence', 'missing-license-evidence'] };
  save(supplyReceipt, supplyActual);
  const coldResult = join(root, 'cold-result.json'), coldActual = { schemaVersion: 'bank-cold-build/v1', status: 'passed', noNetwork: true, sourceUnchanged: true, suppliesUnchanged: true, testPhase: true, prefilledBridges: 1 };
  save(coldResult, coldActual);
  const coldReceipt = coldResult;
  const portableReceipt = join(root, 'portable.json'); save(portableReceipt, { target: '/abs/js-app', milestoneAccepted: false });
  const mysqlRun = join(root, 'mysql-run.json'); save(mysqlRun, { exitCode: 0, waited: true, timedOut: false });
  const entries = [
    { index: 'P32:1', kind: 'supply-manifest@1', receipt: supplyReceipt, parameters: { manifest: fileRef(supplyManifest) }, actual: supplyActual },
    { index: 'P32:2', kind: 'cold-build@1', receipt: coldResult, parameters: { result: fileRef(coldResult) }, actual: coldActual },
    { index: 'P32:1', kind: 'portable-generation@1', receipt: portableReceipt, parameters: { receipt: fileRef(portableReceipt) } },
    { index: 'P31:2', kind: 'mysql-negative@1', receipt: mysqlRun, parameters: { runReceipt: fileRef(mysqlRun) }, actual: { exitCode: 0, waited: true, timedOut: false } }
  ];
  const byIndex = new Map();
  for (const e of entries) {
    const evidence = { kind: e.kind, receipts: [fileRef(e.receipt)], sourceFiles: sourceFiles(f.manifest.sourceSnapshot),
      references: [sourceReference()], resultPointer: '', parameters: e.parameters };
    byIndex.set(e.index, byIndex.get(e.index) ?? []);
    byIndex.get(e.index).push(evidence);
  }
  f.manifest.slots = [...byIndex.entries()].map(([index, evidence]) => ({ index, status: 'attested', evidence }));
  const report = await evaluate(f.manifest); notReleased(report);
  for (const [index] of byIndex) { if (slot(report, index).localStatus !== 'partial') console.error('SLOT', index, slot(report, index).localStatus, slot(report, index).reason, slot(report, index).reason + ' | ' + JSON.stringify(slot(report, index).evidence.map(e => [e.kind, e.state]))); assert.equal(slot(report, index).localStatus, 'partial'); assert.equal(slot(report, index).status, 'blocked'); }
  // tampered receipt no longer matches the recomputed artifact (direct overwrite; save() is exclusive-create)
  writeFileSync(coldResult, JSON.stringify({ ...coldActual, status: 'blocked' }, null, 2) + '\n');
  const tampered = await evaluate(f.manifest); notReleased(tampered);
  assert.equal(tampered.exitCode, 1);
  // P32 verifier kinds cannot be filed under a business slot
  const wrongSlot = structuredClone(f.manifest);
  wrongSlot.slots[0].index = 'P27:2';
  assert.throws(() => validateManifest(wrongSlot), /only supporting P32:1/u);
}));
