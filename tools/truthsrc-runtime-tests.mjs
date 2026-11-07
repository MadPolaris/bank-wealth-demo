import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificationOutcome } from '../../metarch-truthsrc/lib/verification/outcome.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
export const RUNTIME_MAINS = Object.freeze([
  'BankProductionHttpMain', 'BankMysqlNegativeMain', 'BankHttpAcceptanceMain',
  'BankCrashRecoveryMain', 'BankSipCrashRecoveryMain',
].map(name => 'example.bankwealth.service.' + name));
export const RUNTIME_DEPENDENCIES = Object.freeze([
  ['org.iq80.leveldb', 'leveldb', '0.12'], ['com.h2database', 'h2', '2.2.224'],
]);
const FROZEN_MAIN_SHA256 = [
  '7556bb76383734fc4f64719fde32e24925593ce6eca46344213d084276662747',
  '0b8186615621fc1ea6a4ea84acc7b5c495d9c7c317cb5a7112bf7537a1c3599a',
  '3dcb4bbc85f1fc8f47649a95eb87fbeeec421a7a23a4415c7ddf6b7c6abf338a',
  '82776f7ec2efc483b12202f115dac4bdbdd081d874a255ddbbf7fdffeb9effc6',
  '417b333a8715d8c0d6ef00c84ecd0c0e2f7f85dcbe539333bdbb374c70e84e0f',
];
export const RUNTIME_MANIFEST_FILE = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function runtimeTestManifest(read = file => readFileSync(file, 'utf8')) {
  const sources = RUNTIME_MAINS.map((name, index) => {
    const short = name.split('.').at(-1), file = join(ROOT, 'test/scala', short + '.scala');
    const content = read(file);
    assert.equal(hash(content), FROZEN_MAIN_SHA256[index], 'frozen runtime test bytes changed: ' + short);
    assert.deepEqual([...content.matchAll(/^package ([A-Za-z][A-Za-z0-9.]*)$/gm)].map(row => row[1]), ['example.bankwealth.service']);
    assert.equal([...content.matchAll(new RegExp('^object ' + short + '(?: extends Assertions)? \\{', 'gm'))].length, 1, 'runtime main declaration changed');
    assert.equal([...content.matchAll(/^  def main\(args: Array\[String\]\): Unit = \{$/gm)].length, 1, 'runtime main entry changed');
    return { name, file, sha256: hash(content), sourceKind: 'frozen-runtime-test' };
  });
  return { schemaVersion: 'bank.truthsrc-runtime-tests/v1', sources, sourceCount: sources.length,
    scope: 'compile fixed integration mains only; does not execute services or tests' };
}

export function runtimeBuildTasks(generatedFiles, manifest) {
  assert.deepEqual(manifest.sources.map(row => row.name), RUNTIME_MAINS);
  const sources = [...generatedFiles.map(file => 'baseDirectory.value / ' + JSON.stringify(file)),
    ...manifest.sources.map(row => 'file(' + JSON.stringify(row.file) + ')')];
  return [
    'set Test / unmanagedSourceDirectories := Seq(baseDirectory.value / "src" / "test" / "scala")',
    'set Test / unmanagedSources := Seq(' + sources.join(', ') + ')',
    'set Test / unmanagedResourceDirectories := Seq(baseDirectory.value / "src" / "test" / "resources")',
    'set libraryDependencies ++= Seq(' + RUNTIME_DEPENDENCIES.map(([organization, name, version]) =>
      [organization, name, version].map(JSON.stringify).join(' % ') + ' % Test').join(', ') + ')',
    'show externalResolvers', 'show csrCacheDirectory', 'compile', 'Test / compile',
    'set Test / fullClasspath := { val entries = (Test / fullClasspath).value; ' +
      'val paths = (Test / sources).value.map(_.getCanonicalPath).sorted; ' +
      'require(paths == Seq(' + sources.map(source => '(' + source + ').getCanonicalPath').join(', ') + ').sorted, "unexpected runtime test source closure"); ' +
      'println("TRUTHSRC-RUNTIME-SOURCES=" + paths.mkString(":")); ' +
      'println("TRUTHSRC-RUNTIME-CLASSPATH=" + entries.map(_.data.getCanonicalPath).mkString(":")); entries }',
    'show Test / fullClasspath',
  ];
}

export function inspectRuntimeCompilation(stdout, actualRoot, generatedFiles, manifest) {
  const marker = name => {
    const rows = [...stdout.matchAll(new RegExp('^(?:\\[info\\] )?' + name + '=(.+)\\r?$', 'gm'))];
    assert.equal(rows.length, 1, 'exactly one ' + name + ' marker required');
    return rows[0][1].trim().split(':');
  };
  const sources = marker('TRUTHSRC-RUNTIME-SOURCES');
  assert.deepEqual(sources, [...generatedFiles.map(file => join(actualRoot, file)), ...manifest.sources.map(row => row.file)].sort(), 'actual runtime Test sources differ');
  const classpath = marker('TRUTHSRC-RUNTIME-CLASSPATH');
  assert.ok(classpath.length > 2 && new Set(classpath).size === classpath.length, 'unique nonempty runtime classpath required');
  assert.ok(!/Run starting\. Expected test count|UNIT-JVM-PID=|^TRUTHSRC-GENERATED-SUITES=/m.test(stdout), 'compile-only runtime mode unexpectedly executed unit tests');
  return { sources, classpath };
}

export function runtimeClasspathInventory(classpath, actualRoot, evidence, { safePath, inventory, fileDigest }) {
  const directories = ['target/scala-2.13/test-classes', 'target/scala-2.13/classes',
    'target/web/classes/test', 'target/web/classes/main', 'target/web/public/test'].map(dir => join(actualRoot, dir));
  const required = directories.slice(0, 2), supply = join(evidence, 'supply');
  assert.ok(required.every(dir => classpath.includes(dir)), 'compiled application and runtime test directories required');
  return Object.fromEntries(classpath.map(file => {
    assert.ok(typeof file === 'string' && resolve(file) === file && !file.includes(':') && file.startsWith('/'), 'canonical classpath path required');
    if (directories.includes(file)) {
      let stat;
      try { stat = lstatSync(file); }
      catch (error) {
        if (error.code !== 'ENOENT' || required.includes(file)) throw error;
        let parent = dirname(file);
        for (;;) {
          try { lstatSync(parent); safePath(parent); break; }
          catch (error) { if (error.code !== 'ENOENT') throw error; parent = dirname(parent); }
        }
        assert.ok(parent === actualRoot || parent.startsWith(actualRoot + '/'), 'missing optional classpath parent escaped build root');
        return [file, { kind: 'absent' }];
      }
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(file) === file);
      const files = inventory(file), directories = [];
      const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) {
          const child = join(directory, entry.name); directories.push(relative(file, child)); walk(child);
        }
      };
      walk(file);
      if (file === required[0]) for (const name of RUNTIME_MAINS) {
        assert.ok(Object.hasOwn(files, name.replaceAll('.', '/') + '$.class'), 'missing compiled runtime main: ' + name);
      }
      return [file, { kind: 'directory', directories: directories.sort(), files }];
    }
    assert.ok(file.startsWith(supply + '/') && basename(file).endsWith('.jar'), 'classpath dependency is not from this build supply');
    safePath(file, 'file');
    const stat = lstatSync(file);
    assert.equal(stat.nlink, 1, 'hardlinked runtime dependency forbidden');
    return [file, { kind: 'file', bytes: stat.size, sha256: fileDigest(file) }];
  }));
}

export function completeRuntimeCompilation(observation, checks, processPassed, errors = []) {
  const required = ['osSandboxEnforced', 'outputUnchanged', 'handwrittenUnchanged', 'localRuntimeUnchanged',
    'supplyUnchanged', 'currentInputsUnchanged', 'sandboxControlsAndCanariesUnchanged', 'ownedCachesInventoried',
    'verifierUnchanged', 'actualBuildSourcesVerified', 'runtimeTestInputsUnchanged', 'actualRuntimeTestSourcesVerified',
    'runtimeClasspathVerified'];
  const outcome = verificationOutcome({ observationPassed: !!observation, processPassed, requiredChecks: required,
    checks: Object.fromEntries(required.map(name => [name, Object.hasOwn(checks, name) && checks[name] === true])), errors });
  return { ...observation, processPassed: outcome.processPassed, sourceBound: outcome.sourceBound,
    passed: outcome.passed, errors: [...errors, ...outcome.unverified.map(key => 'unverified: ' + key)] };
}
