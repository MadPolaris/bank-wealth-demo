import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { BANK_ROOT } from '../tools/v1-release-supply.mjs';
import { analyzeCapturedSupply, writeSupplyAnalysis } from '../tools/v1-release-supply-analysis.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(fn) {
  const root = realpathSync(mkdtempSync(join(BANK_ROOT, '.scratch/analysis-test-')));
  const manifest = { schemaVersion: 'bank-existing-supply-manifest/v1', captureVerified: true,
    inputLock: { reports: [] }, files: [], modules: [], artifacts: [], unresolved: [] };
  const put = (file, value) => {
    const bytes = Buffer.from(value), path = join(root, file);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
    manifest.files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
    return file;
  };
  const pom = (name, body = '', version = '1') => put('maven/f/' + name + '/' + version + '/' + name + '-' + version + '.pom',
    '<project><groupId>f</groupId><artifactId>' + name + '</artifactId><version>' + version + '</version>' + body + '</project>');
  const report = (role, entries, configuration = 'compile') => {
    const bytes = JSON.stringify({ configurations: [{ configuration: { name: configuration }, modules: entries, details: [] }] });
    const hash = sha(bytes), file = put('evidence/update-' + role + '-' + hash + '.json', bytes);
    manifest.inputLock.reports.push({ role, file: '/historical/' + role, sha256: hash });
    return file;
  };
  const entry = (name, version = '1', extra = {}) => {
    const artifact = put('maven/f/' + name + '/' + version + '/' + name + '-' + version + '.jar', 'fixture-' + name + version);
    const source = '/nonexistent-historical-origin/' + name + '-' + version + '.jar';
    manifest.artifacts.push({ module: 'f:' + name + ':' + version, source, file: artifact, role: 'resolved-artifact', sha256: manifest.files.at(-1).sha256 });
    return { module: { organization: 'f', name, revision: version, extraAttributes: {}, exclusions: [] },
      evicted: false, callers: [], missingArtifacts: [], artifacts: [[{ name, type: 'jar' }, 'file://' + source]], ...extra };
  };
  const config = () => {
    const bytes = JSON.stringify(manifest); writeFileSync(join(root, 'SUPPLY-MANIFEST.json'), bytes);
    return { supply: root, manifestSha256: sha(bytes) };
  };
  const missing = module => manifest.unresolved.push({ code: 'missing-pom', module });
  try { return fn({ root, manifest, put, pom, report, entry, config, missing }); }
  finally { rmSync(root, { recursive: true }); }
}
const dep = (name, version, more = '') => '<dependency><groupId>f</groupId><artifactId>' + name + '</artifactId><version>' + version + '</version>' + more + '</dependency>';

test('empty callers and report alternatives never establish eviction or cold closure', () => fixture(f => {
  f.pom('app', '<dependencies>' + dep('library', '1') + '</dependencies>');
  f.report('app', [f.entry('library', '2')], 'test');
  f.report('meta', [f.entry('library', '3')], 'compile');
  f.missing('f:library:1');
  const result = analyzeCapturedSupply(f.config()), row = result.rows[0];
  assert.equal(row.classification, 'unselected-compile-report-alternative');
  assert.deepEqual(row.reportedEvictedOccurrences, []);
  assert.equal(row.evictionReasonProven, false);
  assert.deepEqual(row.alternativeOccurrences.map(i => [result.occurrences[i].role, result.occurrences[i].configuration]), [['app', 'test'], ['meta', 'compile']]);
  assert.equal(row.coldResolverRequirement, 'unknown');
  assert.equal(result.coldResolverClosureVerified, false);
}));

