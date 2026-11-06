import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
export const READSIDE_MANIFEST_FILE = fileURLToPath(import.meta.url);
export const READSIDE_BASELINE_REVISION = '21dc6c6';
export const READSIDE_SOURCES_MARKER = 'TRUTHSRC-READSIDE-SOURCES=';
export const READSIDE_DEPENDENCY = Object.freeze(['com.h2database', 'h2', '2.2.224']);
export const READSIDE_EXECUTION_CHECKS = Object.freeze([
  'readsideInputsUnchanged', 'readsideSourcesPinned', 'actualTestSourcesVerified',
]);
export const READSIDE_SCOPE = 'readside compatibility: embedded in-memory H2 JDBC projection, shutdown, authorization, DTO and direct Play action/page behavior plus generated units; not real MySQL, HTTP server/body-parser/browser, TA workers, cross-JVM recovery or 1134 acceptance';

// Independently compared with the protected-source capture for BANK 21dc6c6 at
// /private/tmp/truthsrc-mainline-compat.7zDtHQ/protected.json. These are fixed
// baseline hashes, never hashes learned from the candidate at admission time.
// BankOwnerATestSupport is embedded in BankReadsideProjectionSpec. It uses local
// testkit, jdbc:h2:mem only, and direct Play Actions; no listener/start()/worker.
// BankRequestHttpSpec uses only DTOs/signatures and the generated unit check.
const FROZEN_SUITES = [
  ['BankReadsideProjectionSpec', 'fd14c0ac849da0355694615caa8ba3051048341031371a0b9a3b3347552d53cb', [
    'real account PBs, reserved balances and exact payload bytes survive reopen and a clean projection rebuild',
    'gaps, conflicting duplicates and account event identity failures cannot advance the contiguous checkpoint',
    'an index-write failure rolls back the event, state, ownership, pending index and checkpoint together',
    'a live delivery invalidates the sampled frontier and an absent unsampled stream stays unknown',
    'an early SIP occurrence is retryably joined when its actual order PID arrives later',
    'foreign namespace delivery is rejected before JDBC and two namespaces share no checkpoints or balances',
  ]],
  ['BankReadsideShutdownSpec', '6fd943df18bc856c220fbad264db4c9e43f6b1193e29ca575fcfe218c3eb4b6d', [
    'shutdown drains an outstanding finite journal read before invalidating all observed frontiers',
  ]],
  ['BankQueryAuthorizationSpec', '43fb1290ee585bc6338390b46fa562bad37e0abb69698a3519c0330d025b8f82', [
    'all seven query actions authenticate before input decoding and port dispatch',
    'the configured customer/operator split is enforced and a GET needs neither Origin nor CSRF',
    'unknown or role-forged authority identities fail closed before any query',
    'closed query decoding rejects owner injection, duplicate scalars, bad pagination and invalid path IDs',
    'all direct readside methods reject untrusted principals before acquiring JDBC or reading the journal',
    'resource ownership is checked before fetching a foreign order/plan payload or its watermarks',
    'account identity comes from configuration and typed page/schema bounds are still validated',
  ]],
  ['BankRequestHttpSpec', '4070e5f01b080345ea9f9ffbd4c17365c958246bafec8a52767d4885bef12a72', [
    'cash DTO is closed and exact minor-unit strings cannot carry identity or authority',
    'account queries do not accept customer identity and pages reject duplicate scalar parameters',
    'typed bank endpoints install all fourteen pinned implementation bindings',
  ]],
  ['BankPagesSpec', 'd2c3cae683169c7b5785b74cc1341f6bb50f4e893d5afff6176fbc84821831a2', [
    'renderer escapes titles, every object key and nested scalar without script or attribute interpolation',
    'all page GETs use the same typed queries and cannot dispatch cash, SIP, recovery or journal work',
    'page output preserves exact money, TA text and separate payment/TA/refund/unknown metadata',
    'page query decoding and role checks reject identity injection before query dispatch',
    'all seven page POSTs require authentication, exact Origin and CSRF before invoking existing business ports',
    "page writes use the API's closed JSON decoder and never accept form, owner, outcome or method bypasses",
    'unknown/empty results stay successful progress pages, while failures retain status and do not reflect request secrets',
  ]],
];
const GENERATED_FILES = ['UnitConfigurationCheck', 'GeneratedActorStateSpec', 'GeneratedDomainRoundtripSpec',
  'GeneratedFiniteHostSpec', 'GeneratedServiceConfigurationSpec', 'GeneratedUnitStorageSpec']
  .map(name => 'src/test/scala/' + name + '.scala').sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pinnedSuites = () => FROZEN_SUITES.map(([short, sha256, tests]) => ({
  name: 'example.bankwealth.service.' + short, file: join(ROOT, 'v1/test/scala', short + '.scala'),
  sha256, tests: [...tests], sourceKind: 'frozen-readside-test',
}));
const pinnedManifest = () => ({ schemaVersion: 'bank.truthsrc-readside-tests/v1', baselineRevision: READSIDE_BASELINE_REVISION,
  suites: pinnedSuites(), suiteCount: 5, testCount: 24, zeroTestSuites: [], scope: READSIDE_SCOPE });

