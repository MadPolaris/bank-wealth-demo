// Fixture-only tests. Never inspect host caches or invoke a compiler/service/downloader.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { captureExistingSupply, discoverExistingSupply, embeddedLicenseEvidence, extractUpdateLock, plainSupplyPath, supplyDestination } from '../tools/v1-release-supply.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const shaFile = file => hash(readFileSync(file));
const put = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); return file; };
const putJson = (file, value) => put(file, JSON.stringify(value));
const moduleId = { group: 'com.fixture', artifact: 'application', version: '1.0' };
const pom = (m, extra = '', license = true) => `<project><modelVersion>4.0.0</modelVersion><groupId>${m.group}</groupId><artifactId>${m.artifact}</artifactId><version>${m.version}</version>${extra}${license ? '<licenses><license><name>Fixture license</name><url>https://invalid.example/fixture-license</url></license></licenses>' : ''}</project>`;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries = { 'fixture.bin': 'fixture bytes' }) {
  const locals = [], directories = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.from(value), crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); directories.push(directory, filename); offset += local.length + filename.length + bytes.length;
  }
  const central = Buffer.concat(directories), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function report(file, configurations) {
  return putJson(file, { cachedDescriptor: '.', configurations: Object.entries(configurations).map(([name, modules]) => ({ configuration: { name }, modules })) });
}
function reportModule(module, file, extra = {}) {
  return { module: { organization: module.group, name: module.artifact, revision: module.version, extraAttributes: {} },
    evicted: false, missingArtifacts: [], artifacts: [[{ name: module.artifact, type: 'jar', extension: 'jar', configurations: [] }, pathToFileURL(file).href]], ...extra };
}
function maven(root, module, entries) {
  const base = join(root, module.group.replaceAll('.', '/'), module.artifact, module.version);
  const file = put(join(base, module.artifact + '-' + module.version + '.jar'), zip(entries));
  const metadata = put(join(base, module.artifact + '-' + module.version + '.pom'), pom(module));
  return { file, metadata, module };
}
function fixture(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bank-supply-fixture-'))), bank = join(root, 'bank');
  mkdirSync(bank); mkdirSync(join(bank, '.scratch/p26-p32-bank-v1-fixture'), { recursive: true });
  const repository = join(root, 'cache/maven2'); mkdirSync(repository, { recursive: true });
  const application = maven(repository, moduleId);
  const meta = maven(repository, { group: 'com.fixture', artifact: 'meta', version: '1.0' });
  const appReport = report(join(root, 'reports/app.json'), { compile: [reportModule(moduleId, application.file)], test: [reportModule(moduleId, application.file)] });
  const metaReport = report(join(root, 'reports/meta.json'), { compile: [reportModule(meta.module, meta.file)] });
  const extRoot = join(bank, 'v1/handwritten'); put(join(extRoot, 'scala/Fixture.scala'), 'object Fixture {}\n');
  const provenance = putJson(join(root, 'provenance.json'), { schemaVersion: 'bank-release-provenance/v1', handwritten: { root: extRoot, inventory: { 'scala/Fixture.scala': 'sha256:' + shaFile(join(extRoot, 'scala/Fixture.scala')) } } });
  const options = { bankRoot: bank, updateReports: [{ role: 'app', file: appReport }, { role: 'meta', file: metaReport }], repositories: [{ layout: 'maven', root: repository }], ext: { root: extRoot, provenance }, dependencyOverrides: [], platform: { os: process.platform, arch: process.arch } };
  try { return fn({ root, bank, repository, application, meta, appReport, metaReport, extRoot, provenance, options, destination: join(bank, '.scratch/p26-p32-bank-v1-fixture/supply-one') }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function addIvy(f, { license = false, entries = { 'org/example/License.class': 'not license text' } } = {}) {
  const root = join(f.root, 'ivy-repository'), module = { group: 'com.typesafe.sbt', artifact: 'sbt-twirl', version: '1.5.1' };
  const base = join(root, module.group, module.artifact, 'scala_2.12/sbt_1.0', module.version);
  const file = put(join(base, 'jars/sbt-twirl.jar'), zip(entries));
  const metadata = put(join(base, 'ivys/ivy.xml'), `<ivy-module version="2.0"><info organisation="${module.group}" module="${module.artifact}" revision="${module.version}">${license ? '<license name="Fixture Ivy License" url="https://invalid.example/ivy"/>' : ''}</info></ivy-module>`);
  f.options.repositories.push({ layout: 'ivy', root });
  report(f.metaReport, { compile: [reportModule(module, file)] });
  return { root, module, file, metadata };
}
function addP23(f) {
  const root = join(f.root, 'p23'), repository = join(root, 'offline-maven'), local = maven(repository, { group: 'com.fixture', artifact: 'p23', version: '1.0' });
  const files = [local.file, local.metadata].map(file => ({ file: file.slice(repository.length + 1), sha256: shaFile(file), bytes: readFileSync(file).length, source: 'https://invalid.example/historical-only' }));
  putJson(join(root, 'OFFLINE-REPOSITORY.json'), { schemaVersion: 'offline-maven-inventory/v1', files });
  putJson(join(root, 'ARTIFACT-MANIFEST.json'), { schemaVersion: 'runtime-artifact-manifest/v1', version: '0.2.1-p23.20261027.1', artifacts: [] });
  putJson(join(root, 'LICENSE-REVIEW.json'), { schemaVersion: 'runtime-license-review/v1', legalApproval: false, modules: [{ ...local.module,
    declarations: [{ name: 'Fixture review', url: null, evidence: 'offline-maven/' + files[1].file, sha256: files[1].sha256, method: 'fixture local POM evidence' }], embedded: [] }] });
  // The real review calls the coordinate component `artifact`, as does local.module.
  f.options.p23 = { root }; return { root, repository, local };
}
function addBoot(f) {
  const baseRoot = join(f.root, 'boot'), paths = ['scala-2.12.12/lib', 'scala-2.12.12/org.scala-sbt/sbt/1.4.9'];
  const artifacts = [], directories = [];
  for (const [index, path] of paths.entries()) {
    const published = maven(f.repository, { group: 'com.fixture', artifact: 'boot-' + index, version: '1.0' });
    const file = put(join(baseRoot, path, 'boot-' + index + '-1.0.jar'), readFileSync(published.file));
    artifacts.push({ file, repositoryFile: published.file, sha256: shaFile(file), module: published.module });
    directories.push({ path, inventory: { ['boot-' + index + '-1.0.jar']: shaFile(file) } });
  }
  f.options.bootstrap = { version: '1.4.9', scalaVersion: '2.12.12', baseRoot, directories, artifacts }; return f.options.bootstrap;
}

test('Ivy configuration arrows stay inside quoted attributes when reading local metadata', () => fixture(f => {
  const ivy = addIvy(f, { license: true });
  put(ivy.metadata, readFileSync(ivy.metadata, 'utf8').replace('</ivy-module>', '<dependencies><dependency org="com.fixture" name="a" rev="1" conf="compile->default(compile)"/></dependencies></ivy-module>'));
  const found = discoverExistingSupply(f.options);
  assert.ok(!found.unresolved.some(u => u.code === 'unresolved-ivy-metadata'));
  assert.ok(found.modules.find(m => m.module.artifact === 'sbt-twirl').licenses.some(l => l.name === 'Fixture Ivy License'));
}));

test('locally compiled boot bridges remain derived and blocked until a cold source rebuild', () => fixture(f => {
  const boot = addBoot(f);
  const published = maven(f.repository, { group: 'org.scala-sbt', artifact: 'compiler-bridge_2.13', version: '1.4.4' });
  const source = put(published.file.replace('.jar', '-sources.jar'), zip({ 'Bridge.scala': 'object Bridge {}' }));
  const relative = 'org.scala-sbt-compiler-bridge_2.13-1.4.4-bin_2.13.14__55.0/bridge/org.scala-sbt-compiler-bridge_2.13-1.4.4-bin_2.13.14__55.0.jar';
  const file = put(join(boot.baseRoot, boot.directories[1].path, relative), zip({ 'Local.class': 'local derived' }));
  boot.directories[1].inventory[relative] = shaFile(file);
  boot.derivedArtifacts = [{ kind: 'locally-compiled-compiler-bridge', file, sha256: shaFile(file), source: { file: source, sha256: shaFile(source), module: published.module } }];
  const found = discoverExistingSupply(f.options);
  assert.ok(found.unresolved.some(u => u.code === 'derived-compiler-bridge-rebuild-unverified'));
  assert.ok(found.files.some(f => f.file.endsWith('-sources.jar')));
  assert.ok(!found.files.some(f => f.file.startsWith('maven/') && f.file.includes('-bin_')));
  boot.derivedArtifacts[0].sha256 = '0'.repeat(64);
  assert.throws(() => discoverExistingSupply(f.options));
}));

test('discovery pins all app/meta configurations and stays read-only/unaccepted', () => fixture(f => {
  const extra = maven(f.repository, { group: 'com.fixture', artifact: 'runtime-only', version: '1.0' });
  report(f.appReport, { compile: [reportModule(moduleId, f.application.file)], runtime: [reportModule(extra.module, extra.file)], test: [reportModule(moduleId, f.application.file)] });
  const lock = extractUpdateLock(f.options.updateReports); assert.equal(lock.artifacts.length, 3);
  assert.deepEqual(lock.artifacts.find(a => a.module.artifact === 'application').uses.map(u => u.configuration).sort(), ['compile', 'test']);
  const found = discoverExistingSupply(f.options);
  assert.equal(found.artifacts.filter(a => a.role === 'resolved-artifact').length, 3);
  assert.equal(found.scope.milestoneAccepted, false); assert.equal(found.scope.cleanCacheVerified, false); assert.equal(found.scope.platformPortabilityVerified, false);
  assert.ok(found.unresolved.some(u => u.code === 'missing-bootstrap-lock')); assert.equal(existsSync(f.destination), false);
}));

test('optional report lock refuses missing newly reported extra artifacts and changed hashes', () => fixture(f => {
  f.options.inputLock = extractUpdateLock(f.options.updateReports);
  assert.doesNotThrow(() => discoverExistingSupply(f.options));
  const extra = maven(f.repository, { group: 'com.fixture', artifact: 'extra', version: '1.0' });
  report(f.appReport, { compile: [reportModule(moduleId, f.application.file), reportModule(extra.module, extra.file)] });
  assert.throws(() => discoverExistingSupply(f.options), /complete current report inventory/u);
  f.options.inputLock = extractUpdateLock(f.options.updateReports); put(f.application.file, zip({ 'changed.bin': 'changed' }));
  assert.throws(() => discoverExistingSupply(f.options), /complete current report inventory/u);
}));

test('no override and no false platform label are accepted', () => fixture(f => {
  assert.throws(() => discoverExistingSupply({ ...f.options, dependencyOverrides: ['another compiler'] }), /overrides forbidden/u);
  assert.throws(() => discoverExistingSupply({ ...f.options, platform: { os: 'unverified', arch: 'unverified' } }), /actual capture host/u);
}));

test('parents and imported BOMs, not only JARs, enter the bounded local metadata closure', () => fixture(f => {
  const parent = { group: 'com.fixture', artifact: 'parent', version: '2.0' }, bom = { group: 'com.fixture', artifact: 'bom', version: '3.0' };
  const parentFile = join(f.repository, 'com/fixture/parent/2.0/parent-2.0.pom'), bomFile = join(f.repository, 'com/fixture/bom/3.0/bom-3.0.pom');
  put(parentFile, pom(parent, '<properties><fixture.bom.version>3.0</fixture.bom.version></properties>'));
  put(bomFile, pom(bom));
  put(f.application.metadata, pom(moduleId, '<parent><groupId>com.fixture</groupId><artifactId>parent</artifactId><version>2.0</version></parent><dependencyManagement><dependencies><dependency><groupId>com.fixture</groupId><artifactId>bom</artifactId><version>${fixture.bom.version}</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>', false));
  const found = discoverExistingSupply(f.options), names = found.files.map(file => file.file);
  assert.ok(names.includes('maven/com/fixture/parent/2.0/parent-2.0.pom')); assert.ok(names.includes('maven/com/fixture/bom/3.0/bom-3.0.pom'));
  assert.ok(found.modules.find(m => m.module.artifact === 'application').licenses.some(l => l.file.includes('/parent/')));
  rmSync(parentFile);
  const missing = discoverExistingSupply(f.options); assert.equal(missing.status, 'blocked');
  assert.ok(missing.unresolved.some(u => u.code === 'missing-pom' && u.module === 'com.fixture:parent:2.0'));
}));

test('unresolved BOM properties are blockers rather than invented versions', () => fixture(f => {
  put(f.application.metadata, pom(moduleId, '<dependencyManagement><dependencies><dependency><groupId>com.fixture</groupId><artifactId>bom</artifactId><version>${not.known}</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>'));
  const found = discoverExistingSupply(f.options);
  assert.ok(found.unresolved.some(u => u.code === 'unresolved-pom-metadata' && u.detail.includes('unresolved Maven property')));
}));

test('cross-built sbt Maven plugin paths are taken from actual repository coordinates', () => fixture(f => {
  const published = maven(f.repository, { group: 'com.fixture', artifact: 'sbt-plugin_2.12_1.0', version: '1.0' });
  report(f.metaReport, { compile: [reportModule({ ...published.module, artifact: 'sbt-plugin' }, published.file)] });
  const found = discoverExistingSupply(f.options);
  assert.ok(found.files.some(f => f.file === 'maven/com/fixture/sbt-plugin_2.12_1.0/1.0/sbt-plugin_2.12_1.0-1.0.pom'));
  assert.ok(found.modules.some(m => m.module.artifact === 'sbt-plugin_2.12_1.0'));
}));

test('Ivy metadata is separate supply and twirl without local license remains blocked', () => fixture(f => {
  const ivy = addIvy(f), found = discoverExistingSupply(f.options);
  assert.ok(found.files.some(f => f.file === 'ivy/com.typesafe.sbt/sbt-twirl/scala_2.12/sbt_1.0/1.5.1/ivys/ivy.xml'));
  assert.ok(found.unresolved.some(u => u.code === 'missing-license-evidence' && u.module === 'com.typesafe.sbt:sbt-twirl:1.5.1'));
  assert.equal(embeddedLicenseEvidence(ivy.file).evidence.length, 0, 'License.class is not license evidence');
  rmSync(ivy.metadata);
  assert.ok(discoverExistingSupply(f.options).unresolved.some(u => u.code === 'missing-local-file' && u.role === 'ivy-metadata'));
}));

test('local Ivy declaration or genuine embedded license is evidenced with archive hashes', () => fixture(f => {
  const ivy = addIvy(f, { entries: { 'META-INF/LICENSE.txt': 'Fixture license text', 'META-INF/NOTICE': 'Fixture notice' } });
  const found = discoverExistingSupply(f.options), record = found.modules.find(m => m.module.artifact === 'sbt-twirl');
  assert.ok(record.licenses.some(l => l.kind === 'embedded-license' && l.jarSha256 === shaFile(ivy.file)));
  assert.ok(record.notices.some(l => l.kind === 'embedded-notice'));
  assert.equal(found.unresolved.some(u => u.code === 'missing-license-evidence' && u.module.includes('sbt-twirl')), false);
  assert.ok(found.files.filter(f => f.file.startsWith('licenses/embedded/')).every(f => f.origins[0].entry && f.origins[0].jarSha256));
}));

test('missing reported files and missing role retain explicit unresolved requirements', () => fixture(f => {
  rmSync(f.application.file);
  const found = discoverExistingSupply(f.options); assert.ok(found.unresolved.some(u => u.code === 'missing-local-file' && u.file === f.application.file));
  const lock = extractUpdateLock([f.options.updateReports[0]]); assert.ok(lock.unresolved.some(u => u.code === 'missing-update-role' && u.role === 'meta'));
}));

test('P23 inventory refuses extra or missing files instead of copying an unbounded cache', () => fixture(f => {
  const p23 = addP23(f), found = discoverExistingSupply(f.options);
  assert.ok(found.files.some(file => file.roles.includes('p23-supply')));
  assert.ok(found.modules.find(m => m.module.artifact === 'p23').licenses.some(l => l.kind === 'reviewed-local-declaration'));
  put(join(p23.repository, 'unexpected.jar'), zip());
  assert.throws(() => discoverExistingSupply(f.options), /P23 repository inventory differs/u);
  rmSync(join(p23.repository, 'unexpected.jar')); rmSync(p23.local.file);
  assert.throws(() => discoverExistingSupply(f.options), /P23 repository inventory differs/u);
}));

test('boot locks require Scala and sbt inventories and published counterparts for every JAR', () => fixture(f => {
  const boot = addBoot(f), found = discoverExistingSupply(f.options);
  assert.equal(found.files.filter(f => f.file.startsWith('boot/') && f.file.endsWith('.jar')).length, 2);
  assert.equal(found.artifacts.filter(a => a.role === 'bootstrap-artifact').length, 2);
  boot.artifacts.pop(); assert.throws(() => discoverExistingSupply(f.options), /every boot JAR/u);
}));

test('new boot artifacts and changed bootstrap counterparts are refused', () => fixture(f => {
  const boot = addBoot(f), extra = join(boot.baseRoot, boot.directories[0].path, 'new.jar');
  put(extra, zip()); assert.throws(() => discoverExistingSupply(f.options), /boot inventory differs/u);
  rmSync(extra); put(boot.artifacts[0].repositoryFile, zip({ changed: 'changed' }));
  assert.throws(() => discoverExistingSupply(f.options), /source hash differs/u);
}));

test('protoc and launcher are explicit supply; launcher pins actual implementation 1.4.4', () => fixture(f => {
  const module = { group: 'com.google.protobuf', artifact: 'protoc', version: '3.0' }, base = join(f.repository, 'com/google/protobuf/protoc/3.0');
  const file = put(join(base, 'protoc-3.0-osx-x86_64.exe'), 'fixture executable, never run'); put(join(base, 'protoc-3.0.pom'), pom(module));
  f.options.protoc = [{ file, sha256: shaFile(file), module }];
  const launcher = put(join(f.root, 'launcher/sbt-launch.jar'), zip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\r\nImplementation-Version: 1.4.4\r\n', LICENSE: 'Fixture launcher license' }));
  f.options.launcher = { file: launcher, sha256: shaFile(launcher), implementationVersion: '1.4.4' };
  const found = discoverExistingSupply(f.options);
  assert.ok(found.files.some(f => f.file.endsWith('protoc-3.0-osx-x86_64.exe'))); assert.ok(found.files.some(f => f.file === 'launcher/sbt-launch.jar'));
  assert.equal(found.unresolved.some(u => ['missing-protoc-lock', 'missing-launcher-lock', 'launcher-implementation-mismatch'].includes(u.code)), false);
  f.options.launcher.implementationVersion = '1.10.4'; assert.throws(() => discoverExistingSupply(f.options), /actual launcher implementation/u);
}));

test('ext provenance is exact; newly added, removed, or changed source never slips through', () => fixture(f => {
  const extra = join(f.extRoot, 'scala/Extra.scala'); put(extra, 'object Extra {}');
  assert.throws(() => discoverExistingSupply(f.options), /complete ext provenance inventory differs/u);
  rmSync(extra); put(join(f.extRoot, 'scala/Fixture.scala'), 'changed');
  assert.throws(() => discoverExistingSupply(f.options), /complete ext provenance inventory differs/u);
  rmSync(join(f.extRoot, 'scala/Fixture.scala'));
  assert.throws(() => discoverExistingSupply(f.options), /complete ext provenance inventory differs/u);
}));

test('normalized absolute fresh paths reject symlinks, dangling links, occupied and dist outputs', () => fixture(f => {
  assert.throws(() => plainSupplyPath(f.bank + '/v1/../v1', { directory: true }), /normalized absolute/u);
  assert.throws(() => plainSupplyPath('relative'), /normalized absolute/u);
  const alias = join(f.root, 'alias'); symlinkSync(f.bank, alias);
  assert.throws(() => supplyDestination(alias, join(alias, '.scratch/p26-p32-bank-v1-fixture/supply-one')), /symlink|aliased/u);
  const dangling = join(f.bank, '.scratch/p26-p32-bank-v1-fixture/supply-dangling'); symlinkSync(join(f.root, 'not-present'), dangling);
  assert.throws(() => supplyDestination(f.bank, dangling));
  mkdirSync(f.destination); assert.throws(() => supplyDestination(f.bank, f.destination), /already exists/u);
  assert.throws(() => supplyDestination(f.bank, join(f.bank, 'dist/v1')), /owned bank scratch/u);
}));

test('source artifact symlinks are refused rather than resolved/copied', () => fixture(f => {
  const actual = put(join(f.root, 'actual.jar'), readFileSync(f.application.file)); rmSync(f.application.file); symlinkSync(actual, f.application.file);
  assert.throws(() => discoverExistingSupply(f.options), /symlink|aliased/u);
}));

test('capture copies ext separately and returns hashes/origins, never acceptance', () => fixture(f => {
  const found = discoverExistingSupply(f.options), result = captureExistingSupply(found, { bankRoot: f.bank, destination: f.destination });
  assert.equal(result.status, 'captured-blocked'); assert.equal(result.milestoneAccepted, false);
  const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'));
  assert.equal(shaFile(result.manifest), result.manifestSha256); assert.equal(manifest.captureVerified, true);
  assert.equal(shaFile(join(f.destination, 'ext/scala/Fixture.scala')), shaFile(join(f.extRoot, 'scala/Fixture.scala')));
  assert.equal(existsSync(join(f.destination, 'generated')), false); assert.equal(existsSync(join(f.bank, 'dist')), false);
  for (const file of manifest.files) { assert.equal(shaFile(join(f.destination, file.file)), file.sha256); assert.ok(file.origins.length > 0); assert.equal(Object.hasOwn(file, 'contentBase64'), false); }
  assert.throws(() => captureExistingSupply(found, { bankRoot: f.bank, destination: f.destination }), /already exists/u);
}));

test('capture refuses missing map entries and post-discovery source changes before creating output', () => fixture(f => {
  const found = discoverExistingSupply(f.options), incomplete = structuredClone(found);
  incomplete.files = incomplete.files.filter(file => !file.file.startsWith('ext/'));
  assert.throws(() => captureExistingSupply(incomplete, { bankRoot: f.bank, destination: f.destination }), /complete snapshot mapping/u);
  assert.equal(existsSync(f.destination), false);
  put(join(f.extRoot, 'new-source.scala'), 'new');
  assert.throws(() => captureExistingSupply(found, { bankRoot: f.bank, destination: f.destination }), /source inventory changed/u);
  assert.equal(existsSync(f.destination), false);
}));

test('capture refuses changed report and missing artifact mapping before any copy', () => fixture(f => {
  const found = discoverExistingSupply(f.options), incomplete = structuredClone(found);
  incomplete.files = incomplete.files.filter(file => !file.file.endsWith('application-1.0.jar'));
  assert.throws(() => captureExistingSupply(incomplete, { bankRoot: f.bank, destination: f.destination }), /complete artifact mapping/u);
  assert.equal(existsSync(f.destination), false);
  put(f.appReport, '{}');
  assert.throws(() => captureExistingSupply(found, { bankRoot: f.bank, destination: f.destination }), /source changed/u);
  assert.equal(existsSync(f.destination), false);
}));
