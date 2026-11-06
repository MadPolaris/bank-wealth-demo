import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORICAL_ASSET_REVISION, historicalAssetInventory, readHistoricalAsset, readHistoricalJson, readHistoricalProductRequest, assertHistoricalCheckout } from '../tools/historical-assets.mjs';
import { readProductRequest } from '../../metarch-truthsrc/lib/products/cli.mjs';
import { writeBankApplicationInputs, writeBankDomainInputs } from '../tools/v1-inputs.mjs';
import { writeBankServiceInputs } from '../tools/v1-service-inputs.mjs';
import { planFlow, testTarget } from '../tools/v1-joint.mjs';
import { checkReleaseInputs } from '../tools/v1-release-generation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/V1-RETIREMENT-MANIFEST.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalExec = childProcess.execFileSync;
let serial = 0;
async function freshWithGit(t, transform, run) {
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    if (command !== 'git') return originalExec(command, args, options);
    return transform(args, options, () => originalExec(command, args, options));
  });
  syncBuiltinESMExports();
  try { await run(await import('../tools/historical-assets.mjs?test=' + ++serial)); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
}

test('retired assets retain complete fixed tree inventories and byte identities', () => {
  assert.equal(HISTORICAL_ASSET_REVISION, manifest.revision);
  for (const [directory, count] of [['v1/formal-inputs', 471], ['v1/integration', 25], ['v1/third-party', 14]]) {
    const rows = historicalAssetInventory(directory);
    assert.equal(rows.length, count);
    assert.deepEqual(rows, manifest.entries.filter(row => row.file.startsWith(directory + '/'))
      .map(({file,mode,blob,bytes,sha256}) => ({file,mode,blob,bytes,sha256})));
  }
  for (const file of ['v1/README.md', 'v1/integration/ACCEPTANCE-MATRIX.md', 'v1/third-party/sbt-twirl-1.5.1/LICENSE']) {
    const row = manifest.entries.find(row => row.file === file), bytes = readHistoricalAsset(file);
    assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256);
  }
});

test('only exact retired asset names are readable; no source, revision or traversal override', () => {
  for (const file of [null, undefined, {}, '', '/v1/README.md', 'v1//README.md', 'v1/./README.md', 'v1/../README.md',
    'v1\\README.md', 'v1/README.md\0', 'v1/README.md\n', 'v1/readme.md', 'v1', 'v1/formal-inputs',
    'v1/formal-inputs/new/request.json', 'v1/tree/workshop.yaml', 'tree/workshop.yaml',
    'v1/handwritten/scala/example/bankwealth/integration/BankRuntime.scala', 'handwritten/scala/BankRuntime.scala',
    '.git/config', 'truthsrc.project.json', 'v1/integration/CONTRACT.md:HEAD']) assert.throws(() => readHistoricalAsset(file), /HISTORICAL_ASSETS/);
  assert.throws(() => readHistoricalAsset('v1/README.md', 'HEAD'), /overrides/);
  assert.throws(() => readHistoricalJson('v1/formal-inputs/payment-376/request.json', 'HEAD'), /overrides/);
  assert.throws(() => readHistoricalProductRequest('v1/formal-inputs/payment-376/files.json', 'HEAD'), /overrides/);
  assert.throws(() => historicalAssetInventory('v1/handwritten'), /fixed/);
});

test('returned buffers, parsed JSON and inventory rows cannot mutate private cached bytes', () => {
  const expected = readHistoricalAsset('v1/README.md');
  const modified = readHistoricalAsset('v1/README.md'); new Uint8Array(modified.buffer).fill(0);
  assert.deepEqual(readHistoricalAsset('v1/README.md'), expected);
  const inventory = historicalAssetInventory('v1/integration'); inventory[0].blob = '0'.repeat(40); inventory.pop();
  assert.equal(historicalAssetInventory('v1/integration').length, 25);
  assert.notEqual(historicalAssetInventory('v1/integration')[0].blob, '0'.repeat(40));
  const file = 'v1/formal-inputs/payment-376/scope.json', json = readHistoricalJson(file); json.flow = 'tampered';
  assert.equal(readHistoricalJson(file).flow, 'payment');
});

