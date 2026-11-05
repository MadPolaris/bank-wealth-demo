import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { Server, createConnection } from 'node:net';
import { PassThrough } from 'node:stream';
import { startDatabaseRelay } from '../tools/truthsrc-runtime-db-relay.mjs';

const base = { docker: '/test-only/docker', containerId: 'a'.repeat(64), hostPort: 18762, containerPort: 3306, env: {} };

async function rejectsBeforeListen(t, changes) {
  // Safety tripwire, not a server substitute: even a validation regression must not bind.
  const listen = t.mock.method(Server.prototype, 'listen', () => { throw new Error('Default relay tests must not listen'); });
  const spawnImpl = t.mock.fn(() => { throw new Error('Relay tests must not spawn a process'); });
  const errors = [];
  for (const change of changes) {
    await assert.rejects(startDatabaseRelay({ ...base, ...change, spawnImpl }), error => {
      assert.equal(error.code, 'ERR_ASSERTION'); errors.push(error); return true;
    });
  }
  assert.equal(listen.mock.callCount(), 0);
  assert.equal(spawnImpl.mock.callCount(), 0);
  return errors;
}

test('unsafe Docker paths and container IDs are rejected before listening or spawning', async t => {
  await rejectsBeforeListen(t, [
    ...['', 'docker', './docker', '/tmp/docker --host=x', '/tmp/docker;id', '/tmp/$(id)', '/tmp/a\nb'].map(docker => ({ docker })),
    ...['', 'mysql', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(32) + '\n' + 'a'.repeat(32), 'a'.repeat(64) + ';id'].map(containerId => ({ containerId })),
  ]);
});

test('ports must be numeric and exactly match one of the two reserved database pairs', async t => {
  await rejectsBeforeListen(t, [
    ...[undefined, null, 0, 3306, 27017, 18761, 18764, 18762.5, '18762', NaN, Infinity].map(hostPort => ({ hostPort })),
    ...[undefined, null, 0, 3307, 27017, '3306', NaN, Infinity].map(containerPort => ({ containerPort })),
    { hostPort: 18763, containerPort: 3306 },
    { hostPort: 18762, containerPort: 27017 },
  ]);
});

test('rejected configuration neither reads nor reports an unused synthetic credential environment', async t => {
  const secret = 'synthetic-relay-credential-never-read', env = {};
  let reads = 0;
  Object.defineProperty(env, 'BANK_RELAY_TEST_CREDENTIAL', { enumerable: true, get() { reads++; return secret; } });
  const errors = await rejectsBeforeListen(t, [{ docker: 'relative', env }, { containerId: 'invalid', env }, { hostPort: 0, env }]);
  assert.equal(reads, 0);
  for (const error of errors) {
    assert.ok(!String(error).includes(secret));
    assert.ok(!JSON.stringify(error).includes(secret));
  }
});