test('provided eligible edges retain original property expression, parent origin and excluded scopes', () => fixture(f => {
  f.pom('parent', '<properties><dep.version>1</dep.version></properties>');
  f.pom('app', '<parent><groupId>f</groupId><artifactId>parent</artifactId><version>1</version></parent><dependencies>' +
    dep('tool', '${dep.version}', '<scope>provided</scope><exclusions><exclusion><groupId>f</groupId><artifactId>excluded</artifactId></exclusion></exclusions>') +
    dep('tool', '1', '<scope>test</scope>') + dep('tool', '1', '<optional>true</optional>') + '</dependencies>');
  f.report('app', []); f.report('meta', []); f.missing('f:tool:1');
  const result = analyzeCapturedSupply(f.config()), row = result.rows[0];
  assert.equal(row.classification, 'unselected-provided-only-eligible-requests');
  const edges = row.requestEdges.map(i => result.requests[i]);
  assert.equal(edges.length, 3);
  assert.deepEqual(edges.map(e => e.collectorEligible), [true, false, false]);
  assert.equal(edges[0].expressions.version, '${dep.version}');
  assert.equal(edges[0].xpath, '/project/dependencies/dependency[1]');
  assert.deepEqual(edges[0].propertyInputs.map(p => p.file), ['maven/f/parent/1/parent-1.pom', 'maven/f/app/1/app-1.pom']);
  assert.deepEqual(edges[0].exclusions, [{ groupId: 'f', artifactId: 'excluded' }]);
  assert.ok(result.requests.some(r => r.kind === 'parent' && r.module === 'f:parent:1'));
}));

test('bootstrap alternatives are separate from report selection', () => fixture(f => {
  f.pom('app', '<dependencies>' + dep('boot', '1') + '</dependencies>');
  const file = f.put('maven/f/boot/2/boot-2.jar', 'boot');
  f.manifest.artifacts.push({ module: 'f:boot:2', file, sha256: f.manifest.files.at(-1).sha256, role: 'bootstrap-artifact' });
  f.report('meta', []); f.report('app', []); f.missing('f:boot:1');
  const row = analyzeCapturedSupply(f.config()).rows[0];
  assert.equal(row.classification, 'unselected-compile-bootstrap-alternative');
  assert.deepEqual(row.alternativeOccurrences, []);
  assert.equal(row.bootstrapAlternatives[0].module, 'f:boot:2');
}));

test('native Ivy identity and build axes reconcile metadata without a Maven equivalence or inherited license', () => fixture(f => {
  const e = f.entry('plugin');
  e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
  const artifact = f.put('ivy/f/plugin/scala_2.12/sbt_1.0/1/jars/plugin.jar', 'native fixture');
  f.manifest.artifacts[0].file = artifact;
  f.manifest.artifacts[0].sha256 = f.manifest.files.at(-1).sha256;
  const metadata = f.put('ivy/f/plugin/scala_2.12/sbt_1.0/1/ivys/ivy.xml', '<ivy-module><info organisation="f" module="plugin" revision="1"/></ivy-module>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [metadata], licenses: [] });
  f.pom('related', '<licenses><license><name>Apache-2.0</name></license></licenses>');
  f.manifest.unresolved.push({ code: 'missing-license-evidence', module: 'f:plugin:1' });
  f.report('meta', [e]); f.missing('f:plugin:1');
  const result = analyzeCapturedSupply(f.config());
  assert.equal(result.rows[0].classification, 'selected-native-ivy-descriptor');
  assert.equal(result.missingLicenseEvidence.length, 1);
  assert.equal(result.licensesReassigned, false);
}));

test('cross-built Maven mapping requires reported axes and publisher POM identity', () => fixture(f => {
  const e = f.entry('plugin_2.12_1.0');
  e.module.name = 'plugin'; e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
  const file = f.put('maven/f/plugin_2.12_1.0/1/plugin-1.pom', '<project><groupId>f</groupId><artifactId>plugin</artifactId><version>1</version><properties><scalaVersion>2.12</scalaVersion><sbtVersion>1.0</sbtVersion></properties></project>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin_2.12_1.0', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [file] });
  f.report('meta', [e]); f.missing('f:plugin:1');
  assert.equal(analyzeCapturedSupply(f.config()).rows[0].classification, 'selected-cross-built-maven-descriptor');
}));

test('unresolved properties and missing parents remain explicit without invented request versions', () => fixture(f => {
  f.pom('app', '<dependencies>' + dep('unknown', '${not.known}') + '</dependencies>');
  f.pom('other', '<parent><groupId>f</groupId><artifactId>absent-parent</artifactId><version>1</version></parent>');
  f.report('app', []); f.missing('f:unknown:1');
  const result = analyzeCapturedSupply(f.config());
  assert.equal(result.rows[0].classification, 'requires-further-evidence');
  assert.equal(result.rows[0].requestEdges.length, 0);
  assert.ok(result.requests.some(r => r.module === null && r.unresolved.includes('not.known')));
  assert.ok(result.issues.some(i => i.detail.includes('absent-parent')));
}));

