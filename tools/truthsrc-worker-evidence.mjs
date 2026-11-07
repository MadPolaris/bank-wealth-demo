import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { copyImmutableData } from '../../metarch-truthsrc/lib/immutable-data.mjs';
import { captureEvidenceFile } from '../../metarch-truthsrc/lib/verification/files.mjs';
import { parseWorkerTranscript, validateWorkerLifecycle } from '../../metarch-truthsrc/lib/verification/worker-evidence.mjs';
import { captureRuntimeFile, safePath } from './truthsrc-evidence.mjs';

function options(input) {
  const value = copyImmutableData(input);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'worker options required');
  const { root, transcript, round, configSha256, fixtureSha256, crash = false } = value;
  assert.equal(typeof crash, 'boolean', 'crash must be boolean');
  safePath(root); safePath(round); safePath(transcript, 'file');
  assert.match(configSha256, /^[a-f0-9]{64}$/); assert.match(fixtureSha256, /^[a-f0-9]{64}$/);
  return { ...value, root, transcript, round, configSha256, fixtureSha256, crash };
}

function captureTranscript(input) {
  const captured = captureEvidenceFile(input.transcript, { parse: parseWorkerTranscript });
  const starts = captured.value.filter(row => row.kind === 'worker-started');
  assert.equal(starts.length, 1, 'exactly one TA worker start required');
  assert.equal(captured.value[0], starts[0], 'TA worker start must be first');
  const { pid } = starts[0];
  assert.ok(Number.isSafeInteger(pid) && pid > 1, 'recorded TA worker PID required');
  return { captured, pid };
}

function inspectCaptured(input, { captured, pid }) {
  const { root, transcript, round, configSha256, fixtureSha256, crash } = input;
  // lstat also notices a dangling symlink. Never remove a retained lock.
  assert.equal(lstatSync(join(root, 'ta.jsonl.lock'), { throwIfNoEntry: false }), undefined,
    'TA worker retained its lock; no forced removal');
  const receiptFile = join(root, `ta-worker-${pid}.json`);
  const receipt = captureRuntimeFile(receiptFile, { json: true });
  const lifecycle = validateWorkerLifecycle({ rows: captured.value, receipt: receipt.value,
    expectedReceipt: { schemaVersion: 'bank.truthsrc-runtime-ta-worker/v1', pid, closed: true,
      journalPath: join(root, 'ta.jsonl'), roundRoot: round, ownedRoot: root, configSha256, fixtureSha256 },
    expectExit: !crash });
  assert.match(lifecycle.receipt.configurationDigest, /^[a-f0-9]{64}$/);
  assert.ok(transcript.endsWith('.jsonl'), 'TA transcript must use .jsonl extension');
  const stderrFile = transcript.replace(/\.jsonl$/, '.stderr.log');
  const stderr = captureRuntimeFile(stderrFile);
  assert.equal(stderr.bytes, 0, 'worker stderr must be empty');
  // absent is the existing saved attestation field, NOT a fresh PID observation
  // in static inspection. Only checkRuntimeWorker below makes that observation.
  const worker = { pid, absent: true, cleanCloseReceipt: lifecycle.receipt, jvmWaited: !crash, transcriptSha256: captured.sha256 };
  if (Object.hasOwn(input, 'embedded')) assert.deepEqual(input.embedded, worker, 'embedded worker differs from its transcript/close receipt');
  const reference = (file, capture) => ({ file, bytes: capture.bytes, sha256: capture.sha256 });
  return copyImmutableData({ worker, references: [reference(transcript, captured), reference(receiptFile, receipt), reference(stderrFile, stderr)] });
}

/** Read-only historical attestation. Same arguments as checkRuntimeWorker, plus
 * optional embedded worker evidence. Never probes, waits for, or signals a PID. */
export function inspectRuntimeWorker(input) {
  const capturedInput = options(input);
  return inspectCaptured(capturedInput, captureTranscript(capturedInput));
}

const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};

/** Live current-owned-worker check only. Preserve the previous async arguments,
 * ten-second wait and worker receipt shape. Do not use this to inspect history. */
export async function checkRuntimeWorker(input) {
  const capturedInput = options(input), transcript = captureTranscript(capturedInput);
  const deadline = Date.now() + 10_000;
  while (alive(transcript.pid) && Date.now() < deadline) await delay(100);
  assert.equal(alive(transcript.pid), false, 'TA worker remains alive; successor forbidden');
  return inspectCaptured(capturedInput, transcript).worker;
}
