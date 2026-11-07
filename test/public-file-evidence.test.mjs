import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { captureRuntimeFile, safePath } from '../tools/truthsrc-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, bytes = '{"ok":true}') {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bank-public-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'receipt.json');
  fs.writeFileSync(file, bytes);
  return { root, file };
}

test('bank adapter import closure excludes all build/runtime admission modules', () => {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(file, /\/(?:verify-truthsrc-build|truthsrc-runtime-admission)\.mjs$/);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^import\s[^;]*?\sfrom\s['"]([^'"]+)['"]/gm)) {
      if (match[1].startsWith('node:')) continue;
      assert.ok(match[1].startsWith('.'), 'unexpected external import: ' + match[1]);
      visit(path.resolve(path.dirname(file), match[1]));
    }
    assert.doesNotMatch(source, /\bimport\s*\(/, 'dynamic imports require explicit closure review');
  }
  visit(fileURLToPath(new URL('../tools/truthsrc-evidence.mjs', import.meta.url)));
  assert.ok([...visited].some(file => file.endsWith('/lib/verification/files.mjs')));
  assert.ok([...visited].some(file => file.endsWith('/lib/strict-json.mjs')));
  assert.equal([...visited].filter(file => file.includes('/bank-wealth-demo/')).length, 1);
});

test('safePath preserves plain POSIX, .scratch, new-leaf and type rules', t => {
  const { root, file } = fixture(t);
  assert.equal(safePath(root), root);
  assert.equal(safePath(file, 'file'), file);
  const newFile = path.join(root, 'new-receipt.json');
  assert.equal(safePath(newFile, 'new'), newFile);
  assert.equal(fs.existsSync(newFile), false);
  assert.throws(() => safePath(file), /unexpected path type/);
  assert.throws(() => safePath(root, 'file'), /unexpected path type/);
  assert.throws(() => safePath(file, 'new'), /exists or aliases/);
  assert.throws(() => safePath(path.join(root, 'RECEIPT.JSON'), 'new'), /exists or aliases/);
  assert.throws(() => safePath(path.join(root, 'absent', 'new'), 'new'));
  assert.throws(() => safePath(file, 'wrong-kind'), /invalid path kind/);
  for (const name of ['space name', '中文', 'café', 'line\nfeed', 'control\x85', 'back\\slash']) {
    fs.mkdirSync(path.join(root, name));
    assert.throws(() => safePath(path.join(root, name)), /canonical plain absolute/);
  }
  fs.mkdirSync(path.join(root, '.scratch'));
  fs.writeFileSync(path.join(root, '.scratch', 'receipt'), 'x');
  assert.throws(() => safePath(path.join(root, '.scratch')), /forbidden path component/);
  assert.throws(() => captureRuntimeFile(path.join(root, '.scratch', 'receipt')), /forbidden path component/);
  for (const input of ['/', '.', 'relative', root + '/./receipt.json', root + '//receipt.json', file + '/',
    'C:\\receipt.json', '\\\\server\\share\\receipt.json']) assert.throws(() => safePath(input, 'file'));
});

test('bank refuses directory case aliases, symlinks and ordinary hardlinks', { skip: process.platform === 'win32' }, t => {
  const { root, file } = fixture(t);
  fs.mkdirSync(path.join(root, 'Directory'));
  fs.writeFileSync(path.join(root, 'Directory', 'receipt'), 'x');
  assert.throws(() => captureRuntimeFile(path.join(root, 'directory', 'receipt')), /filesystem alias/);
  fs.symlinkSync(file, path.join(root, 'alias'));
  fs.symlinkSync(root, path.join(root, 'directory-alias'));
  assert.throws(() => captureRuntimeFile(path.join(root, 'alias')), /symlink/);
  assert.throws(() => captureRuntimeFile(path.join(root, 'directory-alias', 'receipt.json')), /symlink/);
  fs.linkSync(file, path.join(root, 'hardlink'));
  assert.equal(safePath(file, 'file'), file);
  assert.throws(() => captureRuntimeFile(file), /non-hardlinked/);
});

test('bank byte and strict JSON captures bind count/hash/parser to the same bytes', t => {
  const bytes = Buffer.from('{"message":"€ 中文","amount":"1.25","count":7}\n');
  const { file } = fixture(t, bytes);
  const raw = captureRuntimeFile(file);
  assert.deepEqual(raw, { bytes: bytes.length, sha256: hash(bytes), value: bytes });
  const parsed = captureRuntimeFile(file, { json: true, limit: bytes.length });
  assert.deepEqual(parsed, { bytes: bytes.length, sha256: hash(bytes),
    value: { message: '€ 中文', amount: '1.25', count: 7 } });
  // Preserve the old parsed-data contract: strict JSON, not a new freeze policy.
  parsed.value.count = 8;
  assert.equal(parsed.value.count, 8);
  assert.throws(() => captureRuntimeFile(file, { limit: bytes.length - 1 }), /bounded regular file/);
  assert.throws(() => captureRuntimeFile(file, { json: true, limit: bytes.length - 1 }), /bounded regular file/);
});

