import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PersistentMockTA } from '../simulator/mock-ta.mjs';
import { canonicalJson, exactObject } from '../simulator/contract.mjs';

const bank = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [journalPath] = process.argv.slice(2);
const owned = path.join(bank, '.scratch/p24-p25-bank-joint-fkcd3jwe');
if (process.argv.length !== 3 || !journalPath || !path.isAbsolute(journalPath) ||
    !journalPath.startsWith(owned + path.sep) || path.resolve(journalPath) !== journalPath) throw new Error('explicit owned journal path required');
let parent = path.dirname(journalPath);
while (parent !== bank) {
  if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('journal ancestor symlink refused');
  parent = path.dirname(parent);
}
const ta = new PersistentMockTA({ journalPath });
let closed = false;
const close = () => { if (!closed) { closed = true; ta.close(); } };
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > 65536) throw new Error('worker input capacity exceeded');
    const message = JSON.parse(line);
    let result;
    try {
      exactObject(message, ['id', 'op', 'input'], [], 'worker request');
      if (!Number.isSafeInteger(message.id) || message.id < 0) throw new Error('explicit request sequence required');
      switch (message.op) {
        case 'submit': result = ta.submit(message.input); break;
        case 'query': result = ta.query(message.input); break;
        case 'advance': result = ta.advanceBusinessClock(message.input); break;
        case 'close': close(); result = { closed: true }; break;
        default: throw new Error('unknown worker operation');
      }
      process.stdout.write(canonicalJson({ id: message.id, ok: true, result }) + '\n');
    } catch (error) {
      process.stdout.write(canonicalJson({ id: message.id, ok: false, error: { code: error.code ?? 'WORKER_REQUEST', message: error.message } }) + '\n');
    }
    if (closed) break;
  }
} finally { lines.close(); close(); }