export function readsideSuiteNames() { return pinnedSuites().map(suite => suite.name).sort(); }

export function readsideTestManifest(read = file => readFileSync(file, 'utf8')) {
  const manifest = pinnedManifest();
  for (const suite of manifest.suites) {
    const content = read(suite.file), short = suite.name.split('.').at(-1);
    assert.equal(hash(content), suite.sha256, 'frozen readside test bytes changed: ' + suite.file);
    assert.deepEqual([...content.matchAll(/^package ([A-Za-z][A-Za-z0-9.]*)$/gm)].map(m => m[1]),
      ['example.bankwealth.service'], 'unexpected readside suite package');
    assert.deepEqual([...content.matchAll(/^final class ([A-Za-z][A-Za-z0-9]*) extends AnyFunSuite \{/gm)].map(m => m[1]),
      [short], 'unexpected readside suite class');
    const tests = [...content.matchAll(/^  test\(("(?:[^"\\\r\n]|\\.)*")\) \{/gm)].map(m => JSON.parse(m[1]));
    assert.deepEqual(tests, suite.tests, 'frozen readside test names changed: ' + short);
  }
  return manifest;
}

export function combineReadsideManifest(generated, readside) {
  assert.deepEqual(readside, pinnedManifest(), 'exact pinned readside manifest required');
  assert.equal(generated.suiteCount, 5);
  assert.equal(generated.testCount, 23);
  assert.deepEqual(generated.zeroTestSuites, ['GeneratedFiniteHostSpec']);
  const suites = [...generated.suites.map(suite => ({ ...suite, sourceKind: 'current-generated-test' })), ...readside.suites];
  const combined = { suites, suiteCount: 10, testCount: 47, zeroTestSuites: generated.zeroTestSuites,
    generatedTests: 23, businessTests: 24, readsideTests: 24, baselineRevision: READSIDE_BASELINE_REVISION, scope: READSIDE_SCOPE };
  readsideSourceFiles(combined, ['src/test/scala/UnitConfigurationCheck.scala', ...generated.suites.map(suite => suite.file)]);
  return combined;
}

// Validate full paths AND fixed descriptors, not just basenames. No directories,
// copied frozen suites, support scripts, or actor/runtime sources can be appended.
export function readsideSourceFiles(manifest, generatedFiles) {
  assert.deepEqual([...generatedFiles].sort(), GENERATED_FILES, 'exact six generated readside-mode sources required');
  assert.equal(manifest?.baselineRevision, READSIDE_BASELINE_REVISION);
  assert.equal(manifest?.readsideTests, 24);
  assert.equal(manifest.businessTests, 24);
  assert.equal(manifest.generatedTests, 23);
  assert.equal(manifest.suiteCount, 10);
  assert.equal(manifest.testCount, 47);
  assert.equal(manifest.suites.length, 10);
  assert.equal(new Set(manifest.suites.map(suite => suite.name)).size, 10);
  assert.deepEqual(manifest.zeroTestSuites, ['GeneratedFiniteHostSpec']);
  const frozen = manifest.suites.filter(suite => suite.sourceKind !== 'current-generated-test');
  assert.deepEqual(frozen, pinnedSuites(), 'exact pinned readside source list required');
  return frozen.map(suite => suite.file).sort();
}

export function inspectReadsideSources(stdout, actualRoot, generatedFiles, manifest) {
  const frozen = readsideSourceFiles(manifest, generatedFiles);
  const rows = [...stdout.matchAll(/^(?:\[info\] )?TRUTHSRC-READSIDE-SOURCES=(.+)\r?$/gm)];
  assert.equal(rows.length, 1, 'one actual readside Test sources marker required');
  const sources = rows[0][1].trim().split(',');
  const generated = generatedFiles.map(file => join(actualRoot, file)).sort();
  assert.deepEqual(sources, [...generated, ...frozen].sort(), 'actual compiled readside Test sources differ');
  return { actualRoot, sources, generatedSources: generated, frozenSources: frozen };
}
