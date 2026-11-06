import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/V1-RETIREMENT-MANIFEST.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function inventory(directory) {
  const stat = lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  return readdirSync(directory).sort().flatMap(name => {
    const file = join(directory, name), stat = lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), file);
    return stat.isDirectory() ? inventory(file) : (assert.ok(stat.isFile(), file), [relative(root, file)]);
  });
}

test('the mixed v1 container is retired, not retained as a symlink or second author root', () => {
  assert.equal(lstatSync(join(root, 'v1'), { throwIfNoEntry: false }), undefined);
  assert.equal(lstatSync(join(root, 'tree'), { throwIfNoEntry: false }), undefined);
  const project = JSON.parse(readFileSync(join(root, 'truthsrc.project.json'), 'utf8'));
  assert.equal(project.tree, 'truth/bank-wealth');
  assert.deepEqual(project.options.service.externalSourceRoots, ['./handwritten/scala']);
});

test('all 80 relocated Scala and licence files retain exact bytes and modes from the fixed revision', () => {
  assert.equal(manifest.schemaVersion, 'bank.v1-retirement-manifest/v1');
  assert.equal(manifest.revision, '4515b6b97d91714116b451b4e930dc81e112e528');
  const rows = manifest.entries.filter(row => row.disposition === 'move-byte-identical');
  assert.equal(rows.length, 80);
  assert.equal(new Set(rows.map(row => row.destination)).size, 80);
  for (const row of rows) {
    assert.equal(row.destination, row.file.slice(3));
    const file = join(root, row.destination), stat = lstatSync(file), bytes = readFileSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, row.destination);
    assert.equal(bytes.length, row.bytes, row.destination);
    assert.equal(hash(bytes), row.sha256, row.destination);
    assert.equal(stat.mode & 0o111 ? '100755' : '100644', row.mode, row.destination);
    assert.equal(git(['rev-parse', manifest.revision + ':' + row.file]).toString('utf8').trim(), row.blob);
    assert.equal(git(['hash-object', '--', file]).toString('utf8').trim(), row.blob);
  }
  for (const [directory, count] of [['handwritten/scala', 35], ['test/scala', 31], ['third-party/sbt-twirl-1.5.1', 14]]) {
    const expected = rows.filter(row => row.destination.startsWith(directory + '/')).map(row => row.destination).sort();
    assert.equal(expected.length, count);
    assert.deepEqual(inventory(join(root, directory)), expected, directory);
  }
});

test('history has a complete fixed-object disposition rather than a reduced or editable request copy', () => {
  assert.equal(manifest.entries.length, 577);
  assert.equal(new Set(manifest.entries.map(row => row.file)).size, 577);
  assert.equal(manifest.entries.filter(row => row.disposition === 'fixed-git-history').length, 497);
  const tree = git(['ls-tree', '-rz', manifest.revision, '--', 'v1']).toString('utf8').split('\0').filter(Boolean).map(line => {
    const [header, file] = line.split('\t'), [mode, type, blob] = header.split(' ');
    assert.equal(type, 'blob');
    return { file, mode, blob };
  });
  assert.deepEqual(manifest.entries.map(({file, mode, blob}) => ({file, mode, blob})), tree);
  for (const [path, identity] of Object.entries(manifest.historicalTrees)) {
    assert.equal(git(['rev-parse', manifest.revision + ':' + path]).toString('utf8').trim(), identity);
  }
});

test('the complete Twirl licence evidence closure is retained, including empty capture diagnostics', () => {
  const directory = join(root, 'third-party/sbt-twirl-1.5.1');
  const evidence = JSON.parse(readFileSync(join(directory, 'EVIDENCE.json'), 'utf8'));
  const rows = manifest.entries.filter(row => row.file.startsWith('v1/third-party/sbt-twirl-1.5.1/'));
  assert.equal(rows.filter(row => row.bytes === 0).length, 6);
  assert.equal(evidence.requests.length, 6);
  assert.ok(readFileSync(join(directory, 'LICENSE'), 'utf8').includes('Apache License'));
  assert.ok(readFileSync(join(directory, 'README-LICENSE.md'), 'utf8').length > 0);
  assert.equal(evidence.commit, 'd176bc29ac5af7ba2b57d45b0424a218136b6fff');
  for (const request of evidence.requests) {
    assert.ok(rows.some(row => row.destination === 'third-party/sbt-twirl-1.5.1/' + request.file));
    const bytes = readFileSync(join(directory, request.file));
    assert.equal(bytes.length, request.bytes, request.file);
    assert.equal(hash(bytes), request.sha256, request.file);
  }
  for (const entry of Object.values(evidence.files)) {
    const bytes = readFileSync(join(directory, entry.file));
    assert.equal(hash(bytes), entry.sha256);
    assert.equal(git(['hash-object', '--', join(directory, entry.file)]).toString('utf8').trim(), entry.gitBlobSha1);
  }
});