test('actual evicted occurrences are preserved without assigning a global reason', () => fixture(f => {
  f.report('app', [{ module: { organization: 'f', name: 'loser', revision: '1' }, evicted: true, artifacts: [], callers: [{ explicit: 'fixture history' }] }]);
  f.missing('f:loser:1');
  const result = analyzeCapturedSupply(f.config());
  assert.deepEqual(result.rows[0].reportedEvictedOccurrences, [0]);
  assert.equal(result.rows[0].evictionReasonProven, false);
  assert.deepEqual(result.occurrences[0].callers, [{ explicit: 'fixture history' }]);
}));

test('hash changes, duplicate paths, traversal and symlinks refuse before analysis', () => fixture(f => {
  const file = f.pom('app'); f.report('app', []);
  const config = f.config(), original = readFileSync(join(f.root, file));
  assert.throws(() => analyzeCapturedSupply({ ...config, manifestSha256: '0'.repeat(64) }), /manifest hash/);
  writeFileSync(join(f.root, file), 'tampered');
  assert.throws(() => analyzeCapturedSupply(config), /file hash/);
  writeFileSync(join(f.root, file), original);
  f.manifest.files.push(f.manifest.files[0]);
  assert.throws(() => analyzeCapturedSupply(f.config()), /duplicate captured path/);
  f.manifest.files = [{ file: '../escape', sha256: '0'.repeat(64), bytes: 0 }];
  assert.throws(() => analyzeCapturedSupply(f.config()), /unsafe captured path/);
  f.manifest.files = [{ file: 'alias', sha256: '0'.repeat(64), bytes: 0 }];
  symlinkSync(file, join(f.root, 'alias'));
  assert.throws(() => analyzeCapturedSupply(f.config()), /symlink|aliased/);
}));

test('incomplete role coverage cannot turn a partial provided observation into an exhaustive classification', () => fixture(f => {
  f.pom('app', '<dependencies>' + dep('tool', '1', '<scope>provided</scope>') + '</dependencies>');
  f.report('app', []); f.missing('f:tool:1');
  const result = analyzeCapturedSupply(f.config());
  assert.equal(result.rows[0].classification, 'requires-further-evidence');
  assert.equal(result.rows[0].evidenceCompleteForGrouping, false);
}));

test('cross-built axes mismatch is rejected rather than guessed', () => fixture(f => {
  const e = f.entry('plugin_2.12_1.0');
  e.module.name = 'plugin'; e.module.extraAttributes = { scalaVersion: '2.13', sbtVersion: '1.0' };
  const file = f.put('maven/f/plugin_2.12_1.0/1/plugin-1.pom', '<project><groupId>f</groupId><artifactId>plugin</artifactId><version>1</version></project>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin_2.12_1.0', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [file] });
  f.report('meta', [e]); f.missing('f:plugin:1');
  assert.throws(() => analyzeCapturedSupply(f.config()), /reported\/captured module identity differs/);
}));

for (const role of ['resolved-artifact', 'bootstrap-artifact']) {
  for (const fault of ['missing-inventory', 'missing-hash', 'wrong-hash']) {
    test(role + ' rejects ' + fault + ' independently of file hashes', () => fixture(f => {
      f.entry('library');
      const artifact = f.manifest.artifacts[0];
      artifact.role = role;
      if (fault === 'missing-inventory') {
        f.manifest.files = f.manifest.files.filter(r => r.file !== artifact.file);
        delete artifact.sha256;
      } else if (fault === 'missing-hash') delete artifact.sha256;
      else artifact.sha256 = '0'.repeat(64);
      f.report('app', []);
      assert.throws(() => analyzeCapturedSupply(f.config()),
        fault === 'missing-inventory' ? /artifact missing from inventory/ : fault === 'missing-hash' ? /artifact hash required/ : /artifact binding differs/);
    }));
  }
}

