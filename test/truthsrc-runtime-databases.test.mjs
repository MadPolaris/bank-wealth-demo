import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createContext, runInContext } from 'node:vm';
import { OwnedRuntimeDatabases } from '../tools/truthsrc-runtime-databases.mjs';

const pins = ['sha256:8eccfc5e5aebbf3a49375b13956a88cd244d13ac6b25b52dec792b7526363b19',
  'sha256:0010f63d26952bd3960fac5513c64a1cf7d6299f31fa7b54ac1b36633ee04333'];
const at = (args, flag) => args[args.indexOf(flag) + 1];
const digest = value => createHash('sha256').update(value).digest('hex');
const receipt = evidence => JSON.parse(readFileSync(join(evidence, 'database-stop.json'), 'utf8'));
function temporary(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bank-db-mock-')));
  // Only this test's fake files, never a Docker data directory or prior evidence.
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
function fixture(t, options = {}) {
  const evidence = temporary(t), calls = [], containers = new Map(), relays = [];
  let serial = 0;
  const fake = { snapshot: [], intercept: null };
  const runner = async command => {
    assert.equal(command.executable, '/usr/local/bin/docker');
    assert.deepEqual(command.args.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    const call = { ...command, args: command.args.slice(2) }, a = call.args; calls.push(call);
    let stdout = '';
    if (a[0] === 'image') stdout = a.at(-1);
    else if (a[0] === 'network') stdout = (++serial).toString(16).padStart(64, '0');
    else if (a[0] === 'run') {
      stdout = (++serial).toString(16).padStart(64, '0');
      const labels = Object.fromEntries(a.flatMap((value, i) => value === '--label' ? [a[i + 1].split('=')] : []));
      containers.set(stdout, { id: stdout, owner: labels['bank.owner'], run: labels['bank.runtime'], kind: at(a, '--name').endsWith('-mysql') ? 'mysql' : 'mongo' });
      writeFileSync(at(a, '--cidfile'), stdout, { mode: 0o600, flag: 'wx' });
    } else if (a[0] === 'container') stdout = at(a, '--format') === '{{.State.Running}}' ? 'false' : JSON.stringify(containers.get(a.at(-1)));
    else if (a[0] === 'exec') {
      assert.ok(containers.has(a[2]));
      if (a[3] === 'mysql') stdout = command.input === 'SELECT @@global.skip_networking;\n' ? '0\n' : '';
      else {
        const operation = JSON.parse(command.input.match(/control\((.+)\);/)[1]);
        stdout = operation.kind === 'snapshot' ? JSON.stringify(fake.snapshot) : '{"ok":1}\n';
      }
    } else assert.equal(a[0], 'stop');
    const result = { code: 0, stdout, stderr: '' };
    return fake.intercept ? await fake.intercept(call, result) ?? result : result;
  };
  const relayFactory = async config => { relays.push(config); return { close: async () => ({ closed: true, host: '127.0.0.1', port: config.hostPort }) }; };
  const db = new OwnedRuntimeDatabases({ evidence, owner: 'bank_mock_owner', runner, relayFactory, readyAttempts: 2, wait: async () => {}, ...options });
  return { db, evidence, calls, fake, containers, relays };
}

test('admission rejects unsafe namespaces, paths, reserved/duplicate ports before I/O', t => {
  const evidence = temporary(t), base = { evidence, owner: 'bank_mock' };
  for (const owner of ['', '-owner', '../owner', 'A', 'a'.repeat(61), 'x\n']) assert.throws(() => new OwnedRuntimeDatabases({ ...base, owner }));
  for (const port of [0, 1024, 9000, 2551, 27017, 3306, 65536, 18762.5, '18762']) {
    assert.throws(() => new OwnedRuntimeDatabases({ ...base, mysqlPort: port }));
    assert.throws(() => new OwnedRuntimeDatabases({ ...base, mongoPort: port }));
  }
  assert.throws(() => new OwnedRuntimeDatabases({ ...base, mongoPort: 18762 }));
  for (const path of ['relative', evidence + '/..', evidence + ',injected', evidence + '\n']) assert.throws(() => new OwnedRuntimeDatabases({ ...base, evidence: path }));
  assert.throws(() => new OwnedRuntimeDatabases({ ...base, secrets: ['bank_mock'] }));
  assert.throws(() => new OwnedRuntimeDatabases({ ...base, secrets: [''] }));
  assert.throws(() => new OwnedRuntimeDatabases({ ...base, commandTimeoutMs: Infinity }));
  assert.throws(() => new OwnedRuntimeDatabases({ ...base, readyAttempts: 321 }));
  assert.doesNotThrow(() => new OwnedRuntimeDatabases({ ...base, owner: 'a'.repeat(60) }));
  assert.deepEqual(readdirSync(evidence), []);
});

test('fresh pinned images, distinct internal bridges, loopback ports and file-only credentials', async t => {
  const { db, calls, evidence, relays } = fixture(t), config = await db.start();
  const images = calls.filter(c => c.args[0] === 'image'), runs = calls.filter(c => c.args[0] === 'run'), networks = calls.filter(c => c.args[0] === 'network');
  assert.deepEqual(images.map(c => c.args.at(-1)), pins);
  assert.ok(calls.indexOf(images[1]) < calls.indexOf(runs[0]));
  assert.equal(new Set(runs.map(c => at(c.args, '--network'))).size, 2);
  assert.equal(networks.length, 2);
  for (const c of networks) { assert.ok(c.args.includes('--internal')); assert.equal(at(c.args, '--driver'), 'bridge'); }
  assert.ok(runs.every(c => !c.args.includes('--publish')));
  assert.deepEqual(relays.map(r => [r.hostPort, r.containerPort]), [[18762, 3306], [18763, 27017]]);
  for (const c of runs) {
    assert.ok(c.args.includes('--pull=never')); assert.ok(at(c.args, '--name').length <= 60);
    assert.equal(at(c.args, '--user'), process.getuid() + ':' + process.getgid());
    for (let i = 0; i < c.args.length; i++) if (c.args[i] === '-e') assert.match(c.args[i + 1], /^(?:[A-Z_]+_FILE=\/run\/secrets\/[a-z-]+|MYSQL_ROOT_HOST=localhost)$/);
  }
  assert.ok(runs[1].args.includes('--auth'));
  assert.ok(runs[0].args.includes('--socket=/tmp/mysql.sock'));
  assert.ok(runs[0].args.includes('--pid-file=/tmp/mysql.pid'));
  assert.ok(!calls.some(c => /Config\.Env/.test(c.args.join(' ')) || c.args.some(a => ['rm', 'reset', 'pull', 'connect', '--rm', '--network=host'].includes(a))));
  assert.ok(!calls.some(c => db.credentialsList.some(s => c.args.some(a => a.includes(s)))));
  assert.equal(config.mysql.port, 18762); assert.equal(config.mongo.port, 18763);
  assert.equal(config.mongo.authSource, 'admin'); assert.equal(new URL(config.mongo.uri).hostname, '127.0.0.1');
  for (const kind of ['mysql', 'mongo']) assert.equal(statSync(join(evidence, kind + '-data')).mode & 0o777, 0o700);
  assert.equal(statSync(join(evidence, 'private')).mode & 0o777, 0o700);
  const privateFiles = readdirSync(join(evidence, 'private'), { recursive: true, withFileTypes: true });
  for (const entry of privateFiles) assert.equal(statSync(join(entry.parentPath, entry.name)).mode & 0o777, entry.isDirectory() ? 0o700 : 0o600);
  const defaults = readFileSync(config.mysql.rootDefaultsFile, 'utf8');
  assert.ok(defaults.includes(readFileSync(config.mysql.rootPasswordFile, 'utf8')));
  assert.ok(defaults.includes('protocol=SOCKET') && defaults.includes('socket=/tmp/mysql.sock'));
  assert.equal(config.mysql.containerRootDefaultsFile, '/run/secrets/client.cnf');
  await db.stop();
  const text = readFileSync(join(evidence, 'database-stop.json'), 'utf8');
  assert.ok(!db.credentialsList.some(s => text.includes(s)));
  assert.deepEqual(readdirSync(evidence).sort(), ['database-stop.json', 'mongo-data', 'mysql-data', 'private']);
  assert.ok(receipt(evidence).stopped && receipt(evidence).preserved);
});

test('credentials are fresh, memory-returned and include URI encodings for the controller redactor', async t => {
  const extra = 'new /secret+value@%', first = fixture(t, { secrets: [extra] }), second = fixture(t);
  const a = await first.db.start(), b = await second.db.start();
  for (const kind of ['mysql', 'mongo']) {
    assert.ok(a[kind].password !== b[kind].password && a[kind].username !== b[kind].username);
    assert.ok(first.db.credentialsList.includes(a[kind].password) && first.db.credentialsList.includes(a[kind].username));
    assert.equal(a[kind].password.length, 64);
  }
  for (const value of [extra, encodeURI(extra), encodeURIComponent(extra)]) assert.ok(first.db.credentialsList.includes(value));
  assert.ok(first.db.credentialsList.includes(readFileSync(a.mysql.rootPasswordFile, 'utf8')));
  const list = first.db.credentialsList; list.length = 0; assert.ok(first.db.credentialsList.length > 0);
  await first.db.stop(); await second.db.stop();
});

test('schema grants cover only requested exact names, including escaped underscores', async t => {
  const { db, calls } = fixture(t); await db.start();
  const names = ['bank_base', 'bank_replay', 'bank_http', 'a'.repeat(60)];
  for (const name of names) {
    const value = await db.createSchema(name); assert.equal(value.name, name);
    assert.ok(value.jdbcUrl.includes('/' + name + '?')); assert.ok(db.credentialsList.includes(value.password));
  }
  const grants = calls.filter(c => c.input.startsWith('CREATE DATABASE'));
  assert.equal(grants.length, names.length);
  assert.ok(grants[0].input.includes('GRANT ALL PRIVILEGES ON `bank\\_base`.*'));
  assert.ok(!grants.some(c => c.input.includes('ON *.*') || c.input.includes('IF NOT EXISTS')));
  const root = calls.find(c => c.input.startsWith("CREATE USER 'root'@'%'")).input;
  assert.ok(root.includes("GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION"));
  const count = calls.length;
  for (const name of ['', 'admin', 'local', 'config', 'mysql', 'sys', 'information_schema', 'performance_schema', 'Bank', 'bad-name', 'bad%; DROP DATABASE mysql', 'a'.repeat(61), 'bank_base']) await assert.rejects(db.createSchema(name));
  assert.equal(calls.length, count); await db.stop(); await assert.rejects(db.createSchema('after_stop'));
});

test('whole application Mongo snapshot sorts fields/documents/collections but preserves array order', async t => {
  const { db, fake, calls } = fixture(t); await db.start();
  fake.snapshot = [{ name: 'snapshots', documents: [] }, { name: 'journal_0', documents: [{ z: 3, a: { y: 2, x: 1 } }, { entries: [1, 2], _id: { $oid: 'abc' } }] }, { name: 'metadata', documents: [{ seq: 2 }] }];
  const first = await db.mongoSnapshot('bank_base');
  fake.snapshot = [{ name: 'metadata', documents: [{ seq: 2 }] }, { name: 'journal_0', documents: [{ _id: { $oid: 'abc' }, entries: [1, 2] }, { a: { x: 1, y: 2 }, z: 3 }] }, { name: 'snapshots', documents: [] }];
  assert.deepEqual(await db.mongoSnapshot('bank_base'), first);
  assert.deepEqual(first.collections.map(c => [c.name, c.count]), [['journal_0', 2], ['metadata', 1], ['snapshots', 0]]);
  assert.equal(first.collections[2].sha256, digest('[]'));
  assert.deepEqual(Object.keys(first).sort(), ['collections', 'sha256']);
  fake.snapshot[1].documents[0].entries.reverse(); assert.notEqual((await db.mongoSnapshot('bank_base')).sha256, first.sha256);
  fake.snapshot[1].documents.push({ newEvent: true }); assert.equal((await db.mongoSnapshot('bank_base')).collections[0].count, 3);
  const snapshotCalls = calls.filter(c => c.input.includes('"kind":"snapshot"'));
  assert.equal(snapshotCalls.length, 4);
  for (const c of snapshotCalls) { assert.ok(c.args.includes('-i')); assert.ok(!/delete|drop|remove|update|insert/i.test(c.input)); }
  await db.stop();
});

test('snapshot malformed output, system collections and secret-bearing names fail without raw errors', async t => {
  const { db, fake, calls } = fixture(t); await db.start();
  const before = calls.length;
  for (const name of ['admin', 'local', 'config', 'x;quit()', 'a'.repeat(61)]) await assert.rejects(db.mongoSnapshot(name));
  assert.equal(calls.length, before);
  for (const value of [{}, [{ name: 'system.users', documents: [] }], [{ name: 'journal', documents: {} }],
    [{ name: 'journal', documents: [] }, { name: 'journal', documents: [] }], [{ name: db.credentialsList[0], documents: [] }]]) {
    fake.snapshot = value; await assert.rejects(db.mongoSnapshot('bank_base'), { message: 'Owned Mongo snapshot failed.' });
  }
  fake.intercept = (call, result) => call.input.includes('"snapshot"') ? { ...result, stdout: 'malformed ' + db.credentialsList[0] } : undefined;
  await assert.rejects(db.mongoSnapshot('bank_base'), { message: 'Owned Mongo snapshot failed.' }); await db.stop();
});

test('image mismatch fails before any run/network command and leaves a stop receipt', async t => {
  const { db, fake, calls, evidence } = fixture(t);
  fake.intercept = (call, result) => call.args[0] === 'image' ? { ...result, stdout: 'sha256:' + 'f'.repeat(64) } : undefined;
  await assert.rejects(db.start(), /Owned database start failed/);
  assert.ok(!calls.some(c => ['run', 'network', 'stop'].includes(c.args[0])));
  assert.deepEqual(receipt(evidence).containers, []); assert.ok(existsSync(join(evidence, 'mysql-data')));
});

test('partial run failure recovers its fresh cidfile, stops only label-verified IDs and preserves evidence', async t => {
  const { db, fake, calls, evidence, containers } = fixture(t);
  fake.intercept = call => { if (call.args[0] === 'run' && at(call.args, '--name').endsWith('-mongo')) throw new Error('RAW-DOCKER-' + db.credentialsList[0]); };
  await assert.rejects(db.start(), { message: 'Owned database start failed; inspect database-stop.json.' });
  const stops = calls.filter(c => c.args[0] === 'stop');
  assert.equal(stops.length, 2); assert.deepEqual(stops.map(c => c.args.at(-1)), [...containers.keys()]);
  for (const c of stops) assert.equal(calls[calls.indexOf(c) - 1].args[0], 'container');
  const publicText = readFileSync(join(evidence, 'database-stop.json'), 'utf8');
  assert.ok(!publicText.includes('RAW-DOCKER') && !db.credentialsList.some(s => publicText.includes(s)));
  assert.equal(receipt(evidence).networks.length, 2); assert.ok(receipt(evidence).preserved);
  assert.ok(existsSync(join(evidence, 'mysql-data')) && existsSync(join(evidence, 'mongo-data')));
});

test('stop refuses changed owner/run labels or mismatched IDs and is idempotent', async t => {
  for (const key of ['owner', 'run', 'id']) {
    const { db, fake, calls, evidence } = fixture(t); const config = await db.start();
    fake.intercept = (call, result) => call.args[0] === 'container' && call.args.at(-1) === config.mongo.containerId ?
      { ...result, stdout: JSON.stringify({ ...JSON.parse(result.stdout), [key]: 'foreign' }) } : undefined;
    const [one, two] = await Promise.all([db.stop(), db.stop()]); assert.deepEqual(one, two);
    assert.deepEqual(calls.filter(c => c.args[0] === 'stop').map(c => c.args.at(-1)), [config.mysql.containerId]);
    assert.equal(receipt(evidence).stopped, false); assert.equal(one.containers[1].stopped, false);
    assert.throws(() => db.start());
  }
});

test('readiness retries are bounded and failure does not launch the second database', async t => {
  const { db, fake, calls, evidence } = fixture(t);
  fake.intercept = (call, result) => call.input === 'SELECT @@global.skip_networking;\n' ? { ...result, code: 1, stderr: db.credentialsList[0] } : undefined;
  await assert.rejects(db.start(), /Owned database start failed/);
  assert.equal(calls.filter(c => c.input === 'SELECT @@global.skip_networking;\n').length, 2);
  assert.equal(calls.filter(c => c.args[0] === 'run').length, 1);
  assert.equal(receipt(evidence).containers.length, 1); assert.ok(receipt(evidence).stopped);
});

test('stop command failure is recorded without suppressing other owned stops or leaking output', async t => {
  const { db, fake, calls, evidence } = fixture(t); await db.start();
  fake.intercept = (call, result) => call.args[0] === 'stop' ? { ...result, code: 1, stdout: db.credentialsList[0], stderr: 'raw-error' } : undefined;
  assert.equal((await db.stop()).stopped, false);
  assert.equal(calls.filter(c => c.args[0] === 'stop').length, 2);
  assert.ok(!readFileSync(join(evidence, 'database-stop.json'), 'utf8').includes('raw-error'));
});

test('pre-existing data or stop receipt is never overwritten or reused', async t => {
  for (const kind of ['data', 'receipt']) {
    const { db, evidence, calls } = fixture(t);
    const path = kind === 'data' ? join(evidence, 'mysql-data/sentinel') : join(evidence, 'database-stop.json');
    if (kind === 'data') mkdirSync(dirname(path));
    writeFileSync(path, 'prior-evidence'); await assert.rejects(db.start());
    assert.equal(readFileSync(path, 'utf8'), 'prior-evidence'); assert.equal(calls.length, 0);
  }
});

test('Docker child timeout sends TERM then KILL and awaits close, using a mock child only', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const evidence = temporary(t), signals = [], commands = []; let closed = false;
  const spawnImpl = (executable, args, options) => {
    commands.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = signal => { signals.push(signal); if (signal === 'SIGKILL') queueMicrotask(() => { closed = true; child.emit('close', null); }); return true; };
    return child;
  };
  const db = new OwnedRuntimeDatabases({ evidence, owner: 'timeout_mock', spawnImpl, commandTimeoutMs: 10 });
  const rejection = assert.rejects(db.start(), /Owned database start failed/);
  t.mock.timers.tick(10); assert.deepEqual(signals, ['SIGTERM']); assert.equal(closed, false);
  t.mock.timers.tick(1000); await rejection;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); assert.equal(closed, true);
  assert.deepEqual(Object.keys(commands[0].options.env).sort(), ['DOCKER_CONFIG', 'PATH']);
  assert.ok(receipt(evidence).preserved);
});

