import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Seeds .local/truthsrc-runtime/maven with the published 0.3.0 engine jars.
   The engines are on Maven Central; this script copies the exact pinned bytes
   into the local frozen layout that truthsrc.project.json's runtimeArtifact
   repository points at, and verifies every jar against its published sha256.
   Idempotent: an already-seeded directory is verified, not re-downloaded. */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.3.0';
const central = 'https://repo1.maven.org/maven2';
const jarPins = {
  'saga-core': '550fbd5cdb18a50d71a62f8f743d59f24ac1daa03f0aeb07c23c8355c2c0d862',
  'monarch-core': '0c7a25eecae28d6f4b14a36c887511ffca5d2a755a5a618b281a271a66310b3b',
  'monarch-persistence': 'f42f1b9946be8f5a659ef067a731eee093e81b7c2df9b3e1ad8abefef4971c55',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fetchCentral(path) {
  const res = await fetch(`${central}/${path}`);
  assert.equal(res.status, 200, `Maven Central fetch failed (${res.status}): ${central}/${path}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const out = join(ROOT, '.local/truthsrc-runtime-0.3.0');
  const entries = [];
  for (const [artifact, jarSha] of Object.entries(jarPins)) {
    for (const extension of ['jar', 'pom']) {
      const file = `maven/net/imadz/${artifact}_2.13/${version}/${artifact}_2.13-${version}.${extension}`;
      const path = join(out, file);
      if (existsSync(path)) {
        assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'regular file required: ' + file);
        const bytes = readFileSync(path);
        if (extension === 'jar') assert.equal(sha(bytes), jarSha, 'local jar SHA differs from published pin: ' + file);
        entries.push({ file, path, bytes, sha256: sha(bytes) });
      } else {
        const bytes = await fetchCentral(file.slice('maven/'.length));
        if (extension === 'jar') assert.equal(sha(bytes), jarSha, 'published jar SHA differs from pin: ' + file);
        entries.push({ file, path, bytes, sha256: sha(bytes) });
      }
    }
  }
  const receipt = { schemaVersion: 'bank.truthsrc-runtime/v2', source: 'maven-central', version,
    files: entries.map(({ file, sha256 }) => ({ file, sha256 })), runtimeRebuilt: false };
  if (existsSync(out)) {
    assert.ok(lstatSync(out).isDirectory() && !lstatSync(out).isSymbolicLink());
    const existing = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
    assert.equal(existing.schemaVersion, 'bank.truthsrc-runtime/v2',
      'existing receipt is not the 0.3.0 Central edition; remove .local/truthsrc-runtime to reseed');
    assert.deepEqual(existing, receipt);
    console.log(JSON.stringify({ out, written: 0, verified: entries.length }));
    return;
  }
  if (existsSync(dirname(out))) assert.ok(!lstatSync(dirname(out)).isSymbolicLink(), 'local directory cannot be symlink');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  for (const entry of entries) {
    mkdirSync(dirname(entry.path), { recursive: true });
    writeFileSync(entry.path, entry.bytes, { flag: 'wx' });
  }
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ out, written: entries.length, verified: entries.length }));
}
await main();
