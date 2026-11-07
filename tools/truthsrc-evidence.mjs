import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';
import { types } from 'node:util';
import { assertCanonicalPath, captureEvidenceFile } from '../../metarch-truthsrc/lib/verification/files.mjs';
import { MAX_JSON_BYTES, parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';

// Bank admission's existing filename policy stays here, not in the public helper.
// This module has no build/runtime admission imports or import-time evidence reads.
export function safePath(file, kind = 'directory') {
  assert.ok(typeof file === 'string' && isAbsolute(file) && resolve(file) === file &&
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file), 'canonical plain absolute path required: ' + file);
  assert.ok(!file.split('/').some(part => ['.', '..', '.scratch'].includes(part)), 'forbidden path component: ' + file);
  return assertCanonicalPath(file, { kind });
}

export function captureRuntimeFile(file, input = {}) {
  assert.ok(input && typeof input === 'object' && !types.isProxy(input) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(input)), 'plain capture options required');
  const options = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    assert.ok(['json', 'limit'].includes(key) && descriptor.enumerable && Object.hasOwn(descriptor, 'value'),
      'unknown or non-data capture option');
    options[key] = descriptor.value;
  }
  const { json = false, limit = MAX_JSON_BYTES } = options;
  assert.equal(typeof json, 'boolean', 'json must be boolean');
  safePath(file, 'file');
  return captureEvidenceFile(file, { limit, parse: json ? parseStrictJson : undefined,
    // Preserve the narrowly scoped system launcher exception; never realpath an
    // arbitrary alias into this identity. Policy inspects the opened descriptor.
    allowHardlinks: stat => file === '/usr/bin/python3' && stat.uid === 0 && (stat.mode & 0o022) === 0 });
}
