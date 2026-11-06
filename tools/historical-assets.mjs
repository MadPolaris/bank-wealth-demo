// Read-only retired assets, not another author tree or a historical release writer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_JSON_BYTES, parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { at, array, object, text, validateRequest } from '../../metarch-truthsrc/lib/products/request.mjs';
import { captureProductJson } from '../../metarch-truthsrc/lib/products/cli.mjs';

const bank = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORICAL_ASSET_REVISION = '4515b6b97d91714116b451b4e930dc81e112e528';
const manifestSHA = '11aeb9851cf08b8066185f4533af1d59b2fe325b98be5de1672cc0fe1fa309e9';
const v1Tree = '1b5fe5c131ca530e14d0c02ab6965b1f5c864e81';
const trees = {
  'v1/formal-inputs': '6139763831ba2841b7c103419777577b48864e1a',
  'v1/integration': 'fa085c89860143437877bc166f3f5e65d5bcfca4',
  'v1/third-party': '8028574813e0adf0c0b776206dd27f746a8ee1d7'
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error('HISTORICAL_ASSETS: ' + message); };
const oneArgument = count => { if (count !== 1) fail('exactly one fixed asset path/root required; revision overrides are not supported'); };
const validPath = file => typeof file === 'string' && file.length > 0 && !/[\\\x00-\x1f\x7f]/u.test(file) && !file.split('/').some(p => !p || p === '.' || p === '..');
let entries;
function manifestEntries() {
  let captured;
  try { captured = captureProductJson(join(bank, 'docs/V1-RETIREMENT-MANIFEST.json')); }
  catch { fail('fixed retirement manifest unavailable; no working-tree asset fallback'); }
  if (captured.sha256 !== manifestSHA) fail('fixed retirement manifest digest differs');
  if (entries) return entries;
  const manifest = captured.value;
  assert.equal(manifest.schemaVersion, 'bank.v1-retirement-manifest/v1');
  assert.equal(manifest.revision, HISTORICAL_ASSET_REVISION);
  assert.deepEqual(manifest.historicalTrees, trees);
  assert.equal(manifest.entries.length, 577);
  const rows = new Map();
  for (const row of manifest.entries) {
    if (!validPath(row.file) || rows.has(row.file) || !['100644', '100755'].includes(row.mode) || !/^[a-f0-9]{40}$/u.test(row.blob) ||
        !/^[a-f0-9]{64}$/u.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) fail('invalid fixed inventory entry');
    rows.set(row.file, row);
  }
  entries = rows;
  return entries;
}

function git(args, options = {}) {
  // Neither repository/revision environment overrides, replacement objects nor
  // partial-clone lazy fetch may turn a local immutable read into another source.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
  try {
    return execFileSync('git', ['--no-optional-locks', '-c', 'protocol.allow=never', '-C', bank, ...args], {
      env, timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options
    });
  } catch { fail('fixed local Git object unavailable or unreadable; use the fixed historical checkout or clean1134 archive; no fetch or working-tree fallback'); }
}
const checkedRoots = new Set();
function checkedRoot(root) {
  if (checkedRoots.has(root)) return;
  const rows = manifestEntries();
  const revision = git(['rev-parse', '--verify', HISTORICAL_ASSET_REVISION + '^{commit}']).toString('utf8').trim();
  if (revision !== HISTORICAL_ASSET_REVISION) fail('immutable revision identity differs');
  for (const [name, expected] of [['v1', v1Tree], ...(root === 'v1' ? [] : [[root, trees[root]]])]) {
    if (git(['rev-parse', '--verify', HISTORICAL_ASSET_REVISION + ':' + name]).toString('utf8').trim() !== expected) fail('immutable root tree identity differs');
  }
  // Only tree metadata is enumerated. In particular, never batch-read the 217 MB
  // formal-inputs tree. The README has an exact singleton allowance, not v1/*.
  const expected = [...rows.values()].filter(row => root === 'v1' ? row.file === 'v1/README.md' : row.file.startsWith(root + '/'));
  const output = git(['ls-tree', '-rz', '-l', HISTORICAL_ASSET_REVISION, '--', root === 'v1' ? 'v1/README.md' : root]).toString('utf8');
  const observed = output.split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\s+(\d+)\t([^\0]+)$/u.exec(line);
    if (!match) fail('unsupported historical tree entry');
    return { file: match[4], mode: match[1], blob: match[2], bytes: Number(match[3]) };
  });
  if (!output.endsWith('\0') || JSON.stringify(observed) !== JSON.stringify(expected.map(({ file, mode, blob, bytes }) => ({ file, mode, blob, bytes }))))
    fail('exact tree inventory differs (path, mode, blob or size)');
  checkedRoots.add(root);
}
function assetEntry(file) {
  if (!validPath(file)) fail('normalized fixed historical asset path required');
  const root = Object.keys(trees).find(name => file.startsWith(name + '/')) ?? (file === 'v1/README.md' ? 'v1' : null);
  if (!root || !manifestEntries().has(file)) fail('asset is absent from the exact historical allowlist');
  checkedRoot(root);
  return manifestEntries().get(file);
}