for (const field of ['name', 'organization', 'revision']) {
  test('report binding rejects different ' + field + ' even with matching source and hash', () => fixture(f => {
    const e = f.entry('library', '2');
    e.module[field] = 'other';
    f.report('app', [e]);
    assert.throws(() => analyzeCapturedSupply(f.config()), /reported\/captured module identity differs/);
  }));
}

for (const field of ['organization', 'revision']) {
  test('cross-built report binding rejects different ' + field, () => fixture(f => {
    const e = f.entry('plugin_2.12_1.0');
    e.module.name = 'plugin'; e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
    e.module[field] = 'other';
    f.report('meta', [e]);
    assert.throws(() => analyzeCapturedSupply(f.config()), /reported\/captured module identity differs/);
  }));
}

test('POM declared version mismatch cannot create a path-derived project.version request', () => fixture(f => {
  const file = f.put('maven/f/app/1/app-1.pom', '<project><groupId>f</groupId><artifactId>app</artifactId><version>2</version><dependencies>' + dep('tool', '${project.version}', '<scope>provided</scope>') + '</dependencies></project>');
  f.report('app', []); f.report('meta', []); f.missing('f:tool:1');
  const result = analyzeCapturedSupply(f.config());
  assert.ok(result.issues.some(i => i.file === file && i.detail.includes('POM declared version differs from path')));
  assert.equal(result.requests.length, 0);
  assert.equal(result.rows[0].classification, 'requires-further-evidence');
}));

test('prototype property names stay unresolved unless explicitly declared', () => fixture(f => {
  f.pom('app', '<dependencies>' + dep('tool', '${constructor}') + dep('other', '${toString}') + '</dependencies>');
  f.pom('explicit', '<properties><constructor>7</constructor></properties><dependencies>' + dep('declared', '${constructor}') + '</dependencies>');
  f.report('app', []); f.report('meta', []); f.missing('f:tool:1');
  const result = analyzeCapturedSupply(f.config());
  assert.deepEqual(result.requests.map(r => r.module), [null, null, 'f:declared:7']);
  assert.equal(result.rows[0].evidenceCompleteForGrouping, false);
}));

test('Ivy axis must match its directory position, not the artifact name', () => fixture(f => {
  const e = f.entry('scala_2.12');
  e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
  const artifact = f.put('ivy/f/scala_2.12/scala_2.13/sbt_1.0/1/jars/scala_2.12.jar', 'native fixture');
  Object.assign(f.manifest.artifacts[0], { file: artifact, sha256: f.manifest.files.at(-1).sha256 });
  const metadata = f.put('ivy/f/scala_2.12/scala_2.13/sbt_1.0/1/ivys/ivy.xml', '<ivy-module><info organisation="f" module="scala_2.12" revision="1"/></ivy-module>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'scala_2.12', version: '1' }, artifacts: [artifact], metadata: [metadata] });
  f.report('meta', [e]); f.missing('f:scala_2.12:1');
  assert.throws(() => analyzeCapturedSupply(f.config()), /Ivy build axis differs/);
}));

for (const canonical of [false, true]) {
  test('cross-built ' + (canonical ? 'canonical' : 'legacy') + ' publisher identity is checked and missing parents remain unknown', () => fixture(f => {
    const e = f.entry('plugin_2.12_1.0');
    e.module.name = 'plugin'; e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
    const artifactId = canonical ? 'plugin_2.12_1.0' : 'plugin';
    const file = f.put('maven/f/plugin_2.12_1.0/1/plugin-1.pom', '<project><groupId>f</groupId><artifactId>' + artifactId + '</artifactId><version>1</version><parent><groupId>f</groupId><artifactId>absent</artifactId><version>1</version></parent><properties><scalaVersion>2.12</scalaVersion><sbtVersion>1.0</sbtVersion></properties></project>');
    f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin_2.12_1.0', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [file] });
    f.report('meta', [e]); f.report('app', []); f.missing('f:plugin:1');
    const missing = analyzeCapturedSupply(f.config());
    assert.equal(missing.rows[0].classification, 'requires-further-evidence');
    assert.ok(missing.issues.some(i => i.detail.includes('parent POM not captured: f:absent:1')));
    f.pom('absent');
    assert.equal(analyzeCapturedSupply(f.config()).rows[0].classification, 'selected-cross-built-maven-descriptor');
  }));
}

test('canonical cross-built publisher still requires matching build properties', () => fixture(f => {
  const e = f.entry('plugin_2.12_1.0');
  e.module.name = 'plugin'; e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
  const file = f.pom('plugin_2.12_1.0', '<properties><scalaVersion>2.13</scalaVersion><sbtVersion>1.0</sbtVersion></properties>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin_2.12_1.0', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [file] });
  f.report('meta', [e]); f.missing('f:plugin:1');
  assert.throws(() => analyzeCapturedSupply(f.config()), /POM build axis differs/);
}));