test('strict JSON keeps duplicate-key, UTF-8, BOM, exact-number and depth rejection', t => {
  const { file } = fixture(t);
  const invalid = ['{"x":1,"x":2}', '{"a":1,"\\u0061":2}', '{"amount":1.25}', '{"n":1e2}', '{"n":-0}',
    '{"n":9007199254740992}', '{"x":true} trailing', '﻿{"x":1}', '['.repeat(130) + '0' + ']'.repeat(130),
    Buffer.from([0x22, 0xc0, 0xaf, 0x22])];
  for (const bytes of invalid) {
    fs.writeFileSync(file, bytes);
    assert.throws(() => captureRuntimeFile(file, { json: true }), error =>
      ['PRODUCT_INPUT', 'PRODUCT_EXACT_NUMBER'].includes(error.diagnostic?.code));
    assert.deepEqual(captureRuntimeFile(file).value, Buffer.from(bytes));
  }
  fs.writeFileSync(file, '{"__proto__":{"value":1}}');
  const value = captureRuntimeFile(file, { json: true }).value;
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.deepEqual(value.__proto__, { value: 1 });
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  fs.writeFileSync(file, '{"then":1}');
  assert.deepEqual(captureRuntimeFile(file, { json: true }).value, { then: 1 });
});

test('bank default bound stays 8 MiB; a larger raw limit does not relax strict JSON', t => {
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
  bytes.write('{}');
  const { file } = fixture(t, bytes);
  assert.throws(() => captureRuntimeFile(file), /bounded regular file/);
  const raw = captureRuntimeFile(file, { limit: bytes.length });
  assert.equal(raw.bytes, bytes.length);
  assert.equal(raw.sha256, hash(bytes));
  assert.throws(() => captureRuntimeFile(file, { json: true, limit: bytes.length }), error =>
    error.diagnostic?.code === 'PRODUCT_INPUT' && /8 MiB/.test(error.message));
});

test('bank options fail closed and cannot inject parser or hardlink policy', t => {
  const { file } = fixture(t);
  let invoked = 0;
  for (const options of [null, false, 'json', [], { json: 1 }, { json: 'true' }, { json: null },
    { limit: -1 }, { limit: '8' }, { limit: Infinity }, { parse: () => true }, { allowHardlinks: true },
    { get json() { invoked++; return true; } }, Object.create({ json: true }),
    Object.defineProperty({}, 'json', { value: true }), { [Symbol('json')]: true },
    new Proxy({}, { ownKeys() { invoked++; return []; } })])
    assert.throws(() => captureRuntimeFile(file, options));
  assert.equal(invoked, 0);
});

test('bank uses one descriptor/read Buffer, including partial reads and exact EOF probe', t => {
  const { file } = fixture(t, '{"ok":true}');
  const read = fs.readSync, open = fs.openSync;
  let opens = 0;
  const buffers = [];
  t.mock.method(fs, 'openSync', (...args) => { opens++; return open(...args); });
  t.mock.method(fs, 'readSync', (fd, bytes, offset, size, position) => {
    buffers.push(bytes);
    return read(fd, bytes, offset, Math.min(3, size), position);
  });
  const value = captureRuntimeFile(file, { json: true, limit: 11 });
  assert.equal(opens, 1);
  assert.equal(buffers.length, 5);
  assert.ok(buffers.slice(0, -1).every(buffer => buffer === buffers[0]));
  assert.equal(buffers.at(-1).length, 1);
  assert.deepEqual(value, { bytes: 11, sha256: hash(buffers[0]), value: { ok: true } });
});

test('system Python exception is exact-path, root-owned and non-group/world-writable (owned mock only)', t => {
  const { root, file } = fixture(t, 'synthetic launcher bytes');
  fs.linkSync(file, path.join(root, 'hardlink'));
  const originals = Object.fromEntries(['lstatSync', 'fstatSync', 'readdirSync', 'realpathSync', 'openSync']
    .map(name => [name, fs[name]]));
  const directory = originals.lstatSync(root);
  let uid = 0, permissions = 0o755;
  const virtualFiles = ['/usr/bin/python3', '/usr/bin/python-other'];
  const descriptors = new Set();
  function systemStat(stat) { stat.uid = uid; stat.mode = (stat.mode & ~0o777) | permissions; return stat; }
  t.mock.method(fs, 'lstatSync', (name, ...args) => {
    if (['/', '/usr', '/usr/bin'].includes(name)) return directory;
    if (virtualFiles.includes(name)) return systemStat(originals.lstatSync(file, ...args));
    return originals.lstatSync(name, ...args);
  });
  t.mock.method(fs, 'readdirSync', (name, ...args) => {
    if (name === '/') return ['usr'];
    if (name === '/usr') return ['bin'];
    if (name === '/usr/bin') return ['python3', 'python-other'];
    return originals.readdirSync(name, ...args);
  });
  t.mock.method(fs, 'realpathSync', (name, ...args) =>
    ['/', '/usr', '/usr/bin', ...virtualFiles].includes(name) ? name : originals.realpathSync(name, ...args));
  t.mock.method(fs, 'openSync', (name, ...args) => {
    const fd = originals.openSync(virtualFiles.includes(name) ? file : name, ...args);
    if (virtualFiles.includes(name)) descriptors.add(fd);
    return fd;
  });
  t.mock.method(fs, 'fstatSync', (fd, ...args) => {
    const stat = originals.fstatSync(fd, ...args);
    return descriptors.has(fd) ? systemStat(stat) : stat;
  });
  assert.equal(captureRuntimeFile('/usr/bin/python3').value.toString(), 'synthetic launcher bytes');
  assert.throws(() => captureRuntimeFile('/usr/bin/python-other'), /non-hardlinked/);
  assert.throws(() => captureRuntimeFile('/usr/bin/Python3'), /filesystem alias/);
  uid = 501;
  assert.throws(() => captureRuntimeFile('/usr/bin/python3'), /non-hardlinked/);
  uid = 0;
  for (permissions of [0o775, 0o757, 0o777])
    assert.throws(() => captureRuntimeFile('/usr/bin/python3'), /non-hardlinked/);
  permissions = 0o555;
  assert.equal(captureRuntimeFile('/usr/bin/python3').sha256, hash('synthetic launcher bytes'));
  // No actual system binary was read, executed, linked or changed.
});
