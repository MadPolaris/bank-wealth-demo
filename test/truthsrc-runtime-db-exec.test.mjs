import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dockerFrameReader, dockerJson, openDatabaseExec } from '../tools/truthsrc-runtime-db-exec.mjs';

test('Docker stream admission only accepts a captured full container ID and fixed database port', async () => {
  for (const id of ['', 'mysql', 'a'.repeat(63), 'g'.repeat(64), '../container']) await assert.rejects(openDatabaseExec(id, 3306));
  for (const port of [0, 18762, 5432, '3306', null]) await assert.rejects(openDatabaseExec('a'.repeat(64), port));
});

test('Docker control paths cannot address unrelated lifecycle or remote resources', () => {
  for (const path of ['/containers/json', '/v1.41/containers/name/exec', '/v1.41/containers/' + 'a'.repeat(64) + '/stop',
    'http://remote/exec', '/v1.41/exec/' + 'a'.repeat(64) + '/json?extra=1']) assert.throws(() => dockerJson('GET', path));
});

function frame(type, text) {
  const body = Buffer.from(text), header = Buffer.alloc(8); header[0] = type; header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('Docker framing preserves split binary stdout and counts but never exposes stderr', () => {
  const output = [], errors = [], reader = dockerFrameReader(bytes => output.push(Buffer.from(bytes)), n => errors.push(n));
  const data = Buffer.concat([frame(1, Buffer.from([0, 255, 1])), frame(2, 'secret'), frame(1, 'ok')]);
  for (const byte of data) assert.equal(reader.write(Buffer.from([byte])), true);
  assert.equal(reader.end(), true);
  assert.deepEqual(Buffer.concat(output), Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from('ok')]));
  assert.deepEqual(errors, [6]);
});

test('truncated or malformed Docker stream cannot become clean completion', () => {
  for (const length of [1, 7, 8, 9]) {
    const reader = dockerFrameReader(() => {}, () => {});
    reader.write(frame(1, 'incomplete').subarray(0, length));
    assert.equal(reader.end(), false);
  }
  for (const mutate of [buffer => { buffer[0] = 3; }, buffer => { buffer[1] = 1; }, buffer => buffer.writeUInt32BE(1048577, 4)]) {
    const reader = dockerFrameReader(() => {}, () => {}), bytes = frame(1, 'x'); mutate(bytes);
    assert.equal(reader.write(bytes), false); assert.equal(reader.end(), false);
  }
});

test('exec streams are binary non-TTY and preserve unlogged opaque database data', () => {
  const source = readFileSync(new URL('../tools/truthsrc-runtime-db-exec.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("const SOCKET = '/var/run/docker.sock'"));
  assert.ok(source.includes("AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false"));
  assert.ok(source.includes("length > 1024 * 1024"));
  assert.ok(source.includes("assert.equal(status.ContainerID, containerId)"));
  assert.ok(!/console\.|writeFile|JSON.stringify\(pending\)|JSON.stringify\(bytes\)/.test(source));
});