test('artifactless selected occurrence is not an unselected module', () => fixture(f => {
  f.pom('app', '<dependencies>' + dep('tool', '1', '<scope>provided</scope>') + '</dependencies>');
  f.report('app', [{ module: { organization: 'f', name: 'tool', revision: '1' }, evicted: false, artifacts: [] }]);
  f.report('meta', []); f.missing('f:tool:1');
  const row = analyzeCapturedSupply(f.config()).rows[0];
  assert.deepEqual(row.selectedOccurrences, [0]);
  assert.equal(row.classification, 'requires-further-evidence');
}));

for (const field of ['scope', 'type', 'optional']) {
  test('known GAV retains request edge when ' + field + ' is unresolved', () => fixture(f => {
    f.pom('app', '<dependencies>' + dep('tool', '1', '<' + field + '>${unknown}</' + field + '>' + (field === 'scope' ? '' : '<scope>provided</scope>')) + '</dependencies>');
    f.report('app', []); f.report('meta', []); f.missing('f:tool:1');
    const result = analyzeCapturedSupply(f.config()), row = result.rows[0];
    assert.deepEqual(row.requestEdges, [0]);
    assert.equal(result.requests[0].module, 'f:tool:1');
    assert.equal(result.requests[0][field], null);
    assert.deepEqual(Object.keys(result.requests[0].unresolvedFields), [field]);
    assert.equal(row.evidenceCompleteForGrouping, false);
    assert.equal(row.classification, 'requires-further-evidence');
  }));
}

test('pom.parent and project.parent aliases resolve all three parent coordinates', () => fixture(f => {
  f.pom('parent', '', '9');
  const aliases = ['pom', 'project'].map(prefix => '<dependency><groupId>${' + prefix + '.parent.groupId}</groupId><artifactId>${' + prefix + '.parent.artifactId}</artifactId><version>${' + prefix + '.parent.version}</version></dependency>').join('');
  f.pom('app', '<parent><groupId>f</groupId><artifactId>parent</artifactId><version>9</version></parent><dependencies>' + aliases + '</dependencies>');
  f.report('app', []);
  const result = analyzeCapturedSupply(f.config());
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.requests.map(r => r.module), ['f:parent:9', 'f:parent:9', 'f:parent:9']);
}));

test('Ivy descriptor requires the Ivy document root', () => fixture(f => {
  const e = f.entry('plugin');
  const artifact = f.put('ivy/f/plugin/1/jars/plugin.jar', 'native fixture');
  Object.assign(f.manifest.artifacts[0], { file: artifact, sha256: f.manifest.files.at(-1).sha256 });
  const metadata = f.put('ivy/f/plugin/1/ivys/ivy.xml', '<not-ivy><info organisation="f" module="plugin" revision="1"/></not-ivy>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin', version: '1' }, artifacts: [artifact], metadata: [metadata] });
  f.report('meta', [e]); f.missing('f:plugin:1');
  assert.throws(() => analyzeCapturedSupply(f.config()), /Ivy document root differs/);
}));

