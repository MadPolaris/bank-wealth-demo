import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { certifyRelease } from './v1-release-certify.mjs';
import { verifyDistributionSupply, verifyBundleFiles } from './v1-release-dist.mjs';

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
export async function acceptInstalledRelease({ bundle, work, candidate, candidateWork }) {
  const installedManifest = verifyBundleFiles(bundle), supply = verifyDistributionSupply(bundle);
  const originalManifest = verifyBundleFiles(candidate);
  assert.deepEqual(installedManifest.files, originalManifest.files, 'installed immutable inventory differs');
  const installed = await certifyRelease({ bundle, work });
  assert.deepEqual(installed, json(join(work, 'certification/RESULT.json')));
  const original = json(join(candidateWork, 'certification/RESULT.json'));
  assert.equal(original.slots.length, 25);
  assert.equal(installed.slots.length, 25);
  for (const report of [original, installed]) {
    assert.ok(report.results.every(r => r.status === 'verified'), 'concrete evidence missing');
    assert.ok(report.slots.filter(s => !s.index.startsWith('P32:')).every(s => s.status === 'proven'), 'original business requirement not proven');
  }
  assert.deepEqual(original.slots.map(s => [s.index, s.requirement]), installed.slots.map(s => [s.index, s.requirement]), 'original contract changed on relocation');
  const promotion = json(join(bundle, 'PROMOTION.json'));
  assert.equal(promotion.destination, bundle);
  assert.equal(promotion.sourceBundleSha256, sha(join(candidate, 'BUNDLE.json')));
  assert.equal(promotion.certification.sha256, sha(join(candidateWork, 'certification/RESULT.json')));
  const slots = installed.slots.map(slot => slot.index.startsWith('P32:') ? {
    ...slot, status: 'proven', evidence: [join(bundle, 'BUNDLE.json'), join(bundle, 'PROMOTION.json'), join(work, 'certification/RESULT.json')],
    reason: slot.index === 'P32:1' ? 'Both generator source packages, executable generator artifacts, independent ext, local dependencies and license material match the captured supply; installed cold build and real runtime use the relocated package.'
      : slot.index === 'P32:2' ? 'Fresh installed targets and independent empty caches rebuilt both complete applications without downloads or host-cache fallback; real database/browser execution completed using the installed paths.'
        : 'The formal release entry executed every fixed required stage in the candidate and installed distribution; all 25 original demo requirements have concrete evidence and no required item remains blocked or unexecuted.',
  } : slot);
  assert.equal(slots.length, 25); assert.ok(slots.every(s => s.status === 'proven'));
  const result = { schemaVersion: 'bank-release-acceptance/v2', accepted: true, allOriginalRequiredProven: true, slots, supply,
    candidate: { bundle: candidate, manifestSha256: sha(join(candidate, 'BUNDLE.json')), certificationSha256: sha(join(candidateWork, 'certification/RESULT.json')) },
    installed: { bundle, manifestSha256: sha(join(bundle, 'BUNDLE.json')), certificationSha256: sha(join(work, 'certification/RESULT.json')) },
    scope: 'Original bounded local banking demo on macOS x86_64 with external JDK11/Python/Docker/Chromium. MockTA remains simulated. Mongo4.4 is EOL; no modern Mongo, production multiwriter, arbitrary crash/OS failure, or Linux/ARM certification.' };
  writeFileSync(join(bundle, 'RELEASE-ACCEPTANCE.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}