test('host-side database controls are separately immutable and drift blocks cleanup certification', async t => {
  const { db } = fixture(t), config = await db.start();
  assert.equal(db.readOnlyPaths.length, 3);
  db.assertControlsUnchanged();
  writeFileSync(config.mysql.rootDefaultsFile, 'changed');
  assert.throws(() => db.assertControlsUnchanged(), /control bytes/);
  const stopped = await db.stop();
  assert.equal(stopped.controlsUnchanged, false); assert.equal(stopped.stopped, false);
});

test('cancellation during MySQL readiness prevents creation of Mongo resources', async t => {
  const controller = new AbortController(), f = fixture(t, { signal: controller.signal });
  f.fake.intercept = call => { if (call.input === 'SELECT @@global.skip_networking;\n') controller.abort(); };
  await assert.rejects(f.db.start(), /Owned database start failed/);
  assert.equal(f.calls.filter(call => call.args[0] === 'run').length, 1);
  assert.equal(receipt(f.evidence).stopped, true);
});

test('an unresolved container creation never becomes a successful empty cleanup receipt', async t => {
  const { db, fake, calls, evidence } = fixture(t);
  fake.intercept = call => {
    if (call.args[0] === 'run') {
      rmSync(at(call.args, '--cidfile'));
      throw new Error('simulated lost container response');
    }
  };
  await assert.rejects(db.start(), /Owned database start failed/);
  assert.equal(receipt(evidence).stopped, false);
  assert.equal(receipt(evidence).unresolvedCreations.length, 1);
  assert.equal(calls.filter(call => call.args[0] === 'stop').length, 0);
});

