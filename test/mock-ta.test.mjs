import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdtempSync, rmSync, renameSync, unlinkSync, closeSync, fstatSync,
  existsSync, symlinkSync, linkSync, writeSync, fsyncSync, truncateSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSnapshot } from '../tools/truth-source.mjs';
import { canonicalJson, clone, CONTRACT_ID, digest, loadMockContract, MAX_STRING_BYTES } from '../simulator/contract.mjs';
import { MOCK_ROOT, resolveJournalPath, MAX_JOURNAL_BYTES } from '../simulator/journal.mjs';
import { main as cliMain } from '../tools/mock-ta.mjs';
import { ConflictError, persistentMockTA } from '../simulator/mock-ta.mjs';

// No private scenario authority: positive fixtures and timing come from the real truth note.
let snapshot, configuration, sourceFailure;
try { snapshot = loadSnapshot(); configuration = loadMockContract(snapshot); }
catch (error) { sourceFailure = error; }
const fixture = (id) => configuration.scenarios.find((scenario) => scenario.id === id);
const artifact = (source) => source.atoms.find(({ doc }) => doc.payload?.info?.artifact?.id === CONTRACT_ID).doc.payload.info.artifact;
const request = (scenario = 'confirmed', requestId = `request-${scenario}`) => ({
  requestId, orderId: `order-${requestId}`, paymentTxId: `payment-${requestId}`,
  investorAccountId: 'investor-001', fundCollectionAccountId: 'collection-001', fundCode: 'DEMO-FUND',
  amount: { minorUnits: '10000', currency: configuration.currency }, scenario,
});
const finals = (receipts) => receipts.filter((receipt) => ['confirmed', 'rejected'].includes(receipt.outcome));

function scratchDirectory(scratch = join(MOCK_ROOT, '.scratch')) {
  // Preflight before mkdir/mkdtemp: an existing .scratch symlink must never be followed.
  resolveJournalPath(join(scratch, 'mock-ta-test-preflight.jsonl'));
  return mkdtempSync(join(scratch, 'mock-ta-test-'));
}

