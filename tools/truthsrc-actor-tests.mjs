import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';
import { canonicalJson, digest } from '../simulator/contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ACTOR_SUITES = [
  ['example.bankwealth.service.BankSinglePaymentOracleSpec', 1, 'payment'],
  ['BankPaymentDeliveryAcceptanceSpec', 4, 'payment'],
  ['example.bankwealth.service.BankPaymentRecoverySpec', 1, 'payment'],
  ['BankTaApplicationSpec', 8, 'ta'],
  ['BankRefundApplicationSpec', 7, 'refund'],
  ['BankSipApplicationSpec', 9, 'sip'],
  ['BankSipRecoverySpec', 10, 'sip'],
  ['BankSipCatchupJointSpec', 1, 'sip'],
];
export const ACTOR_WORKER = join(ROOT, 'tools/truthsrc-actor-ta-worker.mjs');
export const ACTOR_FIXTURE = join(ROOT, 'test/fixtures/truthsrc-actor-ta.json');
export const ACTOR_SUPPORT = [
  'tools/truthsrc-actor-tests.mjs', 'tools/truthsrc-actor-ta-worker.mjs',
  'simulator/mock-ta-core.mjs', 'simulator/contract.mjs', 'simulator/journal.mjs',
  'test/fixtures/truthsrc-actor-ta.json',
].map(file => join(ROOT, file)).concat(join(ROOT, '../metarch-truthsrc/lib/strict-json.mjs'));
export const ACTOR_READ_DENIALS = ['tree', 'v1/tree', '.scratch', 'dist/v1', 'tools/truth-source.mjs'].map(file => join(ROOT, file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refundPhases = ['prepare', 'collection-commit', 'investor-commit'];

export function actorSuiteNames() { return ACTOR_SUITES.map(([name]) => name).sort(); }

export function actorTestManifest(read = file => readFileSync(file, 'utf8')) {
  const suites = ACTOR_SUITES.map(([name, count, flow]) => {
    const short = name.split('.').at(-1), file = join(ROOT, 'test/scala', short + '.scala');
    const content = read(file);
    const classes = [...content.matchAll(/^final class ([A-Za-z][A-Za-z0-9]*) extends AnyFunSuite \{/gm)].map(m => m[1]);
    assert.deepEqual(classes, [short], 'unexpected actor suite class: ' + file);
    const packages = [...content.matchAll(/^package ([A-Za-z][A-Za-z0-9.]*)$/gm)].map(m => m[1]);
    assert.deepEqual(packages, name.includes('.') ? [name.slice(0, name.lastIndexOf('.'))] : [], 'unexpected actor suite package');
    const tests = [...content.matchAll(/^  test\(("(?:[^"\\\r\n]|\\.)*")\) \{/gm)].map(m => JSON.parse(m[1]));
    if (short === 'BankRefundApplicationSpec') {
      assert.ok(content.includes('for (phase <- Vector("prepare", "collection-commit", "investor-commit")) {'), 'refund phase expansion changed');
      assert.ok(content.includes('    test("REFUND-automatic-recovery: durable " + phase + " resumes from discovery without operator reconciliation") {'),
        'refund recovery test expression changed');
      tests.push(...refundPhases.map(phase => 'REFUND-automatic-recovery: durable ' + phase + ' resumes from discovery without operator reconciliation'));
    }
    assert.equal(tests.length, count, 'actor test count changed: ' + name);
    assert.equal(new Set(tests).size, count, 'duplicate actor test name');
    return { name, file, sha256: hash(content), tests, flow, sourceKind: 'frozen-business-test' };
  });
  return { suites, suiteCount: suites.length, testCount: suites.reduce((n, suite) => n + suite.tests.length, 0), zeroTestSuites: [] };
}

export function combineActorManifest(generated, actors) {
  assert.deepEqual(actors.suites.map(s => s.name).sort(), actorSuiteNames());
  assert.equal(actors.testCount, 41);
  const suites = [...generated.suites.map(suite => ({ ...suite, sourceKind: 'current-generated-test' })), ...actors.suites];
  assert.equal(new Set(suites.map(s => s.name)).size, suites.length);
  return { suites, suiteCount: suites.length, testCount: generated.testCount + actors.testCount,
    zeroTestSuites: generated.zeroTestSuites, generatedTests: generated.testCount, businessTests: actors.testCount,
    scope: 'four-flow actor regression with testkit and an explicitly frozen external-TA fixture; not HTTP or multi-JVM recovery' };
}

export function actorOwnedRoot(evidence) {
  assert.equal(dirname(evidence), join(ROOT, 'target'));
  assert.match(basename(evidence), /^[A-Za-z0-9_.-]+$/);
  return join(ROOT, '.local/mock-ta', 'truthsrc-actors-' + basename(evidence));
}

export function actorReadProbeSource(config, ownedRoot) {
  const loader = join(ROOT, 'tools/truth-source.mjs');
  return `import errno, os, pathlib
for file in ${JSON.stringify([loader])}:
    try:
        with open(file, 'rb') as stream: stream.read(1)
    except OSError as error:
        assert error.errno in (errno.EPERM, errno.EACCES)
    else: raise RuntimeError('historical truth loader was readable')
try:
    with open(${JSON.stringify(config)}, 'ab') as stream: stream.write(b'UNSAFE')
except OSError as error:
    assert error.errno in (errno.EPERM, errno.EACCES)
else: raise RuntimeError('actor configuration was writable')
with open(${JSON.stringify(join(ownedRoot, 'sandbox-write-probe'))}, 'xb') as stream: stream.write(b'owned-ta-write-allowed\\n')
print('TRUTHSRC-ACTOR-SANDBOX-OK')
`;
}

function regular(file) {
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && realpathSync(file) === file, 'regular owned worker evidence required');
  return readFileSync(file);
}
function records(file) {
  const text = regular(file).toString('utf8');
  assert.ok(text.length > 0 && text.endsWith('\n'), 'complete worker JSONL required');
  return text.slice(0, -1).split('\n').map(line => parseStrictJson(line));
}
export function verifyActorWorkers(actor, alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}) {
  const files = readdirSync(actor.ownedRoot).sort();
  const directories = files.filter(name => name.startsWith('owner-b-application-'));
  assert.deepEqual(files.filter(name => !directories.includes(name)), ['actor-owner.json', 'actor-ta.json', 'sandbox-write-probe']);
  assert.equal(directories.length, 15, 'expected one independent TA journal per TA/refund test');
  const pids = [], journals = [], workers = [];
  for (const name of directories) {
    const root = join(actor.ownedRoot, name), stat = lstatSync(root);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(root) === root);
    const entries = readdirSync(root).sort();
    assert.ok(!entries.some(file => file.endsWith('.lock')), 'owned TA journal lock remains');
    assert.ok(entries.every(file => file === 'ta.jsonl' || /^worker(?:-reopened-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(?:jsonl|stderr\.log)$/.test(file) ||
      /^ta-worker-[0-9]+\.json$/.test(file)), 'unknown TA output file');
    const receipts = entries.filter(file => /^ta-worker-[0-9]+\.json$/.test(file)).map(file => parseStrictJson(regular(join(root, file))));
    const transcripts = entries.filter(file => /^worker(?:-reopened-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.jsonl$/.test(file));
    assert.ok(transcripts.includes('worker.jsonl'));
    assert.equal(receipts.length, transcripts.length, 'worker lifecycle receipt missing');
    for (const file of transcripts) {
      const rows = records(join(root, file)), starts = rows.filter(row => row.kind === 'worker-started'), ends = rows.filter(row => row.kind === 'worker-exited');
      assert.equal(starts.length, 1); assert.equal(ends.length, 1);
      const pid = starts[0].pid, end = ends[0];
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      assert.equal(end.pid, pid); assert.equal(end.waited, true); assert.equal(end.exitCode, 0);
      assert.equal(alive(pid), false, 'TA worker remains alive');
      const receipt = receipts.find(row => row.pid === pid);
      assert.equal(receipt?.schemaVersion, 'bank.truthsrc-actor-ta-worker/v1');
      assert.equal(receipt.closed, true); assert.equal(receipt.journalPath, join(root, 'ta.jsonl'));
      assert.equal(receipt.ownedRoot, root); assert.equal(receipt.roundRoot, actor.ownedRoot);
      assert.equal(receipt.configSha256, actor.configSha256); assert.equal(receipt.fixtureSha256, actor.fixtureSha256);
      assert.equal(receipt.configurationDigest, actor.configurationDigest);
      assert.ok(rows.some(row => row.op === 'close') && rows.some(row => row.ok === true && row.result?.closed === true), 'worker graceful close exchange missing');
      const stderr = regular(join(root, file.replace(/\.jsonl$/, '.stderr.log')));
      assert.equal(stderr.length, 0, 'TA worker stderr must be empty');
      pids.push(pid); workers.push({ pid, transcript: join(root, file), receipt });
    }
    const journal = join(root, 'ta.jsonl'), events = records(journal);
    let previousHash = null;
    const requests = new Set();
    for (const [index, row] of events.entries()) {
      assert.equal(row.schemaVersion, 'bank-wealth.mock-ta-journal/v1'); assert.equal(row.seq, index + 1);
      assert.equal(row.configDigest, actor.configurationDigest); assert.equal(row.previousHash, previousHash);
      const { recordHash, ...body } = row;
      assert.equal(recordHash, digest(canonicalJson(body)));
      previousHash = recordHash;
      if (row.event.kind === 'RequestSubmitted') {
        assert.ok(!requests.has(row.event.request.requestId), 'duplicate canonical TA submission');
        requests.add(row.event.request.requestId);
      }
    }
    assert.equal(events[0].event.kind, 'Initialized');
    journals.push({ file: journal, records: events.length, submissions: requests.size, sha256: hash(regular(journal)) });
  }
  assert.equal(pids.length, 16, 'expected one additional worker reopen in delayed TA test');
  assert.equal(new Set(pids).size, pids.length, 'reused worker pid');
  return { passed: true, journals, workers, journalCount: journals.length, workerCount: workers.length,
    workersExitedAndWaited: true, configurationDigest: actor.configurationDigest, fixtureSha256: actor.fixtureSha256 };
}