test('fixed same-directory file requests match the complete captured requests and public transport', () => {
  for (const name of ['payment-376', 'refund-376', 'ta-376', 'sip-376', 'release-service-631', 'release-pages-721']) {
    const file = 'v1/formal-inputs/' + name + '/files.json', request = readHistoricalProductRequest(file);
    assert.deepEqual(request, readHistoricalJson('v1/formal-inputs/' + name + '/request.json'));
    if (existsSync(join(root, file))) assert.deepEqual(request, readProductRequest(join(root, file)));
    assert.equal(request.requirements.length, 14);
  }
  for (const file of ['v1/formal-inputs/payment-376/request.json', 'v1/formal-inputs/payment-376/../sip-376/files.json',
    'v1/integration/files.json']) assert.throws(() => readHistoricalProductRequest(file), /HISTORICAL_ASSETS/);
});

test('reads one blob lazily and shares only private cache across duplicate historical scopes', async t => {
  const reads = [];
  await freshWithGit(t, (args, options, real) => {
    assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1');
    assert.equal(options.env.GIT_NO_LAZY_FETCH, '1');
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.ok(args.includes('protocol.allow=never'));
    if (args.includes('--batch')) { reads.push(options.input); assert.match(options.input, /^[a-f0-9]{40}\n$/); }
    return real();
  }, module => {
    const a = module.readHistoricalAsset('v1/formal-inputs/payment-376/compiled.json');
    const b = module.readHistoricalAsset('v1/formal-inputs/refund-376/compiled.json');
    assert.deepEqual(a, b); assert.equal(reads.length, 1);
    assert.ok(a.length > 4 * 1024 * 1024, 'fixture exercises the large compiled object, not a small JSON surrogate');
  });
});

for (const [name, transform] of [
  ['missing object', () => { throw new Error('object unavailable'); }],
  ['wrong revision', (args, options, real) => args.includes(HISTORICAL_ASSET_REVISION + '^{commit}') ? Buffer.from('0'.repeat(40) + '\n') : real()],
  ['wrong tree', (args, options, real) => args.includes(HISTORICAL_ASSET_REVISION + ':v1') ? Buffer.from('0'.repeat(40) + '\n') : real()],
  ['wrong tree mode', (args, options, real) => args.includes('ls-tree') ? Buffer.from(real().toString().replace('100644 blob', '120000 blob')) : real()],
  ['wrong blob header', (args, options, real) => { const bytes = real(); if (args.includes('--batch')) bytes[0] = bytes[0] === 97 ? 98 : 97; return bytes; }],
  ['wrong blob type', (args, options, real) => args.includes('--batch') ? Buffer.from(real().toString().replace(' blob ', ' tree ')) : real()],
  ['wrong blob bytes', (args, options, real) => { const bytes = real(); if (args.includes('--batch')) bytes[bytes.indexOf(10) + 1] ^= 1; return bytes; }],
  ['missing final delimiter', (args, options, real) => args.includes('--batch') ? real().subarray(0, -1) : real()],
]) test(name + ' fails closed without reading a working-tree replacement', async t => {
  await freshWithGit(t, transform, module => assert.throws(() => module.readHistoricalAsset('v1/README.md'), /HISTORICAL_ASSETS/));
});

test('all historical physical writers and runners refuse before creating a new target', async () => {
  const target = join(root, 'target/v1-retirement-must-not-write');
  assert.equal(existsSync(target), false);
  assert.throws(() => assertHistoricalCheckout(), /historical physical layout is retired/);
  assert.throws(() => writeBankDomainInputs(target), /historical physical layout is retired/);
  assert.throws(() => writeBankApplicationInputs(target, {}, {}), /historical physical layout is retired/);
  assert.throws(() => writeBankServiceInputs(target, {}, {}), /historical physical layout is retired/);
  assert.throws(() => checkReleaseInputs(join(root, 'v1/formal-inputs/release-pages-721')), /historical physical layout is retired/);
  await assert.rejects(planFlow('payment'), /historical physical layout is retired/);
  await assert.rejects(testTarget(target, target + '-evidence'), /historical physical layout is retired/);
  assert.equal(existsSync(target), false);
});
