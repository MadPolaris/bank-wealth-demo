import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, cpSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compileTree, compileTreeWithSources } from '../../metarch-truthsrc/lib/compile.mjs';
import { relatedNarrativeSources } from '../../metarch-truthsrc/lib/project/narrative-links.mjs';
import { validateTree } from '../../metarch-truthsrc/lib/validate.mjs';
import { roundtrip } from '../../metarch-truthsrc/lib/roundtrip.mjs';
import { captureProject, projectCli } from '../../metarch-truthsrc/lib/project/cli.mjs';
import { queryProject, statusProject } from '../../metarch-truthsrc/lib/project/query.mjs';
import { deriveProjectRequest } from '../../metarch-truthsrc/lib/project/derive.mjs';
import { compileProductSet } from '../../metarch-truthsrc/lib/products/compile.mjs';
import { tmpdir } from 'node:os';
import { readHistoricalFile } from '../tools/historical-source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tree = join(ROOT, 'truth/bank-wealth'), project = join(ROOT, 'truthsrc.project.json');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = json(join(ROOT, 'docs/TRUTH-LEGACY-BASELINE.json'));
const current = JSON.parse(compileTree(tree));
const beforeCompatibleStore = value => {
  const result = structuredClone(value);
  const artifacts = Array.isArray(result) ? result : result.artifacts;
  const service = artifacts.find(a => a.id === 'bank-service')?.deployment.service;
  assert.equal(service?.projectionStore?.schemaVersion, 'truthsrc.journal-readside/v1');
  assert.equal(service.projectionStore.id, 'BankJournalReadside');
  delete service.projectionStore;
  return result;
};

test('one root entry names current bank source; four execution flows retain all original semantics', () => {
  assert.equal(json(project).tree, 'truth/bank-wealth');
  assert.equal(current.authoring.system.id, 'bank-wealth');
  assert.equal(current.authoring.context.id, 'bankwealth');
  for (const { family, sha256 } of baseline.executionFamilies)
    assert.equal(hash(JSON.stringify(family === 'artifactContracts' ? beforeCompatibleStore(current[family]) : current[family])), sha256, family + ' execution declaration changed');
  assert.deepEqual(current.pipelines.map(p => p.id), ['bank-cash-payment-v1', 'bank-independent-refund-v1', 'bank-sip-dispatch-v1', 'bank-ta-submission-v1']);
  assert.equal(validateTree(tree).hard.length, 0);
  assert.deepEqual(roundtrip(tree), { ok: true, atoms: 157 });
});

test('all migrated V1 source bytes remain frozen; narratives replace missing author coverage', () => {
  const evidence = json(join(ROOT, 'docs/TRUTH-MIGRATION-EVIDENCE.json'));
  for (const source of evidence.sourceFiles) assert.equal(hash(readHistoricalFile(source.file)), source.sha256, source.file);
  assert.equal(current.stories.length, 4); assert.equal(current.readModels.length, 6);
  assert.equal(current.useCases.useCases.length, 4);
  assert.equal(current.sessions.flatMap(s => s.scopes.flatMap(b => b.notes)).filter(n => n.type === 'role').length, 3);
  const note = current.sessions.flatMap(s => s.scopes.flatMap(b => b.notes)).find(n => n.name === 'BankV1Implementation');
  const body = note.info.artifact.body;
  assert.ok(body.inheritedSources.every(s => s.interpretation === 'historical-frozen-reference' && !Object.hasOwn(s, 'value')));
  assert.deepEqual(body.entryOwnership, { payment: 'bank-cash-payment-v1', refund: 'bank-independent-refund-v1', ta: 'bank-ta-submission-v1', sip: 'bank-sip-dispatch-v1' });
  assert.ok(current.productDesigns.every(p => p.status === 'proposal' && p.approvalSource === null));
});

test('current complete request uses only current tree and named technical choices; compiled business products unchanged', async () => {
  const captured = captureProject(project);
  const { copyImmutableData } = await import('../../metarch-truthsrc/lib/immutable-data.mjs');
  assert.doesNotThrow(() => copyImmutableData(captured.sourceIndex));
  assert.equal(captured.compilation.result.products.length, 14);
  assert.ok(captured.sources.filter(s => s.file).every(s => !s.file.includes('/formal-inputs/') && !s.file.endsWith('/request.json') && !s.file.startsWith(join(ROOT, 'tree') + '/') && !s.file.startsWith(join(ROOT, 'v1/tree') + '/')));
  const config = captured.config;
  for (const doc of config.documents) assert.ok(doc.file.startsWith('bindings/implementation/'));
  assert.deepEqual(captured.compilation.result.products.map(p => ({ id: p.id, version: p.version,
    payloadSchemaVersion: p.payloadSchemaVersion, requires: p.requires,
    sha256: hash(JSON.stringify(p.id === 'artifact-contract' ? beforeCompatibleStore(p.payload) : p.payload)) })), baseline.products);
});

