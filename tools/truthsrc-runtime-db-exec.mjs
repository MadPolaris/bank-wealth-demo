import assert from 'node:assert/strict';
import { request } from 'node:http';
import { PassThrough } from 'node:stream';

const SOCKET = '/var/run/docker.sock';
const pause = ms => new Promise(done => setTimeout(done, ms));

export function dockerJson(method, path, body) {
  assert.ok(/^\/v1\.41\/(?:containers\/[0-9a-f]{64}\/exec|exec\/[0-9a-f]{64}\/json)$/.test(path));
  return new Promise((done, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = request({ socketPath: SOCKET, method, path, headers: { Connection: 'close',
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, res => {
      let size = 0; const chunks = [];
      res.on('data', bytes => { size += bytes.length; if (size > 65536) res.destroy(new Error('bounded Docker control response')); else chunks.push(bytes); });
      res.on('error', () => reject(new Error('Docker control response failed')));
      res.on('end', () => {
        try { assert.ok(res.statusCode >= 200 && res.statusCode < 300); done(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Docker control request failed')); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Docker control deadline')));
    req.once('error', () => reject(new Error('Docker control connection failed')));
    req.end(data);
  });
}

export function dockerFrameReader(emit, stderr) {
  let pending = Buffer.alloc(0), failed = false;
  return {
    write(bytes) {
      if (failed) return false;
      pending = Buffer.concat([pending, bytes]);
      while (pending.length >= 8) {
        const type = pending[0], length = pending.readUInt32BE(4);
        if (![0, 1, 2].includes(type) || pending[1] || pending[2] || pending[3] || length > 1024 * 1024) { failed = true; return false; }
        if (pending.length < 8 + length) break;
        const payload = pending.subarray(8, 8 + length);
        if (type === 1) emit(payload); else if (type === 2) stderr(length);
        pending = pending.subarray(8 + length);
      }
      return true;
    },
    end() { if (pending.length) failed = true; return !failed; },
  };
}

export async function openDatabaseExec(containerId, containerPort) {
  assert.match(containerId, /^[0-9a-f]{64}$/);
  assert.ok([3306, 27017].includes(containerPort));
  const script = 'exec 3<>/dev/tcp/127.0.0.1/' + containerPort + '; cat <&3 & reader=$!; cat <&0 >&3 & writer=$!; wait -n "$reader" "$writer"; kill "$reader" "$writer" 2>/dev/null; wait "$reader" "$writer" 2>/dev/null; exit 0';
  const created = await dockerJson('POST', '/v1.41/containers/' + containerId + '/exec', {
    AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false, Cmd: ['bash', '-c', script],
  });
  assert.match(created.Id, /^[0-9a-f]{64}$/);
  const execId = created.Id, output = new PassThrough();
  let socket, ended = false, failure = false, stderrBytes = 0;
  const frames = dockerFrameReader(bytes => {
    if (!output.write(bytes)) { socket.pause(); output.once('drain', () => socket.resume()); }
  }, count => { stderrBytes += count; });
  const finish = () => { if (!ended) { ended = true; if (!frames.end()) failure = true; output.end(); } };
  await new Promise((done, reject) => {
    const data = Buffer.from('{"Detach":false,"Tty":false}');
    const req = request({ socketPath: SOCKET, method: 'POST', path: '/v1.41/exec/' + execId + '/start',
      headers: { Connection: 'Upgrade', Upgrade: 'tcp', 'Content-Type': 'application/json', 'Content-Length': data.length } });
    req.setTimeout(10_000, () => req.destroy(new Error('Docker exec upgrade deadline')));
    req.once('error', () => reject(new Error('Docker exec upgrade failed')));
    req.once('response', res => { res.resume(); reject(new Error('Docker exec did not upgrade its stream')); });
    req.once('upgrade', (res, stream, head) => {
      socket = stream;
      const consume = bytes => {
        if (!frames.write(bytes)) { failure = true; socket.destroy(); finish(); }
      };
      socket.on('data', consume);
      socket.on('error', () => { failure = true; finish(); });
      socket.on('end', finish); socket.on('close', finish);
      if (head.length) consume(head);
      done();
    });
    req.end(data);
  });
  return {
    execId, output, input: socket,
    async close() {
      socket.end();
      const until = Date.now() + 10_000;
      let status;
      do {
        status = await dockerJson('GET', '/v1.41/exec/' + execId + '/json');
        assert.equal(status.ContainerID, containerId);
        if (!status.Running) break;
        await pause(50);
      } while (Date.now() < until);
      socket.destroy(); finish();
      return { execId, closed: status.Running === false, code: status.ExitCode, failure, stderrBytes };
    },
  };
}
