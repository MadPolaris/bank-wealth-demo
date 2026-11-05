import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export function issueRuntimeCredentials() {
  return Object.fromEntries(['customer', 'collection', 'operator'].map(role => [role,
    { token: randomBytes(24).toString('hex'), csrf: randomBytes(24).toString('hex') }]));
}

export function productionConfiguration({ namespace, schema, httpPort, mysqlPort, mongoPort, mysqlUser, mysqlPassword,
  mongoUser, mongoPassword, credentials, playSecret, machineToken, node, worker, taRoot, run, mode }) {
  for (const value of [namespace, schema]) assert.match(value, /^[A-Za-z][A-Za-z0-9_]{0,55}$/);
  for (const port of [httpPort, mysqlPort, mongoPort]) assert.ok(Number.isInteger(port) && port > 1024 && port < 65536 && ![9000, 2551, 3306, 27017].includes(port));
  assert.equal(new Set([httpPort, mysqlPort, mongoPort]).size, 3);
  assert.ok(['initial', 'restart', 'refund', 'replay', 'transport'].includes(mode));
  const origin = 'http://127.0.0.1:' + httpPort;
  const mongo = `mongodb://${encodeURIComponent(mongoUser)}:${encodeURIComponent(mongoPassword)}@127.0.0.1:${mongoPort}/${namespace}?authSource=admin`;
  const jdbc = `jdbc:mysql://127.0.0.1:${mysqlPort}/${schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC`;
  const values = {
    'play.http.secret.key': playSecret,
    'service.connections."bank-mongo-connection"': mongo,
    'service.connections."bank-mysql-connection"': jdbc,
    'akka.contrib.persistence.mongodb.mongo.mongouri': mongo,
    'db.default.url': jdbc, 'db.default.username': mysqlUser, 'db.default.password': mysqlPassword,
    'service.test-tier': 'database-integration', 'bank.namespace': namespace, 'bank.integration.httpPort': httpPort,
    'bank.demo.authMode': 'fixed-local-demo', 'bank.demo.version': 'bank-truthsrc-runtime-v1', 'bank.demo.origin': origin,
    'bank.demo.principals': Object.entries(credentials).map(([id, issued]) => ({ id, accountId: id,
      roles: [id === 'operator' ? 'operator' : 'customer'], token: issued.token, csrfToken: issued.csrf })),
    'bank.demo.funds': [{ code: 'fund', collectionAccountId: 'collection' }],
    'bank.demo.seeds': Object.keys(credentials).map(accountId => ({ accountId, minorUnits: accountId === 'customer' ? '100000' : '0' })),
    'bank.mockTa.node': node, 'bank.mockTa.worker': worker, 'bank.mockTa.ownedRoot': taRoot,
    'bank.mockTa.journal': join(taRoot, 'ta.jsonl'), 'bank.mockTa.transcript': join(run, 'worker.jsonl'),
    'bank.mockTa.stderr': join(run, 'worker.stderr.log'), 'bank.mockTa.scenario': mode === 'refund' ? 'rejected' : 'confirmed',
    'bank.recovery.authorization': machineToken, 'akka.actor.provider': 'local',
    'akka.loglevel': 'WARNING', 'akka.stdout-loglevel': 'WARNING',
    'akka.coordinated-shutdown.run-by-jvm-shutdown-hook': false, 'akka.coordinated-shutdown.exit-jvm': false,
    'play.server.pidfile.path': '/dev/null',
  };
  return { origin, mongo, jdbc, text: 'include "application.conf"\n' + Object.entries(values).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join('\n') + '\n' };
}
