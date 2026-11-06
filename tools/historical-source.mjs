import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseDoc, STAGE_ORDER, inboxDirStage } from '../../metarch-truthsrc/lib/shared.mjs';
import { createSnapshot, compileSnapshot } from '../../metarch-truthsrc/lib/compile-snapshot.mjs';

const bank = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORICAL_REVISION = '675a9366cf270995ef714e505e42c19652f0e4f0';
const trees = { tree: '16838dc1f02cb720aba3c1268b3e4e1191cd355c', 'v1/tree': '5adc6dc755d3aeb579df2ee21d5c12ca24257269' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['--no-optional-locks', '-C', bank, ...args], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function checkedTree(name) {
  if (!Object.hasOwn(trees, name)) throw new Error('HISTORICAL_SOURCE: fixed tree or v1/tree required');
  const observed = git(['rev-parse', HISTORICAL_REVISION + ':' + name]).toString('utf8').trim();
  if (observed !== trees[name]) throw new Error('HISTORICAL_SOURCE: immutable tree identity differs');
}
export function historicalFiles(name) {
  checkedTree(name);
  return git(['ls-tree', '-rz', HISTORICAL_REVISION, '--', name]).toString('utf8').split('\0').filter(Boolean).map(row => {
    const [header, file] = row.split('\t'), [mode, type, blob] = header.split(' ');
    if (mode !== '100644' && mode !== '100755' || type !== 'blob' || !file.startsWith(name + '/')) throw new Error('HISTORICAL_SOURCE: unsupported historical object');
    return { file, blob };
  });
}
export function readHistoricalFile(file) {
  const tree = file.startsWith('v1/tree/') ? 'v1/tree' : file.startsWith('tree/') ? 'tree' : null;
  if (!tree || file.split('/').some(p => !p || p === '.' || p === '..') || /[\\\x00-\x1f]/.test(file)) throw new Error('HISTORICAL_SOURCE: only fixed retired author paths are readable');
  const entry = capture(tree).find(row => row.file === file);
  if (!entry) throw new Error('HISTORICAL_SOURCE: file is absent from the pinned tree');
  return Buffer.from(entry.content, 'utf8');
}
const captures = new Map();
function capture(name) {
  if (captures.has(name)) return captures.get(name);
  checkedTree(name);
  const files = historicalFiles(name);
  const output = execFileSync('git', ['--no-optional-locks', '-C', bank, 'cat-file', '--batch'], {
    input: files.map(f => f.blob).join('\n') + '\n', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  let offset = 0;
  const values = files.map(f => {
    const end = output.indexOf(10, offset), header = output.subarray(offset, end).toString('utf8').split(' ');
    if (header[0] !== f.blob || header[1] !== 'blob' || !/^\d+$/.test(header[2])) throw new Error('HISTORICAL_SOURCE: invalid blob stream');
    const size = Number(header[2]), bytes = Buffer.from(output.subarray(end + 1, end + 1 + size));
    if (bytes.length !== size || output[end + 1 + size] !== 10) throw new Error('HISTORICAL_SOURCE: incomplete blob stream');
    offset = end + 2 + size; return { ...f, content: bytes.toString('utf8'), sha256: hash(bytes), bytes: size };
  });
  if (offset !== output.length) throw new Error('HISTORICAL_SOURCE: unexpected blob stream tail');
  captures.set(name, values); return values;
}
export function historicalInventory(name) {
  return capture(name).map(({ file, sha256, bytes }) => ({ file, sha256, bytes }));
}
export function historicalSnapshot(name) {
  const entries = capture(name).map(({file,content}) => ({file:file.slice(name.length+1),content}));
  const atoms = entries.filter(e=>e.file.endsWith('.yaml')).map(e=>({file:e.file,doc:parseDoc(e.content,e.file)}));
  const inboxDirs=[...new Set(atoms.filter(a=>a.file.startsWith('inbox/')).map(a=>a.file.split('/')[1]))].sort((a,b)=>STAGE_ORDER.indexOf(inboxDirStage(a))-STAGE_ORDER.indexOf(inboxDirStage(b))||a.localeCompare(b));
  const aggregateDirs=[...new Set(atoms.filter(a=>a.file.startsWith('aggregates/')).map(a=>a.file.split('/')[1]))].sort();
  const parsed=createSnapshot(atoms,{fallbackWorkshop:name.split('/').at(-1),inboxDirs,aggregateDirs}),compiled=compileSnapshot(parsed);
  return { ...compiled, parsed, atoms:parsed.atoms, entries, revision:HISTORICAL_REVISION, treeObject:trees[name], historical:true };
}
