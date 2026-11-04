import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { certifyRelease } from './v1-release-certify.mjs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { buildInventory } from './v1-release-build-evidence.mjs';

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
function safeRelative(path) {
  assert.ok(typeof path === 'string' && path && !isAbsolute(path) && !/[\\\0\r\n]/.test(path));
  assert.ok(path.split('/').every(p => p && p !== '.' && p !== '..'));
}
export function verifyBundleFiles(bundle) {
  assert.equal(realpathSync(bundle), bundle);
  const manifest = json(join(bundle, 'BUNDLE.json'));
  assert.equal(manifest.schemaVersion, 'bank-v1-bundle/v2');
  assert.ok(Object.keys(manifest.files).length > 0);
  for (const [path, hash] of Object.entries(manifest.files)) {
    safeRelative(path);
    const file = join(bundle, path);
    assert.equal(realpathSync(file), file); assert.ok(lstatSync(file).isFile()); assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(sha(file), hash, 'bundle fingerprint differs: ' + path);
  }
  return manifest;
}
export function verifyDistributionSupply(bundle) {
  const manifest = verifyBundleFiles(bundle);
  for (const prefix of ['js-generator/', 'bc-generator/', 'bc-build-supply/', 'bc-runtime/', 'inputs/', 'supply/ext/scala/', 'support/', 'node/', 'licenses/sbt-twirl-1.5.1/']) {
    assert.ok(Object.keys(manifest.files).some(p => p.startsWith(prefix)), 'missing distribution component: ' + prefix);
  }
  const frozen = {
    'saga-core': 'f20ad61eba670d2766cd39a1f75bd236351d0069b0480bb85d7335ffff93f8cf',
    'monarch-core': '046ce5a54d4900674b9d87396bd57aefd93070e74e00b90820147c043c506b09',
    'monarch-persistence': '5cf3dd2784fad05fe42102b1c5df16685bc814318e2a21121c458eb26e8205bd',
  };
  for (const [name, expected] of Object.entries(frozen)) {
    const path = `supply/maven/net/imadz/${name}_2.13/0.2.1-p23.20261027.1/${name}_2.13-0.2.1-p23.20261027.1.jar`;
    assert.equal(manifest.files[path], expected, 'frozen runtime differs');
  }
  assert.ok(!Object.keys(manifest.files).some(p => p.startsWith('supply/boot/')), 'distribution must not contain prefilled derived bridges');
  assert.deepEqual(buildInventory(join(bundle, 'supply/ext/scala')), buildInventory(join(bundle, 'bank/v1/handwritten/scala')));
  assert.deepEqual(buildInventory(join(bundle, 'support/tests/scala')), buildInventory(join(bundle, 'bank/v1/test/scala')));
  const evidence = json(join(bundle, 'licenses/sbt-twirl-1.5.1/EVIDENCE.json'));
  assert.equal(evidence.pluginSpecificEvidenceSatisfied, true); assert.equal(evidence.license, 'Apache-2.0');
  for (const row of evidence.requests) assert.equal(sha(join(bundle, 'licenses/sbt-twirl-1.5.1', row.file)), row.sha256);
  const supply = json(join(bundle, 'supply/SUPPLY-MANIFEST.json'));
  for (const module of [...supply.modules, ...supply.tools]) {
    const artifacts = module.artifacts.filter(p => Object.hasOwn(manifest.files, 'supply/' + p));
    if (!artifacts.length) continue;
    const twirl = module.module?.group === 'com.typesafe.sbt' && module.module?.artifact === 'sbt-twirl' && module.module?.version === '1.5.1';
    assert.ok(twirl || module.licenses.length, 'artifact license evidence absent');
    for (const item of [...module.licenses, ...module.notices]) {
      assert.ok(item.file && item.sha256, 'license source fingerprint required');
      assert.equal(sha(join(bundle, 'supply', item.file)), item.sha256);
    }
  }
  return { schemaVersion: 'bank-distribution-supply/v2', files: Object.keys(manifest.files).length, frozenRuntimeVerified: true, pluginLicenseEvidenceVerified: true,
    historicalUnresolved: supply.unresolved, scope: 'Validated darwin-x86_64 file supply and runtime source packages. Historical unresolved declarations remain recorded; actual selected dependency closure requires cold execution.', externalPrerequisites: manifest.externalPrerequisites };
}
export async function promoteDistribution({ bundle, work, destination }) {
  const manifest = verifyBundleFiles(bundle), supply = verifyDistributionSupply(bundle);
  const certFile = join(work, 'certification/RESULT.json'), certification = json(certFile);
  assert.deepEqual(await certifyRelease({ bundle, work }), certification, 'certification must match freshly recomputed evidence');
  assert.equal(certification.schemaVersion, 'bank-v1-certification/v2');
  const business = certification.slots.filter(s => !s.index.startsWith('P32:'));
  assert.equal(business.length, 22); assert.ok(business.every(s => s.status === 'proven'), 'all original business requirements must be proven before promotion');
  assert.ok(certification.results.every(r => r.status === 'verified'), 'required concrete evidence remains blocked');
  assert.equal(resolve(destination), destination); assert.ok(destination.endsWith('/dist/v1'));
  assert.equal(existsSync(destination), false, 'dist/v1 is occupied');
  let parent = dirname(destination);
  while (!existsSync(parent)) parent = dirname(parent);
  assert.equal(realpathSync(parent), parent);
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(destination);
  for (const path of Object.keys(manifest.files)) {
    safeRelative(path);
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(bundle, path), target, constants.COPYFILE_EXCL);
    assert.equal(sha(target), manifest.files[path]);
  }
  copyFileSync(join(bundle, 'BUNDLE.json'), join(destination, 'BUNDLE.json'), constants.COPYFILE_EXCL);
  verifyBundleFiles(destination);
  const result = { schemaVersion: 'bank-dist-promotion/v2', sourceBundleSha256: sha(join(bundle, 'BUNDLE.json')), destination, inventory: manifest.files,
    certification: { file: certFile, sha256: sha(certFile) }, supply, sourceCopiedWithoutPrivateRuntimeData: true, installedRuntimeVerification: false, accepted: false };
  writeFileSync(join(destination, 'PROMOTION.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}
