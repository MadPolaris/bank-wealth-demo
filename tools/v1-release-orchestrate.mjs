import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recoveryCases = ['request-before-start', 'refund-before-assembly', 'refund-prepare', 'refund-collection-commit', 'refund-investor-commit', 'payment-prepare', 'payment-investor-commit', 'payment-collection-commit', 'ta-register-before-assembly', 'ta-intent-before-submit', 'ta-submitted-before-bank-accept', 'ta-accepted-before-effect-reply', 'ta-confirmed-before-ingest', 'ta-rejected-after-ingest-before-ack', 'payment-succeeded-before-delivery-ack', 'refund-succeeded-before-delivery-ack', 'sip-intent-before-create', 'sip-create-before-append', 'sip-append-before-next', 'sip-before-seal', 'sip-tick-before-catchup', 'sip-occurrence-before-dispatch', 'sip-terminal-before-bridge', 'sip-terminal-ack-lost'];
const stages = ['capture', 'generate-js', 'generate-bc', 'admission', 'build-js', 'build-bc', 'http-js', 'http-bc', ...['js', 'bc'].flatMap(chain => recoveryCases.map(name => 'recovery-' + chain + '-' + name)), 'runtime-js', 'runtime-bc', 'final-provenance', 'certify', 'promote'];
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function checkExecution(config) {
  const replay = config.schemaVersion === 'bank-v1-replay/v2';
  assert.ok(replay || config.schemaVersion === 'bank-v1-execution/v2');
  assert.ok(Object.keys(config).every(k => ['schemaVersion', 'bundle', 'workId', 'javaHome', 'python', 'sources', 'runtime'].includes(k)));
  assert.match(config.workId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/);
  assert.equal(resolve(config.bundle), config.bundle);
  if (replay) {
    assert.equal(realpathSync(config.bundle), config.bundle);
    assert.ok(existsSync(join(config.bundle, 'BUNDLE.json')));
    assert.equal(existsSync(join(config.bundle, 'bank/.scratch/p26-p32-bank-v1-59o__arv')), false, 'replay work root already exists');
    assert.equal(config.sources, undefined);
  } else {
    assert.ok(config.bundle.startsWith(join(ROOT, '.scratch') + '/'));
    assert.equal(existsSync(config.bundle), false, 'candidate bundle already exists');
    assert.equal(realpathSync(dirname(config.bundle)), dirname(config.bundle));
  }
  assert.equal(realpathSync(config.python), config.python);
  assert.ok(existsSync(join(config.javaHome, 'bin/java')) && existsSync(join(config.javaHome, 'bin/javac')));
  if (!replay) {
    assert.deepEqual(Object.keys(config.sources).sort(), ['admissionFixture', 'bcCapture', 'bcRuntime', 'jsCapture', 'license', 'options', 'support']);
    for (const path of Object.values(config.sources)) assert.equal(realpathSync(path), path);
  }
  return { schemaVersion: 'bank-v1-execution-plan/v2', stages: replay ? stages.filter(s => !['capture', 'promote'].includes(s)) : stages, bundle: config.bundle, runtimeConfigured: !!config.runtime, accepted: false };
}
async function invoke(python, script, configuration, stage, root, seconds) {
  const out = openSync(join(root, stage + '.stdout.log'), 'wx'), err = openSync(join(root, stage + '.stderr.log'), 'wx');
  const args = [script, '--config', configuration, '--stage', stage];
  let child, timer, killer, timedOut = false, cancelled = null;
  const stop = signal => { cancelled = signal; if (child && child.exitCode === null) { child.kill('SIGTERM'); killer ??= setTimeout(() => child.kill('SIGKILL'), 15000); } };
  const term = () => stop('SIGTERM'), int = () => stop('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', int);
  try {
    child = spawn(python, args, { cwd: ROOT, env: { HOME: process.env.HOME, PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', out, err] });
    const result = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => done({ code, signal }));
      timer = setTimeout(() => { timedOut = true; stop('timeout'); }, seconds * 1000);
    });
    const receipt = { stage, argv: [python, ...args], pid: child.pid, waited: true, ...result, timedOut, cancelled,
      authorSha256: sha(script), configSha256: sha(configuration), logs: Object.fromEntries(['stdout', 'stderr'].map(stream => { const file = join(root, stage + '.' + stream + '.log'); return [stream, { file, sha256: sha(file) }]; })) };
    writeFileSync(join(root, stage + '.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    assert.equal(result.code, 0, `release stage ${stage} failed; logs retained in ${root}`);
    assert.equal(timedOut, false); assert.equal(cancelled, null);
    return receipt;
  } finally {
    clearTimeout(timer); clearTimeout(killer); process.off('SIGTERM', term); process.off('SIGINT', int); closeSync(out); closeSync(err);
  }
}
export async function runExecution(config, configuration) {
  const plan = checkExecution(config), root = join(dirname(configuration), 'execution');
  mkdirSync(root);
  const report = { schemaVersion: 'bank-v1-execution-report/v2', plan, steps: [], accepted: false, distCreated: false, status: 'running', exitCode: 2 };
  try {
    for (const stage of plan.stages) {
      if (stage.startsWith('runtime') && !config.runtime) throw new Error('Explicit local runtime configuration required');
      const script = stage === 'capture' ? join(ROOT, 'tools/v1-release-execute.py') : join(config.bundle, 'bank/tools/v1-release-execute.py');
      process.stderr.write(`release: ${stage}\n`);
      report.steps.push(await invoke(config.python, script, configuration, stage, root, stage.startsWith('recovery') ? 460 : stage.startsWith('runtime') ? 1800 : stage.startsWith('build') ? 550 : 400));
    }
    const work = join(config.bundle, 'bank/.scratch/p26-p32-bank-v1-59o__arv');
    const certification = JSON.parse(readFileSync(join(work, 'certification/RESULT.json'), 'utf8'));
    report.certification = { file: join(work, 'certification/RESULT.json'), sha256: sha(join(work, 'certification/RESULT.json')) };
    assert.equal(certification.slots.length, 25);
    assert.ok(certification.slots.filter(s => !s.index.startsWith('P32:')).every(s => s.status === 'proven'), 'original business certification incomplete');
    assert.ok(certification.results.every(r => r.status === 'verified'), 'required concrete evidence remains incomplete');
    report.status = 'verified-execution'; report.exitCode = 0;
    report.distCreated = plan.stages.includes('promote');
    if (report.distCreated) {
      const promotion = JSON.parse(readFileSync(join(work, 'promotion/RESULT.json'), 'utf8'));
      const replayRoot = join(dirname(configuration), 'installed-replay'); mkdirSync(replayRoot);
      const replayConfig = { schemaVersion: 'bank-v1-replay/v2', bundle: promotion.destination, workId: config.workId + 'installed', javaHome: config.javaHome, python: config.python, runtime: config.runtime };
      const replayFile = join(replayRoot, 'CONFIG.json'); writeFileSync(replayFile, JSON.stringify(replayConfig, null, 2) + '\n', { flag: 'wx' });
      const installed = await runExecution(replayConfig, replayFile);
      assert.equal(installed.status, 'verified-execution', 'installed distribution replay did not pass');
      report.installedReplay = { file: join(replayRoot, 'execution/REPORT.json'), sha256: sha(join(replayRoot, 'execution/REPORT.json')) };
      const finalizer = join(promotion.destination, 'bank/tools/v1-release-stage.mjs');
      const installedWork = join(promotion.destination, 'bank/.scratch/p26-p32-bank-v1-59o__arv');
      const node = join(promotion.destination, 'node/bin/node');
      const finalized = await new Promise((done, reject) => {
        const p = spawn(node, [finalizer, 'accept-installed', promotion.destination, installedWork, config.bundle, work], { cwd: ROOT,
          env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TRUTHSRC_ROOT: join(promotion.destination, 'js-generator'), GIT_CEILING_DIRECTORIES: promotion.destination }, stdio: ['ignore', 'inherit', 'inherit'] });
        p.once('error', reject); p.once('close', code => done(code));
      });
      assert.equal(finalized, 0, 'installed release finalizer failed');
      const accepted = JSON.parse(readFileSync(join(promotion.destination, 'RELEASE-ACCEPTANCE.json'), 'utf8'));
      assert.equal(accepted.accepted, true); assert.equal(accepted.allOriginalRequiredProven, true);
      report.status = 'passed'; report.exitCode = 0; report.accepted = true;
      report.acceptance = { file: join(promotion.destination, 'RELEASE-ACCEPTANCE.json'), sha256: sha(join(promotion.destination, 'RELEASE-ACCEPTANCE.json')) };
    }
  } catch (error) { report.status = 'failed'; report.exitCode = 1; report.reason = error.message; }
  writeFileSync(join(root, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}
