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
export async function coldCommand(executable, args, cwd, env, base, seconds) {
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
    const end = new Promise(resolve => {
      child.once('error', error => resolve({ code: null, signal: null, launchError: error.code ?? error.name }));
      child.once('close', (code, signal) => resolve({ code, signal, launchError: null }));
    });
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); killer = setTimeout(() => child.kill('SIGKILL'), 15000); }, seconds * 1000);
    const result = await end;
    clearTimeout(timer); clearTimeout(killer);
    const receipt = { command: [executable, ...args], cwd, pid: child.pid, ...result, waited: !result.launchError, timedOut, cancelled,
      stdoutSha: sha(base + '.stdout.log'), stderrSha: sha(base + '.stderr.log') };
    save(base + '.json', receipt);
    return receipt;
  } finally {
    clearTimeout(timer); clearTimeout(killer);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
    closeSync(out); closeSync(err);
  }
}
export function validateBridgeComponents(entries, repositories) {
  assert.ok(Array.isArray(entries), 'bridgeComponents must be an array');
  const names = new Set();
  return entries.map(entry => {
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'name', 'sha256']);
    assert.match(entry.name, /^org\.scala-sbt-compiler-bridge_2\.(12|13)-1\.4\.4-bin_2\.(12|13)\.\d+__55\.0(?:-1\.4\.4_\d{8}T\d{6})?\.jar$/u);
    assert.ok(!names.has(entry.name), 'duplicate bridge destination');
    names.add(entry.name);
    plainPath(entry.file);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(sha(entry.file), entry.sha256, 'bridge component hash differs from declaration');
    const roots = [...new Set(repositories.map(r => dirname(r.root)))];
    const root = roots.find(r => {
      const path = relative(r, entry.file);
      return !path.startsWith('../') && path.startsWith('boot/');
    });
    assert.ok(root, 'bridge must belong to an explicit captured supply');
    const manifestPath = join(root, 'SUPPLY-MANIFEST.json');
    plainPath(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 'bank-existing-supply-manifest/v1');
    assert.ok(Array.isArray(manifest.files) && Array.isArray(manifest.unresolved));
    const row = manifest.files.find(f => f.file === relative(root, entry.file) && f.sha256 === entry.sha256);
    assert.ok(row && row.roles?.includes('bootstrap-file'), 'bridge missing from captured inventory');
    assert.ok(manifest.unresolved.some(item => item.code === 'derived-compiler-bridge-rebuild-unverified' &&
      item.sha256 === entry.sha256 && row.origins?.some(origin => origin.file === item.file)), 'derived bridge provenance missing');
    return { ...entry, manifest: { file: manifestPath, sha256: sha(manifestPath) } };
  });
}
export function validateColdSourceMounts(settings, repositories) {
  const mounts = [...new Set([...settings.matchAll(/file\("([^"\n]+)"\)/g)].map(m => m[1]))];
  return mounts.filter(mount => mount.startsWith('/')).map(mount => {
    plainPath(mount);
    const supply = repositories.map(r => dirname(r.root)).find(root => mount.startsWith(root + '/ext/'));
    assert.ok(supply, 'cold build ext must be captured supply, not workspace sources');
    const manifestFile = join(supply, 'SUPPLY-MANIFEST.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.schemaVersion, 'bank-existing-supply-manifest/v1');
    const prefix = relative(supply, mount) + '/';
    const rows = manifest.files.filter(row => row.file.startsWith(prefix));
    assert.ok(rows.length > 0 && rows.every(row => row.roles?.includes('external-source')), 'captured ext source declaration missing');
    const declared = Object.fromEntries(rows.map(row => [row.file.slice(prefix.length), 'sha256:' + row.sha256]));
    assert.equal(Object.keys(declared).length, rows.length, 'duplicate ext manifest path');
    const inventory = sourceInventory(mount);
    assert.deepEqual(inventory, declared, 'ext source bytes differ from captured manifest');
    return { root: mount, inventory, manifest: { file: manifestFile, sha256: sha(manifestFile) } };
  });
}

export function validateColdTestSupport(support) {
  assert.deepEqual(Object.keys(support).sort(), ['manifestSha256', 'root']);
  plainPath(support.root);
  assert.match(support.manifestSha256, /^[a-f0-9]{64}$/u);
  const parts = relative(join(ROOT, '.scratch'), support.root).split('/');
  assert.ok(parts.length === 2 && /^p26-p32-bank-v1-[A-Za-z0-9_-]+$/u.test(parts[0]) && /^test-support-[A-Za-z0-9_-]+$/u.test(parts[1]), 'owned test support root required');
  const manifestFile = join(support.root, 'TEST-SUPPORT.json');
  plainPath(manifestFile);
  assert.equal(sha(manifestFile), support.manifestSha256, 'test support manifest hash differs');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.schemaVersion, 'bank-cold-test-support/v1');
  const actual = sourceInventory(support.root);
  delete actual['TEST-SUPPORT.json'];
  for (const file of Object.keys(actual)) {
    if (file.startsWith('bank/.scratch/p26-p32-bank-v1-59o__arv/') || file.startsWith('bank/.scratch/p24-p25-bank-joint-fkcd3jwe/')) delete actual[file];
  }
  assert.deepEqual(actual, manifest.files, 'test support inventory differs');
  for (const file of ['bin/node', 'bank/tools/v1-service-mock-ta-worker.mjs', 'bank/tools/v1-mock-ta-worker.mjs',
    'bank/tools/truth-source.mjs', 'bank/simulator/mock-ta.mjs', 'metarch-truthsrc/lib/compile.mjs'])
    assert.ok(Object.hasOwn(actual, file), 'test support required file missing: ' + file);
  const tests = Object.keys(actual).filter(f => f.startsWith('tests/scala/') && f.endsWith('Spec.scala'));
  assert.ok(tests.length > 0, 'bank test sources required');
  const path = name => join(support.root, name);
  const jointRoot = path('bank/.scratch/p24-p25-bank-joint-fkcd3jwe');
  const ownedRoot = path('bank/.scratch/p26-p32-bank-v1-59o__arv/ta-application-tests');
  const properties = {
    'bank.mock-ta.node': path('bin/node'), 'bank.mock-ta.worker': path('bank/tools/v1-service-mock-ta-worker.mjs'),
    'bank.mock-ta.owned-root': ownedRoot, 'bank.mock-ta.joint-root': jointRoot
  };
  const tasks = ['debug',
    'set Test / unmanagedSourceDirectories += file(' + JSON.stringify(path('tests/scala')) + ')',
    'set libraryDependencies ++= Seq("com.h2database" % "h2" % "2.2.224" % Test, "com.typesafe.play" %% "play-test" % "2.8.18" % Test, "org.iq80.leveldb" % "leveldb" % "0.12" % Test)',
    'set Test / javaOptions ++= Seq(' + Object.entries(properties).map(([k, v]) => JSON.stringify('-D' + k + '=' + v)).join(', ') + ')',
    'set Test / envVars ++= Map("TRUTHSRC_ROOT" -> ' + JSON.stringify(path('metarch-truthsrc')) +
      ', "GIT_CEILING_DIRECTORIES" -> ' + JSON.stringify(support.root) + ')'];
  return { ...support, inventory: actual, tests, jointRoot, ownedRoot, tasks };
}

export async function runColdBuild(config) {
  const required = ['java', 'javac', 'launcher', 'ownedRoot', 'repositories', 'target'];
  assert.ok(required.every(key => Object.hasOwn(config, key)));
  assert.ok(Object.keys(config).every(key => [...required, 'bridgeComponents', 'testPhase', 'testSupport'].includes(key)));
  if (config.testSupport) assert.equal(config.testPhase, true, 'test support requires full test phase');
  if (Object.hasOwn(config, 'testPhase')) assert.equal(typeof config.testPhase, 'boolean');
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
  const externalSources = validateColdSourceMounts(settings, config.repositories);
  assert.doesNotMatch(settings, /\.rounds\//, 'cold generated build must not reference author runtime delivery directories');
  const supplies = config.repositories.map(r => ({ ...r, inventory: sourceInventory(r.root) }));
  const bridges = validateBridgeComponents(config.bridgeComponents ?? [], config.repositories);
  const testSupport = config.testSupport ? validateColdTestSupport(config.testSupport) : null;
  if (testSupport) {
    for (const directory of [testSupport.jointRoot, testSupport.ownedRoot]) {
      plainPath(directory, true);
      mkdirSync(directory, { recursive: true });
    }
  }
  mkdirSync(config.ownedRoot);
  for (const name of ['home', 'boot', 'global', 'ivy', 'coursier', 'tmp', 'guard']) mkdirSync(join(config.ownedRoot, name));
  writeFileSync(join(config.ownedRoot, 'repositories'), repositories, { flag: 'wx' });
  writeFileSync(join(config.ownedRoot, 'sbt.boot.properties'), boot, { flag: 'wx' });
  writeFileSync(join(config.ownedRoot, 'guard/BankColdNetworkGuard.java'), guardSource, { flag: 'wx' });
  const env = { HOME: join(config.ownedRoot, 'home'), JAVA_HOME: dirname(dirname(config.java)),
    PATH: dirname(config.java) + ':/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: join(config.ownedRoot, 'tmp'),
    COURSIER_CACHE: join(config.ownedRoot, 'coursier'), COURSIER_REPOSITORIES: config.repositories.map(r => pathToFileURL(r.root).href).join('|') };
  const before = { source: sources, externalSources, supplies, toolchain: Object.fromEntries(['java', 'javac', 'launcher'].map(k => [k, { path: config[k], sha: sha(config[k]) }])),
    bridgeComponents: bridges, testSupport, cachesInitiallyEmpty: bridges.length === 0, prefilledDerivedBridges: bridges.length > 0, noNetwork: true, config };
  save(join(config.ownedRoot, 'input.json'), before);
  for (const bridge of bridges) {
    const bytes = readFileSync(bridge.file);
    // Host zinc layout: flat jar under global-base/zinc/org.scala-sbt/, named by the
    // component id zinc computes (includes the bridge version/timestamp suffix).
    const base = join(config.ownedRoot, 'global/zinc/org.scala-sbt', bridge.name);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(base, bytes, { flag: 'wx' });
  }
  const guard = await coldCommand(config.javac, ['-d', join(config.ownedRoot, 'guard'), join(config.ownedRoot, 'guard/BankColdNetworkGuard.java')], config.ownedRoot, env, join(config.ownedRoot, 'javac'), 45);
  assert.equal(guard.code, 0);
  const property = (name, path) => '-D' + name + '=' + join(config.ownedRoot, path);
  const sbtTasks = config.testPhase === true ? ['show externalResolvers', 'show csrCacheDirectory', 'update', 'compile', 'show Compile / fullClasspath', 'Test / update', 'Test / compile', 'test']
    : ['show externalResolvers', 'show csrCacheDirectory', 'update', 'compile', 'show Compile / fullClasspath'];
  const args = ['-Xmx2G', '-Djava.security.manager=BankColdNetworkGuard', '-Dsbt.server.autostart=false', '-Dsbt.supershell=false', '-Dsbt.log.noformat=true',
    property('user.home', 'home'), property('sbt.boot.directory', 'boot'), property('sbt.global.base', 'global'), property('sbt.ivy.home', 'ivy'),
    property('coursier.cache', 'coursier'), property('java.io.tmpdir', 'tmp'), property('sbt.repository.config', 'repositories'),
    '-Dsbt.override.build.repos=true', property('sbt.boot.properties', 'sbt.boot.properties'), '-cp', join(config.ownedRoot, 'guard') + ':' + config.launcher,
    'xsbt.boot.Boot', ...(testSupport?.tasks ?? []), ...sbtTasks];
  const build = await coldCommand(config.java, args, config.target, env, join(config.ownedRoot, 'build'), 480);
  assert.deepEqual(sourceInventory(config.target, { afterBuild: true }), sources);
  for (const r of supplies) assert.deepEqual(sourceInventory(r.root), r.inventory);
  for (const source of externalSources) {
    assert.deepEqual(sourceInventory(source.root), source.inventory, 'external sources changed during build');
    assert.equal(sha(source.manifest.file), source.manifest.sha256, 'external source manifest changed during build');
  }
  for (const bridge of bridges) {
    assert.equal(sha(bridge.file), bridge.sha256, 'bridge changed during build');
    assert.equal(sha(bridge.manifest.file), bridge.manifest.sha256, 'supply manifest changed during build');
  }
  if (testSupport) assert.deepEqual(validateColdTestSupport(config.testSupport).inventory, testSupport.inventory);
  const result = { schemaVersion: 'bank-cold-build/v1', status: build.code === 0 && !build.timedOut && !build.cancelled ? 'passed' : 'blocked', build, testPhase: config.testPhase === true,
    testSupport: testSupport ? { root: testSupport.root, manifestSha256: testSupport.manifestSha256, tests: testSupport.tests, sourceUnchanged: true } : null,
    noNetwork: true, cachesInitiallyEmpty: bridges.length === 0, prefilledDerivedBridges: bridges.map(b => ({ sha256: b.sha256 })), sourceUnchanged: true, externalSourcesUnchanged: true, suppliesUnchanged: true,
    scope: 'file-only build with declared optional bridge prefill; testPhase runs only suites mounted by the generated target, not full bank acceptance; not license approval, runtime deployment or release acceptance' };
  save(join(config.ownedRoot, 'result.json'), result);
  return result;
}
