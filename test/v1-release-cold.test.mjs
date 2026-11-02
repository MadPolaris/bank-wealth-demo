import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coldRepositoryText, coldBootProperties } from '../tools/v1-release-cold.mjs';

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