function mockTest(name, body) {
  test(name, { skip: sourceFailure ? `Truth config not ready: ${sourceFailure.message}` : false }, (t) => {
    const directory = scratchDirectory();
    const instances = [];
    const journalPath = join(directory, 'journal.jsonl');
    const open = (options = {}) => {
      const ta = persistentMockTA({ snapshot, journalPath, ...options });
      instances.push(ta);
      return ta;
    };
    try { body({ t, directory, journalPath, open }); }
    finally {
      try { for (const ta of instances) ta.close(); }
      finally {
        // Do not recursively clean a path whose containment was lost during a test.
        resolveJournalPath(join(directory, 'cleanup-preflight.jsonl'));
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
}

test('real new cash-purchase truth provides the complete valid MockTA configuration', () => {
  if (sourceFailure) throw sourceFailure;
  assert.equal(configuration.schemaVersion, 'bank-wealth.mock-ta/v1');
  assert.deepEqual(configuration.scenarios.map((entry) => entry.id).sort(),
    ['accepted', 'confirmed', 'delayed', 'duplicate-conflicting', 'duplicate-identical', 'rejected', 'unknown']);
  assert.deepEqual(configuration, artifact(snapshot).body.mockConfiguration);
  assert.ok(Object.isFrozen(configuration));
  assert.ok(Object.isFrozen(fixture('confirmed').fixture));
  assert.throws(() => { fixture('confirmed').fixture.shares = '999'; }, TypeError);
});

mockTest('contract is detached and frozen; missing/duplicate/wrong-category sources never fall back', () => {
  const changed = structuredClone(snapshot);
  const frozen = loadMockContract(changed);
  artifact(changed).body.mockConfiguration.scenarios[0].fixture.shares = '999';
  assert.notEqual(frozen.scenarios[0].fixture.shares, '999');
  const missing = structuredClone(snapshot);
  missing.atoms = missing.atoms.filter(({ doc }) => doc.payload?.info?.artifact?.id !== CONTRACT_ID);
  assert.throws(() => loadMockContract(missing), { code: 'MISSING_CONTRACT' });
  const wrong = structuredClone(snapshot);
  artifact(wrong).category = 'mock-ta';
  assert.throws(() => loadMockContract(wrong), { code: 'MISSING_CONTRACT' });
  const duplicate = structuredClone(snapshot);
  duplicate.atoms.push(clone(duplicate.atoms.find(({ doc }) => doc.payload?.info?.artifact?.id === CONTRACT_ID)));
  assert.throws(() => loadMockContract(duplicate), { code: 'MISSING_CONTRACT' });
});

mockTest('strict configuration rejects missing/conflicting fixtures, floats and additional authority', () => {
  for (const mutate of [
    (config) => { delete config.scenarios.find((entry) => entry.delivery === 'conflicting-duplicate').conflictFixture; },
    (config) => { const entry = config.scenarios.find((value) => value.delivery === 'conflicting-duplicate'); entry.conflictFixture = clone(entry.fixture); },
    (config) => { config.scenarios[0].fixture.nav = 1.2345; },
    (config) => { config.scenarios[0].fixture.nav = '01.2345'; },
    (config) => { config.initialBusinessTick = -1; },
    (config) => { config.scenarios[0].delayTicks = 0.5; },
    (config) => { config.scenarios[0].fixture.currency = 'CNY'; },
    (config) => { config.currency = 'USD'; },
    (config) => { config.feesMinorUnits = '1'; },
    (config) => { config.scenarios.push(clone(config.scenarios[0])); },
    (config) => { config.fallback = true; },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(artifact(changed).body.mockConfiguration);
    assert.throws(() => loadMockContract(changed));
  }
});

mockTest('accepted then next configured tick confirmed with exact correlations and fixture strings', ({ open, journalPath }) => {
  const ta = open();
  const input = request();
  const submitted = ta.submit(input);
  assert.equal(submitted.status, 'accepted');
  assert.equal(submitted.pending, true);
  assert.equal(submitted.submittedTick, configuration.initialBusinessTick);
  assert.equal(submitted.receipts.length, 1);
  const accepted = submitted.receipts[0];
  assert.equal(accepted.outcome, 'accepted');
  assert.notEqual(accepted.receiptId, input.requestId);
  const records = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(records.map((record) => record.seq), [1, 2]);
  assert.equal(records[1].event.request.paymentTxId, input.paymentTxId);
  assert.equal(records[1].event.dueTick, configuration.initialBusinessTick + fixture('confirmed').delayTicks);
  const advanced = ta.advanceBusinessClock(fixture('confirmed').delayTicks);
  assert.equal(advanced.receipts.length, 1);
  const confirmed = advanced.receipts[0];
  assert.equal(confirmed.outcome, 'confirmed');
  assert.notEqual(accepted.receiptId, confirmed.receiptId);
  assert.notEqual(confirmed.receiptId, input.requestId);
  assert.equal(confirmed.taReference, accepted.taReference);
  for (const key of ['requestId', 'orderId', 'paymentTxId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'amount']) assert.deepEqual(confirmed[key], input[key]);
  assert.deepEqual(confirmed.shares, { fundCode: input.fundCode, ...fixture('confirmed').fixture });
  assert.equal(ta.query(input.requestId).status, 'confirmed');
  assert.equal(ta.query(input.requestId).pending, false);
  assert.equal(JSON.parse(readFileSync(journalPath, 'utf8').trimEnd().split('\n').at(-1)).event.receipts[0].receiptId, confirmed.receiptId);
});

mockTest('delayed stays accepted until its configured third tick, not the ordinary deadline', ({ open }) => {
  const ta = open();
  const input = request('delayed');
  ta.submit(input);
  const delay = fixture('delayed').delayTicks;
  assert.ok(delay > fixture('confirmed').delayTicks);
  assert.deepEqual(ta.advanceBusinessClock(delay - 1).receipts, []);
  assert.equal(ta.query(input.requestId).status, 'accepted');
  const final = ta.advanceBusinessClock(1).receipts[0];
  assert.equal(final.outcome, 'confirmed');
  assert.deepEqual(final.shares, { fundCode: input.fundCode, ...fixture('delayed').fixture });
});

mockTest('rejected issues a reason, never a refund or account mutation', ({ open, journalPath }) => {
  const ta = open();
  const input = request('rejected');
  ta.submit(input);
  const result = ta.advanceBusinessClock(fixture('rejected').delayTicks);
  assert.equal(result.receipts[0].outcome, 'rejected');
  assert.equal(result.receipts[0].reason, fixture('rejected').reason);
  assert.equal(ta.query(input.requestId).pending, false);
  const events = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line).event);
  assert.deepEqual(events.map((event) => event.kind), ['Initialized', 'RequestSubmitted', 'ClockAdvanced']);
  assert.ok(!Object.hasOwn(result.receipts[0], 'refund'));
  assert.ok(!Object.hasOwn(ta, 'balances'));
  assert.deepEqual(ta.advanceBusinessClock(100).receipts, []);
});

mockTest('unknown and accepted remain pending forever; unknown queries are observations and read-only', ({ open, journalPath }) => {
  const ta = open();
  const input = request('unknown');
  const first = ta.submit(input);
  assert.deepEqual(first.receipts.map((receipt) => receipt.outcome), ['accepted', 'unknown']);
  assert.notEqual(first.receipts[0].receiptId, first.receipts[1].receiptId);
  ta.submit(request('accepted'));
  ta.advanceBusinessClock(1000000);
  const before = readFileSync(journalPath);
  assert.equal(ta.query(input.requestId).status, 'unknown');
  assert.equal(ta.query(input.requestId).pending, true);
  assert.equal(ta.query('request-accepted').status, 'accepted');
  const unknown = ta.query('never-submitted');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.observation.outcome, 'unknown');
  assert.deepEqual(unknown.receipts, []);
  assert.deepEqual(ta.advanceBusinessClock(0).receipts, []);
  assert.deepEqual(readFileSync(journalPath), before);
});

mockTest('same request id and exact payload is reused; different payload has stable conflict and no append', ({ open, journalPath }) => {
  const ta = open();
  const input = request();
  const first = ta.submit(input);
  const before = readFileSync(journalPath);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  assert.deepEqual(ta.submit(reordered), first);
  assert.deepEqual(readFileSync(journalPath), before);
  for (const different of [{ ...input, orderId: 'different' }, { ...input, scenario: 'delayed' }, { ...input, amount: { ...input.amount, minorUnits: '10001' } }]) {
    assert.throws(() => ta.submit(different), (error) => error instanceof ConflictError && error.code === 'REQUEST_CONFLICT');
    assert.deepEqual(readFileSync(journalPath), before);
  }
  ta.advanceBusinessClock(fixture('confirmed').delayTicks);
  const finalBytes = readFileSync(journalPath);
  assert.deepEqual(ta.submit(input), ta.query(input.requestId));
  assert.deepEqual(readFileSync(journalPath), finalBytes);
});

mockTest('identical duplicate deliveries share one canonical final receipt and one persisted decision', ({ open, journalPath }) => {
  const ta = open();
  const input = request('duplicate-identical');
  ta.submit(input);
  const advanced = ta.advanceBusinessClock(fixture('duplicate-identical').delayTicks);
  assert.equal(advanced.canonicalReceipts.length, 1);
  assert.equal(advanced.receipts.length, 2);
  assert.deepEqual(advanced.receipts[0], advanced.receipts[1]);
  assert.deepEqual(advanced.conflicts, []);
  const before = readFileSync(journalPath);
  const query = ta.query(input.requestId);
  assert.equal(finals(query.canonicalReceipts).length, 1);
  assert.equal(finals(query.receipts).length, 2);
  assert.deepEqual(readFileSync(journalPath), before);
  ta.close();
  assert.deepEqual(open().query(input.requestId), query);
});

mockTest('conflicting duplicate reports same receipt id with configured changed body, without replacing original', ({ open, journalPath }) => {
  const ta = open();
  const input = request('duplicate-conflicting');
  ta.submit(input);
  const advanced = ta.advanceBusinessClock(fixture('duplicate-conflicting').delayTicks);
  assert.equal(advanced.canonicalReceipts.length, 1);
  assert.equal(advanced.receipts.length, 2);
  assert.equal(advanced.receipts[0].receiptId, advanced.receipts[1].receiptId);
  assert.deepEqual(advanced.receipts[0].shares, { fundCode: input.fundCode, ...fixture('duplicate-conflicting').fixture });
  assert.deepEqual(advanced.receipts[1].shares, { fundCode: input.fundCode, ...fixture('duplicate-conflicting').conflictFixture });
  assert.equal(advanced.conflicts[0].code, 'RECEIPT_CONFLICT');
  const query = ta.query(input.requestId);
  assert.deepEqual(finals(query.canonicalReceipts)[0], advanced.receipts[0]);
  const bytes = readFileSync(journalPath);
  ta.query(input.requestId);
  assert.deepEqual(readFileSync(journalPath), bytes);
  ta.close();
  assert.deepEqual(open().query(input.requestId), query);
});

mockTest('close/reopen preserves business clock, accepted tick, pending deadline and every receipt', ({ open }) => {
  let ta = open();
  for (const id of ['confirmed', 'delayed', 'unknown', 'accepted']) ta.submit(request(id));
  ta.advanceBusinessClock(fixture('confirmed').delayTicks);
  const before = ['confirmed', 'delayed', 'unknown', 'accepted'].map((id) => ta.query(`request-${id}`));
  const tick = ta.businessTick;
  ta.close();
  ta = open();
  assert.equal(ta.businessTick, tick);
  assert.deepEqual(['confirmed', 'delayed', 'unknown', 'accepted'].map((id) => ta.query(`request-${id}`)), before);
  ta.advanceBusinessClock(fixture('delayed').delayTicks - fixture('confirmed').delayTicks);
  const final = ta.query('request-delayed');
  ta.close();
  assert.deepEqual(open().query('request-delayed'), final);
});

mockTest('submission and query results are detached snapshots; caller mutations cannot change canonical state', ({ open }) => {
  const ta = open();
  const input = request();
  const submitted = ta.submit(input);
  input.amount.minorUnits = '99999';
  submitted.request.amount.minorUnits = '99999';
  submitted.receipts[0].orderId = 'wrong';
  assert.equal(ta.query(input.requestId).request.amount.minorUnits, '10000');
  ta.advanceClock(fixture('confirmed').delayTicks);
  const final = ta.query(input.requestId);
  final.receipts[1].shares.shares = '999';
  final.canonicalReceipts.pop();
  assert.equal(ta.query(input.requestId).canonicalReceipts.length, 2);
  assert.deepEqual(ta.query(input.requestId).receipts[1].shares, { fundCode: input.fundCode, ...fixture('confirmed').fixture });
});

mockTest('all required fields are closed; bad amounts/currency/accounts/scenarios and invalid clock reject without append', ({ open, journalPath }) => {
  const ta = open();
  const good = request();
  const invalid = [
    ...Object.keys(good).map((key) => { const copy = clone(good); delete copy[key]; return copy; }),
    ...['requestId', 'orderId', 'paymentTxId', 'investorAccountId', 'fundCollectionAccountId', 'fundCode', 'scenario'].flatMap((key) => ['', '  ', 1, null].map((value) => ({ ...good, [key]: value }))),
    ...['0', '-1', '01', '+1', '1.0', '1e2', ' 1', 1.2, 10000, null].map((minorUnits) => ({ ...good, amount: { ...good.amount, minorUnits } })),
    { ...good, amount: { minorUnits: '1', currency: 'USD' } },
    { ...good, amount: { ...good.amount, extra: true } },
    { ...good, fundCollectionAccountId: good.investorAccountId },
    { ...good, scenario: 'invented' }, { ...good, extra: true },
  ];
  const before = readFileSync(journalPath);
  for (const input of invalid) assert.throws(() => ta.submit(input));
  for (const ticks of [-1, -0, 0.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => ta.advanceBusinessClock(ticks));
  assert.throws(() => ta.query(''));
  assert.deepEqual(readFileSync(journalPath), before);
  ta.advanceBusinessClock(Number.MAX_SAFE_INTEGER - ta.businessTick);
  const last = readFileSync(journalPath);
  assert.throws(() => ta.advanceBusinessClock(1));
  assert.throws(() => ta.submit(good));
  assert.deepEqual(readFileSync(journalPath), last);
});

mockTest('one clock record includes all due receipts atomically in deterministic request-id order', ({ open, journalPath }) => {
  const ta = open();
  for (const id of ['z', 'a', 'm']) ta.submit(request('confirmed', id));
  const result = ta.advanceBusinessClock(fixture('confirmed').delayTicks);
  assert.deepEqual(result.canonicalReceipts.map((receipt) => receipt.requestId), ['a', 'm', 'z']);
  const records = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(records.length, 5);
  assert.deepEqual(records.at(-1).event.receipts, result.canonicalReceipts);
  ta.close();
  const reopened = open();
  for (const id of ['a', 'm', 'z']) assert.equal(reopened.query(id).status, 'confirmed');
});

mockTest('deterministic ids/receipts do not depend on journal path or configuration key order', ({ open, directory }) => {
  const first = open();
  const secondSnapshot = structuredClone(snapshot);
  const config = artifact(secondSnapshot).body.mockConfiguration;
  artifact(secondSnapshot).body.mockConfiguration = Object.fromEntries(Object.entries(config).reverse());
  const second = open({ snapshot: secondSnapshot, journalPath: join(directory, 'second.jsonl') });
  assert.deepEqual(first.submit(request()), second.submit(request()));
  assert.deepEqual(first.advanceClock(fixture('confirmed').delayTicks), second.advanceClock(fixture('confirmed').delayTicks));
});

mockTest('a changed truth configuration cannot reopen an existing journal', ({ open, journalPath }) => {
  const ta = open();
  ta.submit(request());
  ta.close();
  const changed = structuredClone(snapshot);
  artifact(changed).body.mockConfiguration.scenarios.find((entry) => entry.id === 'confirmed').delayTicks += 1;
  const before = readFileSync(journalPath);
  assert.throws(() => open({ snapshot: changed }), { code: 'CONFIG_CHANGED' });
  assert.deepEqual(readFileSync(journalPath), before);
  assert.equal(existsSync(`${journalPath}.lock`), false);
  assert.equal(open().query('request-confirmed').status, 'accepted');
});

mockTest('malformed/truncated/noncanonical/sequence/hash/schema/event corruption all fail closed without truncation', ({ open, journalPath }) => {
  const ta = open();
  ta.submit(request());
  ta.advanceClock(fixture('confirmed').delayTicks);
  ta.close();
  const valid = readFileSync(journalPath, 'utf8');
  const records = valid.trimEnd().split('\n').map(JSON.parse);
  const rechain = (entries) => {
    let previousHash = null;
    return entries.map((record) => {
      record.previousHash = previousHash;
      const { recordHash: ignored, ...body } = record;
      record.recordHash = digest(canonicalJson(body));
      previousHash = record.recordHash;
      return canonicalJson(record);
    }).join('\n') + '\n';
  };
  const changes = [];
  for (const mutate of [
    (entries) => { entries[1].seq += 1; },
    (entries) => { entries[1].schemaVersion = 'wrong/v1'; },
    (entries) => { entries[1].extra = true; },
    (entries) => { entries[1].event.dueTick += 1; },
    (entries) => { entries[1].event.request.amount.minorUnits = '0'; },
    (entries) => { entries[2].event.tick = configuration.initialBusinessTick; },
    (entries) => { entries[2].event.receipts[0].paymentTxId = 'wrong'; },
    (entries) => { entries[2].event.receipts[0].shares.nav = '999'; },
    (entries) => { entries[2].event.receipts = []; },
    (entries) => { entries.push(clone(entries[1])); entries.at(-1).seq = 4; },
  ]) { const entries = clone(records); mutate(entries); changes.push(rechain(entries)); }
  const hashChanged = clone(records);
  hashChanged[1].event.request.orderId = 'tampered';
  changes.push(hashChanged.map(canonicalJson).join('\n') + '\n');
  changes.push(valid.slice(0, -1), valid + '{partial', valid + '{bad}\n', valid + '\n',
    valid.replace('"schemaVersion":', '"schemaVersion" :'), '', valid.slice(0, -10));
  for (const damaged of changes) {
    writeFileSync(journalPath, damaged);
    assert.throws(() => open());
    assert.equal(readFileSync(journalPath, 'utf8'), damaged);
    assert.equal(existsSync(`${journalPath}.lock`), false);
  }
  const badUtf8 = Buffer.concat([Buffer.from(valid), Buffer.from([0xff, 0x0a])]);
  writeFileSync(journalPath, badUtf8);
  assert.throws(() => open());
  assert.deepEqual(readFileSync(journalPath), badUtf8);
  writeFileSync(journalPath, valid);
  assert.equal(open().query('request-confirmed').status, 'confirmed');
});

mockTest('a second process writer rejects and a preexisting lock is not stolen or removed', ({ open, journalPath }) => {
  const ta = open();
  const lock = readFileSync(`${journalPath}.lock`);
  assert.throws(() => open(), { code: 'JOURNAL_LOCKED' });
  assert.deepEqual(readFileSync(`${journalPath}.lock`), lock);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { persistentMockTA } from ${JSON.stringify(new URL('../simulator/mock-ta.mjs', import.meta.url).href)};
     try { persistentMockTA({ journalPath: process.argv[1] }); process.exitCode = 2; }
     catch (error) { process.stdout.write(error.code || error.message); process.exitCode = error.code === 'JOURNAL_LOCKED' ? 0 : 3; }`, journalPath],
  { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout, 'JOURNAL_LOCKED');
  ta.close();
  writeFileSync(`${journalPath}.lock`, 'unknown workshop lock');
  assert.throws(() => open(), { code: 'JOURNAL_LOCKED' });
  assert.equal(readFileSync(`${journalPath}.lock`, 'utf8'), 'unknown workshop lock');
});

mockTest('close is idempotent, blocks all operations and never removes a replacement lock', ({ open, journalPath }) => {
  const ta = open();
  // Rewrite only this test-created lock: ownership token no longer matches.
  writeFileSync(`${journalPath}.lock`, 'replacement owner');
  ta.close();
  ta.close();
  assert.equal(readFileSync(`${journalPath}.lock`, 'utf8'), 'replacement owner');
  for (const operation of [() => ta.submit(request()), () => ta.query('id'), () => ta.advanceClock(0), () => ta.businessTick]) {
    assert.throws(operation, { code: 'JOURNAL_CLOSED' });
  }
});

mockTest('journal rejects lexical escapes, symlink directories/files/locks and hard links', ({ open, directory }) => {
  for (const journalPath of ['/tmp/mock-ta-outside.jsonl', '../outside.jsonl', '.scratch/../outside.jsonl', join(MOCK_ROOT, 'tools/not-owned.jsonl')]) {
    assert.throws(() => open({ journalPath }), { code: 'JOURNAL_PATH' });
  }
  symlinkSync(join(MOCK_ROOT, 'tools'), join(directory, 'linked-directory'));
  assert.throws(() => open({ journalPath: join(directory, 'linked-directory/log.jsonl') }), { code: 'JOURNAL_PATH' });
  writeFileSync(join(directory, 'target.jsonl'), 'test-created file');
  symlinkSync(join(directory, 'target.jsonl'), join(directory, 'linked-file.jsonl'));
  assert.throws(() => open({ journalPath: join(directory, 'linked-file.jsonl') }), { code: 'JOURNAL_PATH' });
  linkSync(join(directory, 'target.jsonl'), join(directory, 'hard-linked.jsonl'));
  assert.throws(() => open({ journalPath: join(directory, 'hard-linked.jsonl') }), { code: 'JOURNAL_PATH' });
  symlinkSync(join(directory, 'target.jsonl'), join(directory, 'lock-symlink.jsonl.lock'));
  assert.throws(() => open({ journalPath: join(directory, 'lock-symlink.jsonl') }), { code: 'JOURNAL_PATH' });
});

mockTest('short writes are completed before fsync and ack', ({ open, journalPath }) => {
  open().close();
  let writes = 0, syncs = 0;
  const ta = open({ journalIO: {
    writeSync(fd, buffer, offset, length, position) { writes++; return writeSync(fd, buffer, offset, Math.min(length, 7), position); },
    fsyncSync(fd) { syncs++; fsyncSync(fd); },
  } });
  ta.submit(request());
  assert.ok(writes > 1);
  assert.equal(syncs, 2); // Reopen barrier plus mutation barrier; lock I/O is separate.
  const records = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(records.length, 2);
  ta.close();
  assert.equal(open().query('request-confirmed').status, 'accepted');
});

mockTest('partial write failure poisons the instance and trailing damage rejects reopen without repair', ({ open, journalPath }) => {
  open().close();
  let calls = 0;
  const ta = open({ journalIO: {
    writeSync(fd, buffer, offset, length, position) {
      if (++calls > 1) throw new Error('injected short write failure');
      return writeSync(fd, buffer, offset, Math.min(length, 11), position);
    }, fsyncSync,
  } });
  assert.throws(() => ta.submit(request()), { code: 'JOURNAL_IO' });
  assert.throws(() => ta.query('request-confirmed'), { code: 'JOURNAL_POISONED' });
  assert.throws(() => ta.advanceClock(1), { code: 'JOURNAL_POISONED' });
  ta.close();
  const broken = readFileSync(journalPath);
  assert.throws(() => open());
  assert.deepEqual(readFileSync(journalPath), broken);
});

mockTest('fsync failure returns no ack and poisons; reopening may observe a fully written unacknowledged mutation', ({ open, journalPath }) => {
  open().close();
  let syncs = 0;
  const ta = open({ journalIO: { writeSync, fsyncSync(fd) {
    if (++syncs > 1) throw new Error('injected fsync failure');
    fsyncSync(fd);
  } } });
  assert.throws(() => ta.submit(request()), { code: 'JOURNAL_IO' });
  assert.throws(() => ta.businessTick, { code: 'JOURNAL_POISONED' });
  ta.close();
  // This tests acknowledgement ambiguity, not crash/power-loss durability.
  const reopened = open();
  assert.equal(reopened.query('request-confirmed').status, 'accepted');
  const bytes = readFileSync(journalPath);
  reopened.submit(request());
  assert.deepEqual(readFileSync(journalPath), bytes);
});

mockTest('CLI submit/query/advance reopen the same owned journal and print structured receipts', ({ directory }) => {
  const journalPath = join(directory, 'cli.jsonl');
  const cli = (...args) => spawnSync(process.execPath, [join(MOCK_ROOT, 'tools/mock-ta.mjs'), ...args, '--journal', journalPath], { encoding: 'utf8' });
  let result = cli('submit', '--request', JSON.stringify(request()));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'accepted');
  assert.equal(existsSync(`${journalPath}.lock`), false);
  const before = readFileSync(journalPath);
  result = cli('query', '--request-id', 'request-confirmed');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'accepted');
  assert.deepEqual(readFileSync(journalPath), before);
  result = cli('advance', '--ticks', String(fixture('confirmed').delayTicks));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).receipts[0].outcome, 'confirmed');
  result = cli('submit', '--request', JSON.stringify({ ...request(), orderId: 'changed' }));
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, 'REQUEST_CONFLICT');
  assert.equal(existsSync(`${journalPath}.lock`), false);
});

test('CLI help is explicit and unknown/duplicate/missing flags fail before journal creation', () => {
  const cli = (...args) => spawnSync(process.execPath, [join(MOCK_ROOT, 'tools/mock-ta.mjs'), ...args], { encoding: 'utf8' });
  const help = cli('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /no server/);
  assert.match(help.stdout, /close|closes/);
  for (const args of [[], ['serve'], ['submit', '--unknown', 'x'], ['query'], ['advance', '--ticks', '-1'],
    ['advance', '--ticks', '1.0'], ['advance', '--ticks', '01'], ['advance', '--ticks', '1', '--ticks', '2'],
    ['query', '--request-id', 'x', '--journal'], ['submit', '--request', '{'],
    ['query', '--request-id='], ['query', '--request-id=--example', '--request-id', 'x'],
    ['query', '--request-id', '--example'], ['query', '--request-id=x', '--unknown=y'],
    ['query', '--request-id=x', '--journal='], ['advance', '--ticks=1', '--ticks=2']]) {
    const result = cli(...args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(JSON.parse(result.stderr).error.code, 'CLI_USAGE');
    assert.equal(result.stdout, '');
  }
});


mockTest('reopening an unacknowledged complete append requires a fresh successful journal fsync', ({ open, journalPath }) => {
  open().close();
  let barriers = 0;
  const failed = open({ journalIO: { fsyncSync(fd) {
    if (++barriers === 2) throw Object.assign(new Error('append barrier failed'), { code: 'EIO' });
    fsyncSync(fd);
  } } });
  assert.throws(() => failed.submit(request()), { code: 'JOURNAL_IO' });
  failed.close();
  const bytes = readFileSync(journalPath);
  let reopenBarriers = 0, writes = 0;
  assert.throws(() => open({ journalIO: {
    writeSync() { writes++; throw new Error('reopen must not append'); },
    fsyncSync() { reopenBarriers++; throw new Error('reopen barrier failed'); },
  } }), { code: 'JOURNAL_IO' });
  assert.equal(reopenBarriers, 1);
  assert.equal(writes, 0);
  assert.equal(existsSync(`${journalPath}.lock`), false);
  assert.deepEqual(readFileSync(journalPath), bytes);
  const recovered = open({ journalIO: { fsyncSync(fd) { reopenBarriers++; fsyncSync(fd); } } });
  assert.equal(reopenBarriers, 2);
  assert.equal(recovered.submit(request()).status, 'accepted');
  assert.equal(reopenBarriers, 2); // Duplicate is read-only AFTER the recovery barrier.
  assert.deepEqual(readFileSync(journalPath), bytes);
});

mockTest('full syntactic and semantic replay validation precedes any reopened journal fsync', ({ open, journalPath }) => {
  const ta = open();
  ta.submit(request());
  ta.close();
  const records = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(JSON.parse);
  records[1].event.dueTick += 1;
  const { recordHash: ignored, ...body } = records[1];
  records[1].recordHash = digest(canonicalJson(body));
  const semanticDamage = records.map(canonicalJson).join('\n') + '\n';
  for (const damaged of ['{not-json}\n', semanticDamage]) {
    writeFileSync(journalPath, damaged);
    let syncs = 0;
    assert.throws(() => open({ journalIO: { fsyncSync() { syncs++; throw new Error('must not reach barrier'); } } }), { code: 'JOURNAL_INVALID' });
    assert.equal(syncs, 0);
    assert.equal(readFileSync(journalPath, 'utf8'), damaged);
  }
});

mockTest('native lock initialization rolls back only its own empty/partial/complete token on failure', ({ open, journalPath }) => {
  for (const mode of ['empty', 'prefix', 'full-fsync']) {
    let writes = 0;
    const failure = Object.assign(new Error(`lock ${mode} ENOSPC`), { code: 'ENOSPC' });
    assert.throws(() => open({ journalIO: { lock: {
      writeSync(fd, buffer, offset, length, position) {
        if (mode === 'empty' || (mode === 'prefix' && writes++)) throw failure;
        return writeSync(fd, buffer, offset, mode === 'prefix' ? 5 : length, position);
      },
      fsyncSync(fd) { if (mode === 'full-fsync') throw failure; fsyncSync(fd); },
    } } }), (error) => error === failure);
    assert.equal(existsSync(`${journalPath}.lock`), false, mode);
    assert.equal(existsSync(journalPath), false, mode);
  }
  assert.equal(open().query('not-submitted').status, 'unknown');
});

mockTest('failed lock initialization never deletes unknown content or another replacement inode', ({ open, journalPath }) => {
  const lockPath = `${journalPath}.lock`;
  for (const mode of ['unknown-content', 'replacement-inode']) {
    const failure = Object.assign(new Error('lock init failed'), { code: 'ENOSPC' });
    assert.throws(() => open({ journalIO: { lock: { writeSync(fd, buffer, offset, length, position) {
      if (mode === 'unknown-content') writeSync(fd, Buffer.from('not our token'));
      else {
        writeSync(fd, buffer, offset, 5, position);
        renameSync(lockPath, `${lockPath}.old`);
        writeFileSync(lockPath, 'replacement owner');
      }
      throw failure;
    } } } }), (error) => error === failure);
    assert.equal(readFileSync(lockPath, 'utf8'), mode === 'unknown-content' ? 'not our token' : 'replacement owner');
    unlinkSync(lockPath); // Only this fixture's deliberately created lock.
  }
});

mockTest('close retries transient owned-lock unlink failures without retrying closed descriptors', ({ open, journalPath }) => {
  let deny = true, unlinks = 0;
  const closed = [];
  const ta = open({ journalIO: {
    unlinkSync(path) { unlinks++; if (deny) throw Object.assign(new Error('permissions denied'), { code: 'EACCES' }); unlinkSync(path); },
    closeSync(fd) { closed.push(fd); closeSync(fd); },
  } });
  assert.throws(() => ta.close(), { code: 'EACCES' });
  assert.equal(existsSync(`${journalPath}.lock`), true);
  assert.equal(closed.length, 2);
  assert.throws(() => ta.query('id'), { code: 'JOURNAL_CLOSED' });
  deny = false;
  ta.close();
  ta.close();
  assert.equal(unlinks, 2);
  assert.equal(closed.length, 2);
  assert.equal(existsSync(`${journalPath}.lock`), false);
  assert.equal(open().query('id').status, 'unknown');
});

mockTest('cleanup retry preserves replacement inode and rewritten ownership tokens', ({ open, directory }) => {
  for (const mode of ['inode', 'token']) {
    const journalPath = join(directory, `retry-${mode}.jsonl`), lockPath = `${journalPath}.lock`;
    let deny = true, unlinks = 0;
    const ta = open({ journalPath, journalIO: { unlinkSync(path) {
      unlinks++;
      if (deny) throw Object.assign(new Error('permissions denied'), { code: 'EACCES' });
      unlinkSync(path);
    } } });
    assert.throws(() => ta.close(), { code: 'EACCES' });
    if (mode === 'inode') renameSync(lockPath, `${lockPath}.old`);
    writeFileSync(lockPath, 'other owner');
    deny = false;
    ta.close();
    ta.close();
    assert.equal(unlinks, 1);
    assert.equal(readFileSync(lockPath, 'utf8'), 'other owner');
  }
});

mockTest('a throwing close cannot cause stale descriptor close on later cleanup retry', ({ open, journalPath }) => {
  let deny = true, closes = 0;
  const ta = open({ journalIO: {
    closeSync(fd) { closes++; closeSync(fd); throw Object.assign(new Error('close reported failure after releasing fd'), { code: 'EIO' }); },
    unlinkSync(path) { if (deny) throw Object.assign(new Error('unlink denied'), { code: 'EACCES' }); unlinkSync(path); },
  } });
  assert.throws(() => ta.close(), (error) => error.code === 'EIO' && error.cleanupErrors.some((entry) => entry.code === 'EACCES'));
  assert.equal(closes, 2);
  deny = false;
  ta.close();
  assert.equal(closes, 2);
  assert.equal(existsSync(`${journalPath}.lock`), false);
});

mockTest('constructor cleanup preserves CONFIG_CHANGED and JOURNAL_INVALID with cleanup diagnostics', ({ open, journalPath }) => {
  const ta = open();
  ta.submit(request());
  ta.close();
  const valid = readFileSync(journalPath);
  const changed = structuredClone(snapshot);
  artifact(changed).body.mockConfiguration.initialBusinessTick += 1;
  for (const code of ['CONFIG_CHANGED', 'JOURNAL_INVALID']) {
    if (code === 'JOURNAL_INVALID') writeFileSync(journalPath, '{broken}\n');
    const bytes = readFileSync(journalPath);
    assert.throws(() => open({ snapshot: code === 'CONFIG_CHANGED' ? changed : snapshot,
      journalIO: { unlinkSync() { throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' }); } },
    }), (error) => error.code === code && error.cleanupErrors?.[0].code === 'EACCES');
    assert.deepEqual(readFileSync(journalPath), bytes);
    assert.equal(existsSync(`${journalPath}.lock`), true);
    unlinkSync(`${journalPath}.lock`); // Constructor could not release its test-owned lock.
  }
  writeFileSync(journalPath, valid);
  assert.equal(open().query('request-confirmed').status, 'accepted');
});

mockTest('MockTA initialization failure preserves its primary journal error when cleanup fails', ({ open, journalPath }) => {
  assert.throws(() => open({ journalIO: {
    fsyncSync() { throw new Error('initialization barrier failed'); },
    unlinkSync() { throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' }); },
  } }), (error) => error.code === 'JOURNAL_IO' && error.cause.message === 'initialization barrier failed'
    && error.cleanupErrors?.[0].code === 'EACCES');
  assert.equal(existsSync(`${journalPath}.lock`), true);
  unlinkSync(`${journalPath}.lock`);
  assert.equal(open().query('unsubmitted').status, 'unknown');
});

test('CLI operation plus close failure and close-only failure produce one structured diagnostic and no acknowledgement', () => {
  const priorExitCode = process.exitCode;
  try {
    for (const operationFails of [true, false]) {
      let stdout = '', stderr = '', closes = 0;
      cliMain(['query', '--request-id=--example'], {
        createTA() { return {
          query(id) {
            assert.equal(id, '--example');
            if (operationFails) throw Object.assign(new Error('primary operation failure'), { code: 'CONFIG_CHANGED' });
            return { requestId: id, status: 'accepted' };
          },
          close() { closes++; throw Object.assign(new Error('close denied'), { code: 'EACCES' }); },
        }; },
        stdout: { write(text) { stdout += text; } }, stderr: { write(text) { stderr += text; } },
      });
      assert.equal(stdout, '');
      assert.equal(closes, 1);
      assert.equal(process.exitCode, 1);
      const diagnostic = JSON.parse(stderr).error;
      assert.equal(diagnostic.code, operationFails ? 'CONFIG_CHANGED' : 'EACCES');
      if (operationFails) assert.equal(diagnostic.cleanupErrors[0].code, 'EACCES');
      assert.equal(stderr.trim().split('\n').length, 1);
    }
  } finally { process.exitCode = priorExitCode; }
});

test('canonical serialization rejects array subclasses, inherited substitutions, accessors and non-data without invoking methods', () => {
  let calls = 0;
  class UnsafeArray extends Array {
    map() { calls++; return ['substitution']; }
    static get [Symbol.species]() { calls++; return Array; }
    [Symbol.iterator]() { calls++; throw new Error('iterator invoked'); }
    toJSON() { calls++; return ['substitution']; }
  }
  const inherited = [NaN, undefined];
  Object.setPrototypeOf(inherited, { __proto__: Array.prototype,
    map() { calls++; return { join() { calls++; return '0],"duplicate":1,"duplicate":2,"x":['; } }; },
  });
  const accessor = [1];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { calls++; return 1; } });
  const ownMethod = [1];
  ownMethod.toJSON = () => { calls++; return [2]; };
  for (const value of [new UnsafeArray(1), inherited, accessor, ownMethod, [NaN], [undefined], [, 1]]) {
    assert.throws(() => canonicalJson(value), { code: 'INVALID_CONTRACT' });
  }
  assert.equal(calls, 0);
  assert.equal(canonicalJson([1, 'a', { b: 2, a: true }]), '[1,"a",{"a":true,"b":2}]');
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), { code: 'INVALID_CONTRACT' });
});

mockTest('complete original request shape/types reject accessor and small shared DAG inputs before cloning', ({ open, journalPath }) => {
  const ta = open(), before = readFileSync(journalPath);
  let calls = 0;
  const leaf = {};
  Object.defineProperty(leaf, 'value', { enumerable: true, get() { calls++; throw new Error('DAG traversed'); } });
  const shared = { left: leaf, right: leaf }, dag = { left: shared, right: shared };
  const accessor = request();
  Object.defineProperty(accessor, 'fundCode', { enumerable: true, get() { calls++; return 'DEMO-FUND'; } });
  const amountAccessor = request();
  Object.defineProperty(amountAccessor.amount, 'minorUnits', { enumerable: true, get() { calls++; return '10000'; } });
  class ArrayWithSubstitution extends Array { toJSON() { calls++; return 'DEMO-FUND'; } }
  for (const input of [accessor, amountAccessor, { ...request(), fundCode: dag },
    { ...request(), amount: { minorUnits: dag, currency: configuration.currency } },
    { ...request(), amount: { minorUnits: '1', currency: dag } },
    { ...request(), fundCode: new ArrayWithSubstitution(1) }]) assert.throws(() => ta.submit(input));
  assert.equal(calls, 0);
  assert.deepEqual(readFileSync(journalPath), before);
});

mockTest('configuration load validates original arrays and fixtures before any inherited substitution/iterator/accessor', () => {
  let calls = 0;
  for (const mode of ['subclass', 'inherited-map', 'index-accessor', 'fixture-accessor', 'iterator', 'dag']) {
    const changed = structuredClone(snapshot), config = artifact(changed).body.mockConfiguration;
    if (mode === 'subclass') {
      class Substituting extends Array { map() { calls++; return []; } }
      config.scenarios = new Substituting(...config.scenarios);
    } else if (mode === 'inherited-map') {
      Object.setPrototypeOf(config.scenarios, { __proto__: Array.prototype, map() { calls++; return []; } });
    } else if (mode === 'index-accessor') {
      Object.defineProperty(config.scenarios, '0', { enumerable: true, get() { calls++; return {}; } });
    } else if (mode === 'fixture-accessor') {
      Object.defineProperty(config.scenarios[0].fixture, 'nav', { enumerable: true, get() { calls++; return '1'; } });
    } else if (mode === 'iterator') {
      Object.setPrototypeOf(config.scenarios, { __proto__: Array.prototype,
        [Symbol.iterator]() { calls++; throw new Error('input iterator invoked'); },
      });
    } else {
      const shared = { value: {} };
      config.scenarios[0].fixture.nav = { left: shared, right: shared };
    }
    assert.throws(() => loadMockContract(changed), { code: 'INVALID_CONTRACT' });
  }
  assert.equal(calls, 0);
});

mockTest('a leading UTF-8 BOM is journal corruption, never silently stripped or repaired', ({ open, journalPath }) => {
  open().close();
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(journalPath)]);
  writeFileSync(journalPath, bytes);
  assert.throws(() => open(), { code: 'JOURNAL_INVALID' });
  assert.deepEqual(readFileSync(journalPath), bytes);
  assert.equal(existsSync(`${journalPath}.lock`), false);
});

mockTest('CLI equals values accept literal leading-dash request IDs and conventional request/journal/tick values', ({ directory }) => {
  const journalPath = join(directory, 'equals-cli.jsonl');
  const cli = (...args) => spawnSync(process.execPath, [join(MOCK_ROOT, 'tools/mock-ta.mjs'), ...args, `--journal=${journalPath}`], { encoding: 'utf8' });
  const input = request('confirmed', '--example=literal');
  let result = cli('submit', `--request=${JSON.stringify(input)}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).requestId, input.requestId);
  const bytes = readFileSync(journalPath);
  result = cli('query', `--request-id=${input.requestId}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'accepted');
  assert.deepEqual(readFileSync(journalPath), bytes);
  result = cli('advance', `--ticks=${fixture('confirmed').delayTicks}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).receipts[0].outcome, 'confirmed');
  assert.match(spawnSync(process.execPath, [join(MOCK_ROOT, 'tools/mock-ta.mjs'), '--help'], { encoding: 'utf8' }).stdout, /--request-id=<literal>/);
});

mockTest('live journal pathname removal, rename, replacement and hardlink poison before mutation/query/ack', ({ open, directory }) => {
  for (const mode of ['remove', 'rename', 'replace', 'hardlink']) {
    const journalPath = join(directory, `live-journal-${mode}.jsonl`);
    const ta = open({ journalPath });
    ta.submit(request());
    const bytes = readFileSync(journalPath), moved = `${journalPath}.old`;
    if (mode === 'remove') unlinkSync(journalPath);
    if (mode === 'rename' || mode === 'replace') renameSync(journalPath, moved);
    if (mode === 'replace') writeFileSync(journalPath, 'replacement journal');
    if (mode === 'hardlink') linkSync(journalPath, moved);
    const operation = mode === 'remove' ? () => ta.submit(request('accepted', 'new-request'))
      : mode === 'rename' ? () => ta.query('request-confirmed')
      : mode === 'replace' ? () => ta.advanceClock(1) : () => ta.businessTick;
    assert.throws(operation, { code: 'JOURNAL_IDENTITY' });
    assert.throws(() => ta.query('request-confirmed'), { code: 'JOURNAL_POISONED' });
    if (existsSync(moved)) assert.deepEqual(readFileSync(moved), bytes);
    ta.close();
    if (mode === 'replace') assert.equal(readFileSync(journalPath, 'utf8'), 'replacement journal');
  }
});

mockTest('live lock removal, rename, token change and inode replacement poison and preserve other owners', ({ open, directory }) => {
  for (const mode of ['remove', 'rename', 'token', 'replacement']) {
    const journalPath = join(directory, `live-lock-${mode}.jsonl`), lockPath = `${journalPath}.lock`;
    const ta = open({ journalPath });
    ta.submit(request());
    const bytes = readFileSync(journalPath);
    if (mode === 'remove') unlinkSync(lockPath);
    if (mode === 'rename' || mode === 'replacement') renameSync(lockPath, `${lockPath}.old`);
    if (mode === 'token' || mode === 'replacement') writeFileSync(lockPath, 'other owner');
    assert.throws(() => ta.submit(request()), { code: 'JOURNAL_IDENTITY' });
    assert.throws(() => ta.advanceClock(1), { code: 'JOURNAL_POISONED' });
    assert.deepEqual(readFileSync(journalPath), bytes);
    ta.close();
    if (mode === 'token' || mode === 'replacement') assert.equal(readFileSync(lockPath, 'utf8'), 'other owner');
  }
});

mockTest('a writer whose lock was removed cannot acknowledge or delete a newly acquired writer lock', ({ open, journalPath }) => {
  const first = open();
  first.submit(request());
  unlinkSync(`${journalPath}.lock`);
  const second = open();
  second.submit(request('accepted', 'second-writer-request'));
  const token = readFileSync(`${journalPath}.lock`), bytes = readFileSync(journalPath);
  assert.throws(() => first.submit(request()), { code: 'JOURNAL_IDENTITY' });
  first.close();
  assert.deepEqual(readFileSync(`${journalPath}.lock`), token);
  assert.deepEqual(readFileSync(journalPath), bytes);
  assert.equal(second.query('second-writer-request').status, 'accepted');
});

mockTest('identity changes during a successful write barrier still fail closed before acknowledgement', ({ open, directory }) => {
  for (const mode of ['journal', 'lock']) {
    const journalPath = join(directory, `after-barrier-${mode}.jsonl`);
    open({ journalPath }).close();
    let barriers = 0;
    const ta = open({ journalPath, journalIO: { fsyncSync(fd) {
      fsyncSync(fd);
      if (++barriers !== 2) return; // First barrier is reopen; second is submit.
      const path = mode === 'journal' ? journalPath : `${journalPath}.lock`;
      renameSync(path, `${path}.old`);
      writeFileSync(path, 'replacement owner');
    } } });
    assert.throws(() => ta.submit(request()), { code: 'JOURNAL_IDENTITY' });
    assert.throws(() => ta.query('request-confirmed'), { code: 'JOURNAL_POISONED' });
    ta.close();
    const path = mode === 'journal' ? journalPath : `${journalPath}.lock`;
    assert.equal(readFileSync(path, 'utf8'), 'replacement owner');
  }
});

mockTest('operational string limits reject oversized request and fixture values before persistence', ({ open, journalPath }) => {
  const ta = open(), bytes = readFileSync(journalPath);
  const large = 'x'.repeat(MAX_STRING_BYTES + 1);
  assert.throws(() => ta.submit({ ...request(), orderId: large }), { code: 'INPUT_CAPACITY' });
  assert.throws(() => ta.submit({ ...request(), amount: { minorUnits: '1'.repeat(MAX_STRING_BYTES + 1), currency: 'CNY' } }), { code: 'INPUT_CAPACITY' });
  const changed = structuredClone(snapshot);
  artifact(changed).body.mockConfiguration.scenarios[0].fixture.nav = '1'.repeat(MAX_STRING_BYTES + 1);
  assert.throws(() => loadMockContract(changed), { code: 'INPUT_CAPACITY' });
  assert.deepEqual(readFileSync(journalPath), bytes);
});
mockTest('journal capacity rejects oversized recovery and append before acknowledging an unreplayable size', ({ open, journalPath }) => {
  open().close();
  const original = readFileSync(journalPath);
  truncateSync(journalPath, MAX_JOURNAL_BYTES + 1);
  assert.throws(() => open(), { code: 'JOURNAL_CAPACITY' });
  assert.equal(statSync(journalPath).size, MAX_JOURNAL_BYTES + 1);
  writeFileSync(journalPath, original);
  const ta = open();
  truncateSync(journalPath, MAX_JOURNAL_BYTES);
  assert.throws(() => ta.submit(request()), { code: 'JOURNAL_CAPACITY' });
  assert.equal(statSync(journalPath).size, MAX_JOURNAL_BYTES);
  ta.close();
});
mockTest('scratch fixture preflight rejects symlink containment before any temp creation or cleanup outside', ({ directory }) => {
  const outside = join(directory, 'outside');
  // This isolated target stands in for an outside path; never replace the shared .scratch.
  resolveJournalPath(join(outside, 'preflight.jsonl'));
  const linked = join(directory, 'linked-scratch');
  symlinkSync(outside, linked);
  const before = readFileSync(join(MOCK_ROOT, 'package.json'));
  assert.throws(() => scratchDirectory(linked), { code: 'JOURNAL_PATH' });
  assert.equal(existsSync(join(outside, 'mock-ta-test-preflight.jsonl')), false);
  assert.deepEqual(readFileSync(join(MOCK_ROOT, 'package.json')), before);
});
