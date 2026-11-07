import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = file => pathToFileURL(join(root, file)).href;

function importClosure(entry, allowedBankFiles = null) {
  const bank = pathToFileURL(root + '/').href;
  const loader = `
    import assert from 'node:assert/strict';
    let port;
    export function initialize(data) { port = data.port; }
    export async function resolve(specifier, context, nextResolve) {
      const result = await nextResolve(specifier, context);
      if (result.url.startsWith(${JSON.stringify(bank)})) {
        assert.ok(!/\\/(?:v1-[^/]+|truth-source|historical-source|historical-assets)\\.mjs$/.test(result.url),
          'current primitive loaded historical execution machinery');
        const allowed = ${JSON.stringify(allowedBankFiles?.map(url) ?? null)};
        if (allowed) assert.ok(allowed.includes(result.url), 'primitive loaded bank admission/orchestration');
      }
      port.postMessage(result.url);
      return result;
    }
  `;
  const code = `
    import { register } from 'node:module';
    import { MessageChannel } from 'node:worker_threads';
    const { port1, port2 } = new MessageChannel();
    const seen = new Set(), sentinel = 'data:text/javascript,export default 1';
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    port1.on('message', value => { seen.add(value); if (value === sentinel) finish(); });
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loader)}),
      { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });
    await import(${JSON.stringify(url(entry))});
    await import(sentinel); await done; port1.close();
    console.log(JSON.stringify([...seen]));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 15_000, env: { PATH: '/usr/bin:/bin', NODE_V8_COVERAGE: '' },
  }));
}

test('cooperative lease imports only its bank file-policy adapter and public primitives', () => {
  const closure = importClosure('tools/truthsrc-runtime-lease.mjs', [
    'tools/truthsrc-runtime-lease.mjs', 'tools/truthsrc-evidence.mjs',
  ]);
  assert.ok(closure.includes(url('../metarch-truthsrc/lib/verification/files.mjs')));
  assert.ok(closure.includes(url('../metarch-truthsrc/lib/verification/lease.mjs')));
  assert.ok(!closure.some(file => file.endsWith('/verify-truthsrc-build.mjs')));
});

test('session import no longer loads historical crash and release-build execution for worker cleanup', () => {
  const closure = importClosure('tools/bank-workshop-session.mjs');
  assert.ok(closure.includes(url('tools/truthsrc-worker-evidence.mjs')));
  assert.ok(closure.includes(url('../metarch-truthsrc/lib/verification/worker-evidence.mjs')));
  assert.ok(closure.includes(url('../metarch-truthsrc/lib/verification/process.mjs')));
  assert.ok(!closure.includes(url('tools/truthsrc-runtime-crash.mjs')));
});

test('current build and admission preserve public bank adapter export identities', async () => {
  const adapter = await import('../tools/truthsrc-evidence.mjs');
  const build = await import('../tools/verify-truthsrc-build.mjs');
  const admission = await import('../tools/truthsrc-runtime-admission.mjs');
  assert.equal(build.safePath, adapter.safePath);
  assert.equal(admission.captureRuntimeFile, adapter.captureRuntimeFile);
});

test('service report imports static public-backed inspectors, not live worker waiting', () => {
  const source = readFileSync(join(root, 'tools/bank-workshop-verification.mjs'), 'utf8');
  assert.match(source, /import \{ inspectRuntimeWorker \} from '\.\/truthsrc-worker-evidence\.mjs'/);
  assert.match(source, /import \{ inspectRuntimeProcessEvidence \} from '\.\/truthsrc-runtime-process\.mjs'/);
  assert.doesNotMatch(source, /\bcheckRuntimeWorker\s*\(/);
});
