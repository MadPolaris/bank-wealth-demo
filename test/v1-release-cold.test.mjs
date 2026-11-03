import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coldRepositoryText, coldBootProperties, validateBridgeComponents, validateColdSourceMounts, coldCommand } from '../tools/v1-release-cold.mjs';

test('cold repository and bootstrap configuration include only explicit local supplies', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'bank-cold-test-'));
  try {
    const repositories = [{ name: 'maven', layout: 'maven', root }, { name: 'plugins', layout: 'ivy', root }];
    const text = coldRepositoryText(repositories);
    assert.match(text, /maven: file:\/\//);
    assert.match(text, /scala_\[scalaVersion\]/);
    assert.doesNotMatch(text, /https?:|maven-central|\nlocal\n/);
    const boot = coldBootProperties(repositories);
    assert.match(boot, /version: 1\.4\.9/);
    assert.match(boot, /directory: \$\{sbt.boot.directory\}/);
    assert.match(boot, /override-build-repos: true/);
    assert.doesNotMatch(boot, /https?:|user.home|maven-central/);
    assert.throws(() => coldRepositoryText([{ ...repositories[0], name: 'escape\nremote' }]));
    assert.throws(() => coldRepositoryText([{ ...repositories[0], layout: 'https' }]));
    assert.throws(() => coldRepositoryText([{ ...repositories[0], root: 'relative' }]));
    assert.throws(() => coldRepositoryText([repositories[0], repositories[0]]));
    assert.throws(() => coldRepositoryText([]));
  } finally { rmSync(root, { recursive: true }); }
});

test('cold ext mounts match complete captured source inventory', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'bank-ext-test-'));
  try {
    const ext = join(root, 'ext/scala');
    mkdirSync(ext, { recursive: true });
    mkdirSync(join(root, 'maven'));
    writeFileSync(join(ext, 'Fixture.scala'), 'original');
    const manifest = { schemaVersion: 'bank-existing-supply-manifest/v1', files: [{ file: 'ext/scala/Fixture.scala',
      sha256: createHash('sha256').update('original').digest('hex'), roles: ['external-source'] }] };
    writeFileSync(join(root, 'SUPPLY-MANIFEST.json'), JSON.stringify(manifest));
    const repositories = [{ root: join(root, 'maven') }], settings = 'file(' + JSON.stringify(ext) + ')';
    assert.equal(validateColdSourceMounts(settings, repositories).length, 1);
    assert.throws(() => validateColdSourceMounts('file(' + JSON.stringify(ext + '/../scala') + ')', repositories));
    writeFileSync(join(ext, 'Fixture.scala'), 'changed');
    assert.throws(() => validateColdSourceMounts(settings, repositories), /bytes differ/);
    writeFileSync(join(ext, 'Fixture.scala'), 'original');
    writeFileSync(join(ext, 'Extra.scala'), 'extra');
    assert.throws(() => validateColdSourceMounts(settings, repositories), /bytes differ/);
  } finally { rmSync(root, { recursive: true }); }
});

test('cold subprocess records nonzero exit and launch failure without losing logs', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'bank-cold-child-test-'));
  try {
    const failed = await coldCommand(process.execPath, ['-e', 'console.log("retained");process.exit(7)'], root, {}, join(root, 'failed'), 5);
    assert.equal(failed.code, 7);
    assert.equal(failed.waited, true);
    assert.match(readFileSync(join(root, 'failed.stdout.log'), 'utf8'), /retained/);
    const missing = await coldCommand(join(root, 'missing'), [], root, {}, join(root, 'missing'), 5);
    assert.equal(missing.code, null);
    assert.equal(missing.launchError, 'ENOENT');
    assert.equal(missing.waited, false);
  } finally { rmSync(root, { recursive: true }); }
});

test('bridge prefill rejects traversal and uncaptured artifacts before writes', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'bank-bridge-test-'));
  try {
    mkdirSync(join(root, 'maven'));
    mkdirSync(join(root, 'boot'));
    const repositories = [{ name: 'maven', layout: 'maven', root: join(root, 'maven') }];
    const name = 'org.scala-sbt-compiler-bridge_2.13-1.4.4-bin_2.13.14__55.0-1.4.4_20201220T223045.jar';
    const file = join(root, 'boot', name), bytes = Buffer.from('fixture only');
    writeFileSync(file, bytes, { flag: 'wx' });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const entry = { file, name, sha256 };
    const manifest = { schemaVersion: 'bank-existing-supply-manifest/v1',
      files: [{ file: 'boot/' + name, sha256, roles: ['bootstrap-file'], origins: [{ file: '/origin/bridge.jar' }] }],
      unresolved: [{ code: 'derived-compiler-bridge-rebuild-unverified', file: '/origin/bridge.jar', sha256 }] };
    writeFileSync(join(root, 'SUPPLY-MANIFEST.json'), JSON.stringify(manifest), { flag: 'wx' });
    assert.equal(validateBridgeComponents([entry], repositories)[0].name, name);
    for (const bad of [name + '/../escape.jar', name + '/../../escape.jar', name.replace('1.4.4-bin_', '1.4.4-bin_..\\'), '../' + name]) {
      assert.throws(() => validateBridgeComponents([{ ...entry, name: bad }], repositories));
    }
    assert.throws(() => validateBridgeComponents([entry, entry], repositories), /duplicate/);
    assert.throws(() => validateBridgeComponents([{ ...entry, sha256: '0'.repeat(64) }], repositories), /hash differs/);
    const outside = join(root, name);
    writeFileSync(outside, bytes, { flag: 'wx' });
    assert.throws(() => validateBridgeComponents([{ ...entry, file: outside }], repositories), /explicit captured supply/);
    writeFileSync(join(root, 'SUPPLY-MANIFEST.json'), JSON.stringify({ ...manifest, unresolved: [] }));
    assert.throws(() => validateBridgeComponents([entry], repositories), /provenance missing/);
  } finally { rmSync(root, { recursive: true }); }
});
