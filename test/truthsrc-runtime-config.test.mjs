import test from 'node:test';
import assert from 'node:assert/strict';
import { issueRuntimeCredentials, productionConfiguration } from '../tools/truthsrc-runtime-config.mjs';

const options = () => ({ namespace: 'truthsrc_test', schema: 'truthsrc_test', httpPort: 18761, mysqlPort: 18762, mongoPort: 18763,
  mysqlUser: 'bank_app', mysqlPassword: 'private-mysql-value', mongoUser: 'runtime_admin', mongoPassword: 'private-mongo-value',
  credentials: issueRuntimeCredentials(), playSecret: 'private-play-value', machineToken: 'private-machine-value',
  node: '/owned/node', worker: '/owned/worker.mjs', taRoot: '/owned/ta', run: '/owned/ta/runs/initial', mode: 'initial' });

test('runtime credentials are fresh and separate for all three principals', () => {
  const first = issueRuntimeCredentials(), second = issueRuntimeCredentials();
  assert.deepEqual(Object.keys(first), ['customer', 'collection', 'operator']);
  const all = [...Object.values(first), ...Object.values(second)].flatMap(row => [row.token, row.csrf]);
  assert.equal(new Set(all).size, 12);
  assert.ok(all.every(value => /^[0-9a-f]{48}$/.test(value)));
});

test('private production configuration supplies all generated substitutions without environment credentials', () => {
  const input = options(), value = productionConfiguration(input);
  assert.equal(value.origin, 'http://127.0.0.1:18761');
  assert.match(value.text, /^include "application.conf"\n/);
  assert.ok(value.text.includes('play.http.secret.key = "private-play-value"'));
  assert.ok(value.text.includes('service.connections."bank-mongo-connection" = '));
  assert.ok(value.text.includes('service.connections."bank-mysql-connection" = '));
  assert.ok(value.text.includes('db.default.password = "private-mysql-value"'));
  assert.ok(!value.text.includes('${'));
  assert.ok(value.mongo.endsWith('/truthsrc_test?authSource=admin'));
  assert.ok(value.text.includes('"minorUnits":"100000"'));
  assert.ok(value.text.includes('bank.mockTa.journal = "/owned/ta/ta.jsonl"'));
  assert.ok(value.text.includes('bank.mockTa.scenario = "confirmed"'));
  assert.ok(productionConfiguration({ ...input, mode: 'refund' }).text.includes('bank.mockTa.scenario = "rejected"'));
  assert.ok(productionConfiguration({ ...input, mode: 'replay', schema: 'truthsrc_replay' }).jdbc.includes('/truthsrc_replay?'));
});

test('production configuration refuses shared ports, duplicate endpoints and unsafe namespaces', () => {
  for (const patch of [{ httpPort: 9000 }, { mysqlPort: 3306 }, { mongoPort: 27017 }, { httpPort: 2551 },
    { mysqlPort: 18761 }, { namespace: 'name/escape' }, { schema: 'schema;drop' }, { mode: 'unknown' }]) {
    assert.throws(() => productionConfiguration({ ...options(), ...patch }));
  }
});
