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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tree = join(ROOT, 'truth/bank-wealth'), project = join(ROOT, 'truthsrc.project.json');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(compileTree(join(ROOT, 'v1/tree')));
const current = JSON.parse(compileTree(tree));

test('one root entry names current bank source; four execution flows retain all original semantics', () => {
  assert.equal(json(project).tree, 'truth/bank-wealth');
  assert.equal(current.authoring.system.id, 'bank-wealth');
  assert.equal(current.authoring.context.id, 'bankwealth');
  for (const family of ['aggregates', 'valueObjects', 'sagas', 'pipelines', 'ports', 'hostComputations', 'externalEventProducers', 'sagaHosts', 'effectHosts', 'artifactContracts', 'productDesigns'])
    assert.deepEqual(current[family], original[family], family + ' execution declaration changed');
  assert.deepEqual(current.pipelines.map(p => p.id), ['bank-cash-payment-v1', 'bank-independent-refund-v1', 'bank-sip-dispatch-v1', 'bank-ta-submission-v1']);
  assert.equal(validateTree(tree).hard.length, 0);
  assert.deepEqual(roundtrip(tree), { ok: true, atoms: 303 });
});

test('all migrated V1 source bytes remain frozen; narratives replace missing author coverage', () => {
  const evidence = json(join(ROOT, 'docs/TRUTH-MIGRATION-EVIDENCE.json'));
  for (const source of evidence.sourceFiles) assert.equal(hash(readFileSync(join(ROOT, source.file))), source.sha256, source.file);
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
  assert.ok(captured.sources.filter(s => s.file).every(s => !s.file.includes('/formal-inputs/') && !s.file.endsWith('/request.json')));
  const config = captured.config;
  for (const doc of config.documents) assert.ok(doc.file.startsWith('bindings/implementation/'));
  const documents = config.documents.map(d => { const value = json(join(ROOT, d.file)); return { id: d.id, schemaVersion: value.schemaVersion, value }; });
  const previous = compileProductSet(deriveProjectRequest(original, config, documents));
  assert.deepEqual(previous.diagnostics, []);
  for (const product of captured.compilation.result.products) {
    assert.deepEqual(product.payload, previous.result.products.find(p => p.id === product.id).payload, product.id + ' semantic payload changed');
  }
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
  assert.equal(planned.plan.entries.filter(e => e.kind !== 'project-evidence').length, 193);
  const applied = await projectCli('generate-project', flags);
  assert.equal(applied.result.written, 197); assert.equal(statusProject(input).synchronized, true);
  const first = queryProject({ ...input, knowledge: 'ReserveFunds' });
  assert.ok(first.result.some(r => r.origins.some(o => o.file.endsWith('reserve-funds.slice.yaml'))));
  const rules = first.result.flatMap(r => r.locations).find(l => l.file.endsWith('CreditBalanceRules.scala'));
  const reverse = queryProject({ ...input, file: rules.file, symbol: 'next0' });
  assert.equal(reverse.state, 'candidates-only');
  const atom = join(source, 'contexts/bankwealth/aggregates/credit-balance/slices/reserve-funds.slice.yaml');
  const bytes = readFileSync(atom, 'utf8');
  // Teaching-only error-code change exercises generated output without changing financial predicates.
  assert.ok(bytes.includes('"errCode": "LEDGER_POSITIVE"'));
  writeFileSync(atom, bytes.replace('"errCode": "LEDGER_POSITIVE"', '"errCode": "LEDGER_POSITIVE_TEACHING"'));
  assert.equal(statusProject(input).inputs.state, 'changed');
  const update = await projectCli('generate-project', [...flags, '--update', '--plan']);
  assert.ok(update.preview.actions.some(a => a.path === rules.file && a.changed));
  await projectCli('generate-project', [...flags, '--update']);
  assert.equal(statusProject(input).synchronized, true);
  assert.ok(readFileSync(join(out, rules.file), 'utf8').includes('LEDGER_POSITIVE_TEACHING'));
  assert.equal((await projectCli('generate-project', [...flags, '--update'])).result.written, 0);
  assert.equal(readFileSync(join(tree, 'contexts/bankwealth/aggregates/credit-balance/slices/reserve-funds.slice.yaml'), 'utf8'), bytes);
  t.diagnostic(JSON.stringify({ products: 14, sourceFiles: 193, noHistoricalCompleteRequest: true, runtimeVerified: false, originalSourceUnchanged: true }));
});
