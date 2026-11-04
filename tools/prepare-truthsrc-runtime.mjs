import assert from 'node:assert/strict';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archiveSha = '95daa7b9d1d394aa647175fd1b6418fd9ddac943026302a4174697bffba2cade';
const version = '0.2.1-p23.20261027.1';
const pins = {
  'saga-core': ['f20ad61eba670d2766cd39a1f75bd236351d0069b0480bb85d7335ffff93f8cf', '8117458e992085da2f106a4913429c6a8449ae1699218ffac52b54d784dd7555'],
  'monarch-core': ['046ce5a54d4900674b9d87396bd57aefd93070e74e00b90820147c043c506b09', 'b2cdec24e04948dd8a887ffcb509f486bb7fe3558412c6adb685b774ea39b0d8'],
  'monarch-persistence': ['5cf3dd2784fad05fe42102b1c5df16685bc814318e2a21121c458eb26e8205bd', 'd1414fd774f4e1c576844ba428599180b70696d860a6958abc91fe9112004bf4'],
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main(args) {
  assert.equal(args.length, 2, 'usage: node tools/prepare-truthsrc-runtime.mjs --archive <clean-1134.tar.gz>');
  assert.equal(args[0], '--archive');
  const archive = resolve(args[1]), out = join(ROOT, '.local/truthsrc-runtime');
  const stat = lstatSync(archive);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'regular clean archive required');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(archive)) hash.update(bytes);
  assert.equal(hash.digest('hex'), archiveSha, 'clean 1134 archive SHA differs; no extraction');
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
  const entries = [];
  for (const [artifact, hashes] of Object.entries(pins)) for (const [i, extension] of ['jar', 'pom'].entries()) {
    const file = `net/imadz/${artifact}_2.13/${version}/${artifact}_2.13-${version}.${extension}`;
    const matching = names.filter(name => name.endsWith('/supply/maven/' + file) || name === 'supply/maven/' + file);
    assert.equal(matching.length, 1, 'exactly one frozen supply member required: ' + file);
    assert.ok(!matching[0].split('/').includes('..') && !matching[0].startsWith('/'));
    const bytes = execFileSync('tar', ['-xOzf', archive, matching[0]], { maxBuffer: 8 * 1024 * 1024 });
    assert.equal(sha(bytes), hashes[i], 'frozen artifact SHA differs: ' + file);
    entries.push({ file: 'maven/' + file, bytes, sha256: hashes[i] });
  }
  const receipt = { schemaVersion: 'bank.truthsrc-runtime/v1', archiveSha256: archiveSha, version,
    files: entries.map(({ file, sha256 }) => ({ file, sha256 })), runtimeRebuilt: false, runtimePublished: false };
  if (existsSync(out)) {
    assert.ok(lstatSync(out).isDirectory() && !lstatSync(out).isSymbolicLink());
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'receipt.json'))), receipt);
    for (const entry of entries) {
      const path = join(out, entry.file); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
      assert.equal(sha(readFileSync(path)), entry.sha256);
    }
    console.log(JSON.stringify({ out, written: 0, verified: entries.length })); return;
  }
  if (existsSync(dirname(out))) assert.ok(!lstatSync(dirname(out)).isSymbolicLink(), 'local directory cannot be symlink');
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(out);
  for (const entry of entries) {
    const path = join(out, entry.file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, entry.bytes, { flag: 'wx' });
  }
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ out, written: entries.length, verified: entries.length }));
}
await main(process.argv.slice(2));
