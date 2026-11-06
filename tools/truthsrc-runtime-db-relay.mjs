import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { openDatabaseExec } from './truthsrc-runtime-db-exec.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));

async function startApiRelay({ containerId, hostPort, containerPort }) {
  const active = new Set(), sessions = [], clients = new Set();
  let stopped = false, failed = false, index = 0;
  const server = createServer({ allowHalfOpen: true }, socket => {
    if (stopped || active.size >= 128) { socket.destroy(); return; }
    socket.pause(); clients.add(socket);
    const record = { sequence: index++, execId: null, closed: false, code: null, bytesToDatabase: 0, bytesFromDatabase: 0 };
    sessions.push(record);
    let exec, closing;
    const job = (async () => {
      try {
        exec = await openDatabaseExec(containerId, containerPort); record.execId = exec.execId;
        const finish = () => closing ??= exec.close().then(result => {
          Object.assign(record, result); if (result.failure) failed = true;
        }, () => { failed = true; record.failure = true; record.closed = false; });
        socket.setTimeout(120_000, () => socket.destroy());
        socket.on('data', bytes => { record.bytesToDatabase += bytes.length; });
        exec.output.on('data', bytes => { record.bytesFromDatabase += bytes.length; });
        socket.on('error', () => { void finish(); });
        socket.on('end', () => { void finish(); }); socket.on('close', () => { void finish(); });
        exec.output.on('end', () => { void finish(); socket.end(); });
        exec.output.on('error', () => { failed = true; socket.destroy(); void finish(); });
        socket.pipe(exec.input); exec.output.pipe(socket); socket.resume();
        if (socket.destroyed || stopped) await finish();
        else { while (!closing && !stopped) await pause(25); await finish(); }
      } catch { failed = true; record.failure = true; }
      finally { clients.delete(socket); socket.destroy(); }
    })();
    active.add(job); void job.finally(() => active.delete(job));
  });
  server.on('error', () => { failed = true; });
  await new Promise((done, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: hostPort, exclusive: true }, done); });
  return { address: { host: '127.0.0.1', port: hostPort }, async close() {
    stopped = true;
    const done = new Promise(resolve => server.close(resolve));
    for (const socket of clients) socket.destroy();
    await Promise.all([...active]); await done;
    return { kind: 'owned-docker-api-exec-relay', host: '127.0.0.1', port: hostPort, containerId,
      closed: !server.listening && active.size === 0 && sessions.every(s => s.closed), failed, sessions };
  } };
}


// Docker Desktop does not publish ports on internal networks. An exec stream has
// no container egress and needs no extra network attachment or password argument.
export async function startDatabaseRelay({ docker, containerId, hostPort, containerPort, env, spawnImpl = spawn }) {
  assert.ok(/^[/][A-Za-z0-9/_.-]+$/.test(docker));
  assert.match(containerId, /^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(hostPort) && hostPort > 1024 && hostPort <= 65535 && ![9000, 2551, 3306, 27017].includes(hostPort),
    'explicit unprivileged nonshared host port required');
  assert.ok([3306, 27017].includes(containerPort), 'fixed database container port required');
  if (spawnImpl === spawn) return startApiRelay({ containerId, hostPort, containerPort });
  const active = new Map(), clients = new Set(), sessions = [];
  let stopped = false, sequence = 0, failed = false;
  const server = createServer({ allowHalfOpen: true }, socket => {
    if (stopped || active.size >= 128) { socket.destroy(); return; }
    clients.add(socket);
    socket.setTimeout(120_000, () => socket.destroy());
    const script = 'exec 3<>/dev/tcp/127.0.0.1/' + containerPort + '; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait "$reader" 2>/dev/null; exit 0';
    const args = ['--host', 'unix:///var/run/docker.sock', 'exec', '-i', containerId, 'bash', '-c', script];
    const record = { sequence: sequence++, pid: null, code: null, signal: null, closed: false, bytesToDatabase: 0, bytesFromDatabase: 0 };
    let child, killer, escalator, ended = false;
    const stop = () => {
      if (ended) return;
      ended = true; clients.delete(socket); socket.destroy();
      child?.stdin.end();
      killer = setTimeout(() => child?.kill('SIGTERM'), 1500);
      escalator = setTimeout(() => { if (child && active.has(child)) child.kill('SIGKILL'); }, 6500);
    };
    try {
      child = spawnImpl(docker, args, { env: { ...env, NODE_V8_COVERAGE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
      record.pid = child.pid ?? null;
      active.set(child, { socket, stop, record }); sessions.push(record);
      socket.on('data', bytes => { record.bytesToDatabase += bytes.length; });
      child.stdout.on('data', bytes => { record.bytesFromDatabase += bytes.length; });
      child.stderr.resume();
      child.stderr.on('error', stop); child.stdin.on('error', stop); child.stdout.on('error', stop);
      socket.pipe(child.stdin); child.stdout.pipe(socket);
      socket.on('end', () => child.stdin.end());
      socket.on('error', stop); socket.on('close', () => { clients.delete(socket); stop(); });
      child.once('error', () => { failed = true; stop(); });
      child.once('close', (code, signal) => {
        record.code = code; record.signal = signal; record.closed = true;
        if (code !== 0 && !ended) failed = true;
        clearTimeout(killer); clearTimeout(escalator); ended = true; active.delete(child); clients.delete(socket); socket.destroy();
      });
    } catch { failed = true; stop(); }
  });
  server.on('error', () => { failed = true; });
  await new Promise((done, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: hostPort, exclusive: true }, done); });
  const address = server.address();
  assert.equal(address.address, '127.0.0.1'); assert.equal(address.port, hostPort);
  return {
    address: { host: address.address, port: address.port },
    async close() {
      stopped = true;
      const closed = new Promise(done => server.close(() => done()));
      for (const { stop } of active.values()) stop();
      for (const socket of clients) socket.destroy();
      const until = Date.now() + 10_000;
      while (active.size && Date.now() < until) await pause(25);
      if (active.size) for (const child of active.keys()) child.kill('SIGKILL');
      const reap = Date.now() + 5000;
      while (active.size && Date.now() < reap) await pause(25);
      await closed;
      return { kind: 'owned-docker-exec-relay', host: '127.0.0.1', port: hostPort, containerId,
        closed: !server.listening && active.size === 0, failed, sessions };
    },
  };
}