test('mounted legacy Mongo script prints only public results and retains BSON precision/binary data', async t => {
  const { db, calls } = fixture(t); await db.start();
  const run = calls.find(c => c.args[0] === 'run' && at(c.args, '--name').endsWith('-mongo'));
  const mount = run.args.find(a => a.startsWith('type=bind,src=') && a.endsWith('dst=/run/secrets,readonly'));
  const directory = mount.slice('type=bind,src='.length).split(',dst=')[0], prints = [];
  const context = createContext({ print: value => prints.push(value), cat: path => readFileSync(join(directory, path.split('/').at(-1)), 'utf8'), quit: () => { throw new Error('quit'); } });
  runInContext(`
    class ObjectId { valueOf() { return '0123456789abcdef01234567'; } }
    class BinData { base64() { return 'AAEC'; } subtype() { return 0; } }
    class NumberLong { toString() { return 'NumberLong("9223372036854775807")'; } }
    class NumberInt { valueOf() { return 42; } }
    class NumberDecimal { toString() { return 'NumberDecimal("123.4500")'; } }
    class Timestamp { getTime() { return 17; } getInc() { return 2; } }
    var writes = [], authEnabled = true;
    var docs = [{ _id: new ObjectId(), binary: new BinData(), long: new NumberLong(), int: new NumberInt(),
      decimal: new NumberDecimal(), timestamp: new Timestamp(), date: new Date(123), regex: /a/gi, array: [2, 1] }];
    var admin = { auth: function() { return 1; }, runCommand: function(command) {
      if (command.getCmdLineOpts) return {parsed: {security: {authorization: authEnabled ? 'enabled' : 'disabled'}}};
      if (command.createUser) writes.push(command); return {ok: 1};
    }, getSiblingDB: function() { return {
      getCollectionNames: function() { return ['journal', 'system.users', 'snapshots']; },
      getCollection: function(name) { return { find: function() { return { maxTimeMS: function() { return {
        forEach: function(fn) { if (name === 'journal') docs.forEach(fn); }
      }; } }; } }; }
    }; } };
    function tojsononeline(value) {
      if (value !== docs[0] && !(value.long instanceof NumberLong && value.binary instanceof BinData && value.decimal instanceof NumberDecimal)) throw new Error('unexpected BSON document');
      return 'opaque NumberLong("9223372036854775807") BinData(0,"AAEC") NumberDecimal("123.4500") Timestamp(17,2)';
    }
    function Mongo(host) { if (host !== '127.0.0.1:27017') throw new Error('foreign'); this.getDB = function() { return admin; }; }
  ` + readFileSync(join(directory, 'control.js'), 'utf8'), context);
  runInContext('control({kind: "initialize"})', context); assert.deepEqual(prints, ['{"ok":1}']);
  prints.length = 0; runInContext('control({kind: "snapshot", database: "bank_base"})', context);
  assert.equal(prints.length, 1); assert.ok(!db.credentialsList.some(secret => prints[0].includes(secret)));
  const output = JSON.parse(prints[0]), document = output[0].documents[0];
  assert.deepEqual(output.map(c => c.name), ['journal', 'snapshots']);
  assert.equal(document, 'opaque NumberLong("9223372036854775807") BinData(0,"AAEC") NumberDecimal("123.4500") Timestamp(17,2)');
  assert.equal(runInContext('writes.length', context), 1);
  prints.length = 0; runInContext('authEnabled = false', context);
  assert.throws(() => runInContext('control({kind: "ping"})', context)); assert.deepEqual(prints, []);
  await db.stop();
});