test('current narrative references resolve to declared technical ports and real execution sources', () => {
  const { canonical, sourceIndex } = compileTreeWithSources(tree), diagnostics = [];
  const stories = sourceIndex.records.filter(r => r.kind === 'story' && r.surface === '');
  const links = relatedNarrativeSources(canonical, sourceIndex, stories, diagnostics);
  assert.deepEqual(diagnostics, []);
  assert.ok(links.some(row => row.kind === 'technical-port' && row.name === 'BankTaEffectExecute'));
  assert.ok(links.some(row => row.kind === 'technical-port' && row.name === 'BankSipDispatchExecute'));
  assert.ok(links.some(row => row.kind === 'command' && row.name === 'RecordCashRequestSource'));
});

test('old ambiguous CLI uses refuse until explicitly selected historical', () => {
  for (const [tool, args] of [['validate.mjs', []], ['project.mjs', ['--check']], ['v1-inputs.mjs', ['--check-domain']], ['v1-service-inputs.mjs', ['--check-service']], ['v1-joint.mjs', ['--check']]]) {
    const result = spawnSync(process.execPath, [join(ROOT, 'tools', tool), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0, tool); assert.match(result.stderr, /historical/i, tool);
  }
});

// Explicit opt-in serial integration; never invokes the old qualification runner or a service.
test('full current service generates, queries, updates a teaching-only copy and preserves handwritten code', { skip: process.env.BANK_TRUTHSRC_INTEGRATION !== '1' }, async t => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'bank-truth-tutorial-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const candidate = join(parent, 'project'), source = join(candidate, 'truth/bank-wealth');
  cpSync(tree, source, { recursive: true });
  const config = json(project);
  config.documents = config.documents.map(d => ({ ...d, file: join(ROOT, d.file) }));
  config.options.runtimeArtifact.repository = new URL('../.local/truthsrc-runtime/maven/', import.meta.url).href;
  config.options.service.externalSourceRoots = [join(ROOT, 'v1/handwritten/scala')];
  const configFile = join(candidate, 'truthsrc.project.json'); writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const out = join(parent, 'generated'), input = { project: configFile, out }, flags = ['--project', configFile, '--out', out];
  const planned = await projectCli('generate-project', [...flags, '--plan']);
  assert.equal(existsSync(out), false);
  assert.equal(planned.plan.entries.filter(e => e.kind !== 'project-evidence').length, 229);
  const applied = await projectCli('generate-project', flags);
  assert.equal(applied.result.written, 233); assert.equal(statusProject(input).synchronized, true);
  const first = queryProject({ ...input, knowledge: 'ReserveFunds' });
  assert.ok(first.result.some(r => r.origins.some(o => o.file.endsWith('outgoing-funds.structure.yaml'))));
  const rules = first.result.flatMap(r => r.locations).find(l => l.file.endsWith('domain/invariant/CreditBalanceRules.scala'));
  const reverse = queryProject({ ...input, file: rules.file, symbol: 'next0' });
  assert.equal(reverse.state, 'candidates-only');
  const atom = join(source, 'contexts/bankwealth/structures/outgoing-funds.structure.yaml');
  const bytes = readFileSync(atom, 'utf8');
  assert.ok(bytes.includes('LEDGER_POSITIVE/LEDGER_POSITIVE:'));
  writeFileSync(atom, bytes.replace('LEDGER_POSITIVE/LEDGER_POSITIVE:', 'LEDGER_POSITIVE/LEDGER_POSITIVE_TEACHING:'));
  assert.equal(statusProject(input).inputs.state, 'changed');
  const update = await projectCli('generate-project', [...flags, '--update', '--plan']);
  assert.ok(update.preview.actions.some(a => a.path === rules.file && a.changed));
  await projectCli('generate-project', [...flags, '--update']);
  assert.equal(statusProject(input).synchronized, true);
  assert.ok(readFileSync(join(out, rules.file), 'utf8').includes('LEDGER_POSITIVE_TEACHING'));
  assert.equal((await projectCli('generate-project', [...flags, '--update'])).result.written, 0);
  assert.equal(readFileSync(join(tree, 'contexts/bankwealth/structures/outgoing-funds.structure.yaml'), 'utf8'), bytes);
  t.diagnostic(JSON.stringify({ products: 14, sourceFiles: 229, noHistoricalCompleteRequest: true, runtimeVerified: false, originalSourceUnchanged: true }));
});
