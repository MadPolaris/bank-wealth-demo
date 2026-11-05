import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runtimeArgs } from '../tools/verify-truthsrc-runtime.mjs';
import { CRASH_CASES } from '../tools/truthsrc-runtime-crash.mjs';
import { RUNTIME_TA_CRASH_CASES } from '../tools/truthsrc-runtime-ta-worker.mjs';

const base = ['--build-evidence', '/owned/build', '--evidence', '/owned/run', '--round', '/owned/ta', '--window', 'crash'];

test('runtime controller needs explicit immutable build, fresh outputs and fixed window', () => {
  assert.equal(runtimeArgs(['--help']), null);
  const options = runtimeArgs(base);
  assert.equal(options.window, 'crash'); assert.equal(options.browserModule, null);
  for (const flags of [[], [...base, '--window', 'all'], [...base, '--case', 'arbitrary'], [...base, '--browser-module', '/module'],
    base.slice(0, -1), [...base.slice(0, -1), 'whatever'], [...base, 'Test / test']]) assert.throws(() => runtimeArgs(flags));
  const browser = runtimeArgs([...base, '--browser-module', '/module', '--browser-executable', '/browser']);
  assert.equal(browser.browserExecutable, '/browser');
});

test('runtime TA owner allowlist and frozen recovery oracle cover the same 24 windows', () => {
  assert.equal(CRASH_CASES.length, 24); assert.equal(new Set(CRASH_CASES).size, 24);
  assert.deepEqual(CRASH_CASES, RUNTIME_TA_CRASH_CASES);
});

test('new controller uses current admission, independent boundary and no historical execution entry', () => {
  const file = fileURLToPath(new URL('../tools/verify-truthsrc-runtime.mjs', import.meta.url));
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes('await admitRuntimeBuild(options.buildEvidence)'));
  assert.ok(source.includes('runtimeSandboxText(options)'));
  assert.ok(source.includes('await admitted.assertUnchanged()'));
  assert.ok(!source.includes('runBankCrashRecovery('));
  assert.ok(!/rmSync|unlinkSync|pkill|docker.*rm|runBankRelease/.test(source));
  assert.ok(source.includes("runtimeRetryBackoffDeadline: 'OPEN'"));
});