test('two Ivy axis variants bind each occurrence to its own descriptor', () => fixture(f => {
  const record = { module: { group: 'f', artifact: 'plugin', version: '1' }, artifacts: [], metadata: [] };
  f.manifest.modules.push(record);
  for (const [role, scala, sbt] of [['app', '2.10', '0.13'], ['meta', '2.12', '1.0']]) {
    const base = 'ivy/f/plugin/scala_' + scala + '/sbt_' + sbt + '/1/';
    const artifact = f.put(base + 'jars/plugin.jar', scala), source = '/historic/' + scala + '/plugin.jar';
    f.manifest.artifacts.push({ module: 'f:plugin:1', source, file: artifact, sha256: f.manifest.files.at(-1).sha256, role: 'resolved-artifact' });
    record.artifacts.push(artifact);
    record.metadata.push(f.put(base + 'ivys/ivy.xml', '<ivy-module><info organisation="f" module="plugin" revision="1"/></ivy-module>'));
    f.report(role, [{ module: { organization: 'f', name: 'plugin', revision: '1', extraAttributes: { scalaVersion: scala, sbtVersion: sbt } }, evicted: false, artifacts: [[{ name: 'plugin', type: 'jar' }, 'file://' + source]] }]);
  }
  f.missing('f:plugin:1');
  const row = analyzeCapturedSupply(f.config()).rows[0];
  assert.equal(row.classification, 'selected-native-ivy-descriptor');
  assert.deepEqual(row.nativeDescriptors.map(d => [d.file, d.occurrence]), record.metadata.map((file, i) => [file, i]));
}));

for (const body of ['', '<scalaVersion>${unknown}</scalaVersion><sbtVersion>1.0</sbtVersion>']) {
  test('unavailable canonical build properties stay unknown: ' + (body ? 'unresolved' : 'absent'), () => fixture(f => {
    f.pom('app', '<dependencies>' + dep('tool', '1', '<scope>provided</scope>') + '</dependencies>');
    f.missing('f:tool:1');
    const e = f.entry('plugin_2.12_1.0');
    e.module.name = 'plugin'; e.module.extraAttributes = { scalaVersion: '2.12', sbtVersion: '1.0' };
    const file = f.pom('plugin_2.12_1.0', '<properties>' + body + '</properties>');
    f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin_2.12_1.0', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [file] });
    f.report('meta', [e]); f.report('app', []); f.missing('f:plugin:1');
    const result = analyzeCapturedSupply(f.config());
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].kind, 'native-build-axes-unavailable');
    assert.ok(result.rows.every(r => r.classification === 'requires-further-evidence' && !r.evidenceCompleteForGrouping));
  }));
}

test('identical captured artifact references from canonical and legacy reports are not ambiguous', () => fixture(f => {
  const canonical = f.entry('plugin_2.12_1.0');
  const legacy = { ...canonical, module: { ...canonical.module, name: 'plugin', extraAttributes: { scalaVersion: '2.12', sbtVersion: '1.0' } } };
  f.manifest.artifacts.push({ ...f.manifest.artifacts[0], reportRole: 'meta' });
  const file = f.pom('plugin_2.12_1.0', '<properties><scalaVersion>2.12</scalaVersion><sbtVersion>1.0</sbtVersion></properties>');
  f.manifest.modules.push({ module: { group: 'f', artifact: 'plugin_2.12_1.0', version: '1' }, artifacts: [f.manifest.artifacts[0].file], metadata: [file] });
  f.report('app', [canonical]); f.report('meta', [legacy]); f.missing('f:plugin:1');
  const result = analyzeCapturedSupply(f.config());
  assert.equal(result.occurrences.length, 2);
  assert.equal(result.rows[0].classification, 'selected-cross-built-maven-descriptor');
  const other = f.entry('other');
  f.manifest.artifacts.at(-1).source = f.manifest.artifacts[0].source;
  assert.throws(() => analyzeCapturedSupply(f.config()), /selected report artifact must map uniquely/);
}));

test('output is exclusive, scratch-scoped and never claims acceptance', () => fixture(f => {
  f.report('app', []); const config = f.config(), output = join(f.root, 'analysis.json');
  const result = writeSupplyAnalysis(config, output);
  assert.equal(result.releaseAccepted, false);
  const before = readFileSync(output);
  assert.throws(() => writeSupplyAnalysis(config, output), /exclusive output/);
  assert.deepEqual(readFileSync(output), before);
  assert.throws(() => writeSupplyAnalysis({ ...config, download: true }, join(f.root, 'other.json')));
  assert.throws(() => writeSupplyAnalysis(config, join(BANK_ROOT, 'not-authorized-analysis.json')), /owned bank scratch/);
}));
