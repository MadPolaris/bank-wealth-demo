import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { plainPath } from './v1-release-generation.mjs';
import { sourceInventory } from './v1-release-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function coldRepositoryText(repositories) {
  assert.ok(Array.isArray(repositories) && repositories.length > 0);
  assert.equal(new Set(repositories.map(r => r.name)).size, repositories.length);
  return '[repositories]\n' + repositories.map(r => {
    assert.deepEqual(Object.keys(r).sort(), ['layout', 'name', 'root']);
    assert.match(r.name, /^[a-z][a-z0-9-]*$/);
    assert.ok(['maven', 'ivy'].includes(r.layout));
    plainPath(r.root);
    const pattern = r.layout === 'ivy' ? ', [organization]/[module]/(scala_[scalaVersion]/)(sbt_[sbtVersion]/)[revision]/[type]s/[artifact](-[classifier]).[ext]' : '';
    return r.name + ': ' + pathToFileURL(r.root).href + '/' + pattern;
  }).join('\n') + '\n';
}
export function coldBootProperties(repositories) {
  const rows = coldRepositoryText(repositories).split('\n').slice(1).join('\n');
  return '[scala]\n  version: 2.12.12\n\n[app]\n  org: org.scala-sbt\n  name: sbt\n  version: 1.4.9\n  class: sbt.xMain\n  components: xsbti,extra\n  cross-versioned: false\n\n[repositories]\n' + rows +
    '\n[boot]\n  directory: ${sbt.boot.directory}\n  lock: true\n\n[ivy]\n  ivy-home: ${sbt.ivy.home}\n  checksums: sha1,md5\n  override-build-repos: true\n  repository-config: ${sbt.repository.config}\n';
}
const guardSource = `import java.security.Permission;
public final class BankColdNetworkGuard extends SecurityManager {
  public void checkPermission(Permission p) {}
  public void checkPermission(Permission p, Object context) {}
  public void checkConnect(String host, int port) { throw new SecurityException("cold build has no network permission"); }
  public void checkConnect(String host, int port, Object context) { checkConnect(host, port); }
  public void checkListen(int port) { throw new SecurityException("cold build cannot listen"); }
  public void checkAccept(String host, int port) { throw new SecurityException("cold build cannot accept"); }
}
`;
async function command(executable, args, cwd, env, base, seconds) {
  const out = openSync(base + '.stdout.log', 'wx'), err = openSync(base + '.stderr.log', 'wx');
  let timer, killer, timedOut = false, child, cancelled = null;
  const stop = signal => {
    cancelled = signal;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      if (!killer) killer = setTimeout(() => child.kill('SIGKILL'), 15000);
    }
  };
  const onTerm = () => stop('SIGTERM'), onInt = () => stop('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  try {
    child = spawn(executable, args, { cwd, env, stdio: ['ignore', out, err] });
    const end = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); killer = setTimeout(() => child.kill('SIGKILL'), 15000); }, seconds * 1000);
    const result = await end;
    clearTimeout(timer); clearTimeout(killer);
    const receipt = { command: [executable, ...args], cwd, pid: child.pid, ...result, waited: true, timedOut, cancelled,
      stdoutSha: sha(base + '.stdout.log'), stderrSha: sha(base + '.stderr.log') };
    save(base + '.json', receipt);
    return receipt;
  } finally {
    clearTimeout(timer); clearTimeout(killer);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
    closeSync(out); closeSync(err);
  }
}
export async function runColdBuild(config) {
  assert.deepEqual(Object.keys(config).sort(), ['bridgeComponents', 'java', 'javac', 'launcher', 'ownedRoot', 'repositories', 'target', 'testPhase']);
  for (const k of ['java', 'javac', 'launcher', 'target']) plainPath(config[k]);
  plainPath(config.ownedRoot, true);
  const parts = relative(join(ROOT, '.scratch'), config.ownedRoot).split('/');
  assert.ok(parts.length === 2 && /^p26-p32-bank-v1-[A-Za-z0-9_-]+$/.test(parts[0]) && /^cold-[A-Za-z0-9_-]+$/.test(parts[1]));
  const targetParts = relative(join(ROOT, 'target/bank-wealth-release-v1'), config.target).split('/');
  assert.ok(targetParts.length === 3 && targetParts.every(p => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(p)) && ['js-app', 'bc-app'].includes(targetParts[2]));
  const repositories = coldRepositoryText(config.repositories), boot = coldBootProperties(config.repositories);
  const sources = sourceInventory(config.target);
  assert.ok(!Object.keys(sources).some(p => p.startsWith('target/') || p.startsWith('project/target/') || p.startsWith('project/project/target/')), 'cold build requires a never-built generated target');
  const settings = readFileSync(join(config.target, 'build.sbt'), 'utf8');
  for (const mount of [...settings.matchAll(/file\("([^"\n]+)"\)/g)].map(m => m[1])) {
    if (mount.startsWith('/')) assert.ok(config.repositories.some(r => mount.startsWith(dirname(r.root) + '/ext/')), 'cold build ext must be captured supply, not workspace sources');
  }
  assert.doesNotMatch(settings, /\.rounds\//, 'cold generated build must not reference author runtime delivery directories');
  const supplies = config.repositories.map(r => ({ ...r, inventory: sourceInventory(r.root) }));
  // Optional zinc component prefill: locally-compiled compiler bridges declared in a captured supply
  // (hash + published sources recorded in its manifest). This is a declared derived artifact, not a
  // host-cache fallback; rebuild-unverified stays recorded in the supply manifest itself.
  const bridges = [];
  for (const entry of config.bridgeComponents ?? []) {
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'name', 'sha256']);
    plainPath(entry.file);
    assert.match(entry.name, /^org\.scala-sbt-compiler-bridge_2\.(12|13)-1\.4\.4-bin_/u);
    assert.ok(entry.name.endsWith('.jar'), 'component destination name must be a jar file name');
    assert.equal(sha(entry.file), entry.sha256, 'bridge component hash differs from declaration');
    bridges.push({ file: entry.file, name: entry.name, sha256: entry.sha256 });
  }
  mkdirSync(config.ownedRoot);
  for (const name of ['home', 'boot', 'global', 'ivy', 'coursier', 'tmp', 'guard']) mkdirSync(join(config.ownedRoot, name));
  writeFileSync(join(config.ownedRoot, 'repositories'), repositories, { flag: 'wx' });
  writeFileSync(join(config.ownedRoot, 'sbt.boot.properties'), boot, { flag: 'wx' });
  writeFileSync(join(config.ownedRoot, 'guard/BankColdNetworkGuard.java'), guardSource, { flag: 'wx' });
  const env = { HOME: join(config.ownedRoot, 'home'), JAVA_HOME: dirname(dirname(config.java)),
    PATH: dirname(config.java) + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: join(config.ownedRoot, 'tmp'),
    COURSIER_CACHE: join(config.ownedRoot, 'coursier'), COURSIER_REPOSITORIES: config.repositories.map(r => pathToFileURL(r.root).href).join('|') };
  const before = { source: sources, supplies, toolchain: Object.fromEntries(['java', 'javac', 'launcher'].map(k => [k, { path: config[k], sha: sha(config[k]) }])),
    bridgeComponents: bridges, cachesInitiallyEmpty: bridges.length === 0, prefilledDerivedBridges: bridges.length > 0, noNetwork: true, config };
  save(join(config.ownedRoot, 'input.json'), before);
  for (const bridge of bridges) {
    const bytes = readFileSync(bridge.file);
    // Host zinc layout: flat jar under global-base/zinc/org.scala-sbt/, named by the
    // component id zinc computes (includes the bridge version/timestamp suffix).
    const base = join(config.ownedRoot, 'global/zinc/org.scala-sbt', bridge.name);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(base, bytes);
  }
  const guard = await command(config.javac, ['-d', join(config.ownedRoot, 'guard'), join(config.ownedRoot, 'guard/BankColdNetworkGuard.java')], config.ownedRoot, env, join(config.ownedRoot, 'javac'), 45);
  assert.equal(guard.code, 0);
  const property = (name, path) => '-D' + name + '=' + join(config.ownedRoot, path);
  const sbtTasks = config.testPhase === true ? ['show externalResolvers', 'show csrCacheDirectory', 'update', 'compile', 'show Compile / fullClasspath', 'Test / update', 'Test / compile', 'test']
    : ['show externalResolvers', 'show csrCacheDirectory', 'update', 'compile', 'show Compile / fullClasspath'];
  const args = ['-Xmx2G', '-Djava.security.manager=BankColdNetworkGuard', '-Dsbt.server.autostart=false', '-Dsbt.supershell=false', '-Dsbt.log.noformat=true',
    property('user.home', 'home'), property('sbt.boot.directory', 'boot'), property('sbt.global.base', 'global'), property('sbt.ivy.home', 'ivy'),
    property('coursier.cache', 'coursier'), property('java.io.tmpdir', 'tmp'), property('sbt.repository.config', 'repositories'),
    '-Dsbt.override.build.repos=true', property('sbt.boot.properties', 'sbt.boot.properties'), '-cp', join(config.ownedRoot, 'guard') + ':' + config.launcher,
    'xsbt.boot.Boot', ...sbtTasks];
  const build = await command(config.java, args, config.target, env, join(config.ownedRoot, 'build'), config.testPhase === true ? 1500 : 480);
  assert.deepEqual(sourceInventory(config.target, { afterBuild: true }), sources);
  for (const r of supplies) assert.deepEqual(sourceInventory(r.root), r.inventory);
  const result = { schemaVersion: 'bank-cold-build/v1', status: build.code === 0 && !build.timedOut && !build.cancelled ? 'passed' : 'blocked', build, testPhase: config.testPhase === true,
    noNetwork: true, cachesInitiallyEmpty: bridges.length === 0, prefilledDerivedBridges: bridges.map(b => ({ sha256: b.sha256 })), sourceUnchanged: true, suppliesUnchanged: true,
    scope: 'empty-network build with explicit file-only supplies; compiler bridges may be prefilled from captured derived declarations; not license approval, runtime deployment or release acceptance' };
  save(join(config.ownedRoot, 'result.json'), result);
  return result;
}