test('source contract confines listeners, Docker exec targets and termination to local owned resources', () => {
  // Lexical checks only; successful startup and stream behavior are opt-in below.
  const source = readFileSync(new URL('../tools/truthsrc-runtime-db-relay.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/\bfrom '([^']+)'/g)].map(match => match[1]), ['node:assert/strict', 'node:child_process', 'node:net', './truthsrc-runtime-db-exec.mjs']);
  for (const contract of [
    '[[18762, 3306], [18763, 27017]]',
    "server.listen({ host: '127.0.0.1', port: hostPort, exclusive: true }",
    "'exec 3<>/dev/tcp/127.0.0.1/' + containerPort",
    "['--host', 'unix:///var/run/docker.sock', 'exec', '-i', containerId, 'bash', '-c', script]",
    'active.set(child, { socket, stop, record })',
    "child?.kill('SIGTERM')",
    "for (const child of active.keys()) child.kill('SIGKILL')",
  ]) assert.ok(source.includes(contract), `Missing local/owned relay contract: ${contract}`);
  assert.equal((source.match(/\bspawnImpl\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\b(?:spawn|exec|execFile|spawnSync|execSync|execFileSync)\s*\(|\bprocess\.kill\s*\(|\b(?:pkill|killall)\b|--(?:publish|network)|\b(?:fetch|connect|createConnection)\s*\(/);
});

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(done => setTimeout(done, 10));
  }
}

function fakeChild(pid) {
  const child = new EventEmitter();
  Object.assign(child, { pid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), input: [], signals: [], closed: false });
  child.stdin.on('data', bytes => child.input.push(Buffer.from(bytes)));
  child.once('close', () => { child.closed = true; });
  let closing = false;
  child.finish = (code = 0, signal = null) => {
    if (closing) return;
    closing = true; child.stdin.end(); child.stdout.end(); child.stderr.end();
    queueMicrotask(() => child.emit('close', code, signal));
  };
  child.kill = signal => { child.signals.push(signal); child.finish(null, signal); return true; };
  return child;
}

test('opt-in 18762 socket preserves bytes, handles EOF/close/shutdown and reports only owned session metadata', {
  // Only main may opt in after the active runtime window has released 18762.
  // No ephemeral-port fallback, 18763 listener, Docker invocation or JVM is used.
  skip: process.env.BANK_RELAY_NETWORK_TEST === '1' ? false : 'Requires BANK_RELAY_NETWORK_TEST=1 and main authorization after runtime releases 127.0.0.1:18762; default tests never bind.',
  timeout: 30_000,
}, async t => {
  const calls = [], sockets = new Set(), socketErrors = [], unrelated = fakeChild(97000);
  const secret = 'synthetic-relay-credential-only', env = { PATH: '/test-only', BANK_RELAY_TEST_CREDENTIAL: secret, NODE_V8_COVERAGE: 'unused-test-path' };
  let relay, closing;
  const closeRelay = () => closing ??= relay.close();
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (relay) await closeRelay();
  });
  relay = await startDatabaseRelay({ ...base, env, spawnImpl: (executable, args, options) => {
    const child = fakeChild(97001 + calls.length);
    calls.push({ executable, args, options, child }); return child;
  } });
  assert.deepEqual(relay.address, { host: '127.0.0.1', port: 18762 });

  async function connect() {
    const index = calls.length, received = [];
    const socket = createConnection({ host: '127.0.0.1', port: 18762 });
    sockets.add(socket);
    socket.on('data', bytes => received.push(Buffer.from(bytes)));
    socket.on('error', error => socketErrors.push(error));
    await once(socket, 'connect');
    await waitFor(() => calls.length === index + 1, 'Relay did not create the mock exec session');
    return { socket, child: calls[index].child, received };
  }

  const first = await connect();
  const request = Buffer.concat([Buffer.from([0, 255, 128, 13, 10]), Buffer.from('client-payload:' + secret)]);
  const response = Buffer.concat([Buffer.from([254, 0, 129, 10]), Buffer.from('database-payload:' + secret)]);
  const diagnostic = 'mock-stderr:' + secret;
  first.socket.write(request.subarray(0, 3)); first.socket.write(request.subarray(3));
  first.child.stdout.write(response.subarray(0, 2)); first.child.stdout.write(response.subarray(2));
  first.child.stderr.write(diagnostic);
  await waitFor(() => Buffer.concat(first.child.input).length === request.length && Buffer.concat(first.received).length === response.length, 'Bidirectional bytes did not arrive');
  assert.deepEqual(Buffer.concat(first.child.input), request);
  assert.deepEqual(Buffer.concat(first.received), response);
  first.socket.end();
  await waitFor(() => first.child.stdin.writableFinished, 'Client EOF did not finish child stdin');
  assert.deepEqual(first.child.signals, []);
  first.child.finish();
  await waitFor(() => first.socket.closed && first.child.closed, 'EOF session did not close');

  const exited = await connect();
  exited.child.finish();
  await waitFor(() => exited.socket.closed && exited.child.closed, 'Child close did not close its client');
  assert.deepEqual(exited.child.signals, []);

  const disconnected = await connect();
  // destroy() alone can send only FIN to an allowHalfOpen server; force a full reset.
  disconnected.socket.resetAndDestroy();
  await waitFor(() => disconnected.child.closed, 'Disconnected session did not terminate its owned child');
  assert.ok(disconnected.child.stdin.writableEnded);
  assert.deepEqual(disconnected.child.signals, ['SIGTERM']);

  const shutdown = [await connect(), await connect()];
  const receipt = await closeRelay();
  await waitFor(() => shutdown.every(({ socket }) => socket.closed), 'Shutdown did not close all owned clients');
  assert.deepEqual(calls.map(({ child }) => child.signals), [[], [], ['SIGTERM'], ['SIGTERM'], ['SIGTERM']]);
  assert.deepEqual(unrelated.signals, []);
  assert.ok(calls.every(({ child }) => child.closed && child.stdin.writableEnded));
  assert.equal(calls.length, 5);
  for (const { executable, args, options } of calls) {
    assert.equal(executable, base.docker);
    assert.deepEqual(args, ['--host', 'unix:///var/run/docker.sock', 'exec', '-i', base.containerId, 'bash', '-c',
      'exec 3<>/dev/tcp/127.0.0.1/3306; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait "$reader" 2>/dev/null; exit 0']);
    assert.deepEqual(options, { env: { ...env, NODE_V8_COVERAGE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    assert.ok(!args.join(' ').includes(secret));
  }
  assert.equal(env.NODE_V8_COVERAGE, 'unused-test-path');
  assert.deepEqual(receipt, {
    kind: 'owned-docker-exec-relay', host: '127.0.0.1', port: 18762, containerId: base.containerId,
    closed: true, failed: false,
    sessions: calls.map(({ child }, sequence) => ({
      sequence, pid: child.pid, code: sequence < 2 ? 0 : null, signal: sequence < 2 ? null : 'SIGTERM', closed: true,
      bytesToDatabase: sequence === 0 ? request.length : 0, bytesFromDatabase: sequence === 0 ? response.length : 0,
    })),
  });
  const publicText = JSON.stringify(receipt);
  for (const value of [secret, 'BANK_RELAY_TEST_CREDENTIAL', 'client-payload:', 'database-payload:', diagnostic]) assert.ok(!publicText.includes(value));
  assert.deepEqual(socketErrors, []);
});