export function historicalAssetInventory(root) {
  oneArgument(arguments.length);
  if (!Object.hasOwn(trees, root)) fail('fixed formal-inputs, integration or third-party root required');
  checkedRoot(root);
  return [...manifestEntries().values()].filter(row => row.file.startsWith(root + '/'))
    .map(({ file, mode, blob, bytes, sha256 }) => ({ file, mode, blob, bytes, sha256 }));
}
const blobs = new Map();
export function readHistoricalAsset(file) {
  oneArgument(arguments.length);
  const row = assetEntry(file);
  if (!blobs.has(row.blob)) {
    const output = git(['cat-file', '--batch'], { input: row.blob + '\n', maxBuffer: row.bytes + 1024 });
    const end = output.indexOf(10), header = output.subarray(0, end).toString('ascii');
    if (end < 0 || header !== `${row.blob} blob ${row.bytes}`) fail('blob identity, type or size differs');
    const bytes = output.subarray(end + 1, end + 1 + row.bytes);
    if (bytes.length !== row.bytes || output.length !== end + 2 + row.bytes || output.at(-1) !== 10) fail('blob byte size or framing differs');
    if (hash(bytes) !== row.sha256) fail('blob SHA256 differs');
    if (createHash('sha1').update(`blob ${row.bytes}\0`).update(bytes).digest('hex') !== row.blob) fail('Git blob identity differs');
    const cached = Buffer.alloc(bytes.length);
    bytes.copy(cached);
    blobs.set(row.blob, cached);
  }
  // Buffer.from may share an allocation pool. Use separate, unpooled storage so
  // even a caller mutating the entire underlying ArrayBuffer cannot touch cache.
  const cached = blobs.get(row.blob), copy = Buffer.alloc(cached.length);
  cached.copy(copy);
  return copy;
}
export function readHistoricalJson(file) {
  oneArgument(arguments.length);
  return parseStrictJson(readHistoricalAsset(file));
}
export function readHistoricalProductRequest(file) {
  oneArgument(arguments.length);
  if (typeof file !== 'string' || !/^v1\/formal-inputs\/[^/]+\/files\.json$/u.test(file)) fail('fixed same-directory files.json required');
  const bytes = readHistoricalAsset(file), manifest = parseStrictJson(bytes);
  object(manifest, ['schemaVersion', 'documents', 'assemblies', 'requirements', 'options'], at('request'));
  if (manifest.schemaVersion !== 'truthsrc.product-input-files/v1') fail('unsupported file manifest');
  let total = bytes.length;
  const documents = array(manifest.documents, at('request', '/documents')).map((d, i) => {
    const location = at('request', `/documents/${i}`);
    object(d, ['id', 'schemaVersion', 'file'], location);
    text(d.id, location); text(d.schemaVersion, location); text(d.file, location);
    if (!validPath(d.file) || d.file.includes('/')) fail('document must be an exact same-directory file');
    const content = readHistoricalAsset(posix.dirname(file) + '/' + d.file);
    total += content.length;
    if (total > MAX_JSON_BYTES) fail('captured request files exceed 8 MiB total');
    return { id: d.id, schemaVersion: d.schemaVersion, value: parseStrictJson(content) };
  });
  // Use public admission; do not infer/filter products or forgive legacy input.
  const request = validateRequest({ schemaVersion: 'truthsrc.product-compilation/v1', documents,
    assemblies: manifest.assemblies, requirements: manifest.requirements, options: manifest.options });
  assert.deepEqual(request, readHistoricalJson(posix.dirname(file) + '/request.json'), 'HISTORICAL_ASSETS: file request differs from fixed request.json');
  return request;
}

// Physical writers cannot treat missing protected directories as empty snapshots.
// This is a refusal, not a facility for restoring old author files into this repo.
export function assertHistoricalCheckout() {
  const roots = ['tree', 'v1/tree', 'compiled', 'isolation-zone', 'qualification', 'v1/formal-inputs', 'v1/integration', 'v1/handwritten', 'v1/test', 'v1/third-party'];
  const requiredFiles = ['tree/workshop.yaml', 'v1/tree/workshop.yaml', 'v1/integration/CONTRACT.md', 'v1/integration/ACCEPTANCE-MATRIX.md', 'v1/integration/HANDWRITTEN-SOURCE-MAP.json'];
  const refuse = () => fail('historical physical layout is retired or incomplete; use the fixed historical checkout (author revision 675a9366cf270995ef714e505e42c19652f0e4f0) or clean1134 archive, not this checkout; v1 will not be recreated');
  for (const root of roots) {
    const file = join(bank, root), stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(file) !== file || readdirSync(file).length === 0) refuse();
  }
  for (const name of requiredFiles) {
    const file = join(bank, name), stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file || stat.size === 0) refuse();
  }
}
