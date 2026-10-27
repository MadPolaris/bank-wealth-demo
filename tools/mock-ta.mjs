#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistentMockTA } from '../simulator/mock-ta.mjs';
import { attachCleanupError } from '../simulator/journal.mjs';

const HELP = `Local deterministic MockTA (no server, account ledger, Saga or refund execution).

node tools/mock-ta.mjs submit --request '<JSON object>' [--journal <repo-local path>]
node tools/mock-ta.mjs query --request-id=<literal> [--journal <repo-local path>]
node tools/mock-ta.mjs advance --ticks <nonnegative integer> [--journal <repo-local path>]
node tools/mock-ta.mjs --help

Value flags accept --flag value or --flag=value; use equals for IDs starting with --.
Default journal: .scratch/mock-ta/journal.jsonl, relative to bank-wealth-demo (not cwd).
Only nonsymlink paths under .scratch/ or .local/mock-ta/ are allowed.
Request fields (all required, no extras): requestId, orderId, paymentTxId,
investorAccountId, fundCollectionAccountId, fundCode, amount:{minorUnits,currency}, scenario.
Use exact positive minor-unit strings and the truth-configured CNY currency/scenario.
Output contains receipts, canonicalReceipts and explicit conflicts; query is read-only
for an existing journal. An unknown result is not rejection or refund authorization.
Each invocation closes its own journal/lock. Reopen demonstrates only simulator recovery.
Local fsync does not certify production power-loss or business recovery.
O_EXCL is cooperative, not kernel/distributed fencing: NOT safe against adversarial
unlink/replacement check-to-write races. Active journal rotation is unsupported.
Integrity covers retained records only; valid-prefix whole-line rollback is undetectable.
After a crash, inspect the journal and prove no writer remains before manually removing
the lock. Whole-file synchronous replay is bounded: 16 MiB journal, 4096 UTF-8 bytes
per input/fixture string; capacity failures never truncate or silently discard records.
These are local resource limits, not financial policy.
`;

function usageError(message) {
  const error = new Error(message);
  error.code = 'CLI_USAGE';
  return error;
}

function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const [command, ...flags] = args;
  if (!['submit', 'query', 'advance'].includes(command)) throw usageError('Expected submit, query, advance or --help');
  const required = { submit: '--request', query: '--request-id', advance: '--ticks' }[command];
  const options = new Map();
  for (let index = 0; index < flags.length; index++) {
    const argument = flags[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    if (![required, '--journal'].includes(flag) || options.has(flag)) throw usageError(`Unknown or duplicate flag ${flag}`);
    const value = equals === -1 ? flags[++index] : argument.slice(equals + 1);
    if (value === undefined || !value || (equals === -1 && value.startsWith('--'))) throw usageError(`Missing value for ${flag}`);
    options.set(flag, value);
  }
  if (!options.has(required)) throw usageError(`Missing ${required}`);
  let input = options.get(required);
  if (command === 'submit') {
    try { input = JSON.parse(input); } catch { throw usageError('--request must be a JSON object, not a file path'); }
  }
  if (command === 'advance') {
    if (!/^(?:0|[1-9]\d*)$/.test(input) || !Number.isSafeInteger(Number(input))) throw usageError('--ticks must be a nonnegative safe integer');
    input = Number(input);
  }
  return { command, input, journalPath: options.get('--journal') };
}

function diagnostic(error) {
  return { code: error.code || 'MOCK_TA_ERROR', name: error.name, message: error.message,
    ...(error.cleanupErrors?.length ? { cleanupErrors: error.cleanupErrors.map(diagnostic) } : {}) };
}

// Dependencies allow in-process fault tests without environment switches or disk mutation APIs.
export function main(args = process.argv.slice(2), { createTA = persistentMockTA, stdout = process.stdout, stderr = process.stderr } = {}) {
  let ta, response, primary;
  try {
    const options = parseArguments(args);
    if (options.help) { stdout.write(HELP); return; }
    ta = createTA(options.journalPath ? { journalPath: options.journalPath } : {});
    response = options.command === 'submit' ? ta.submit(options.input)
      : options.command === 'query' ? ta.query(options.input) : ta.advanceBusinessClock(options.input);
  } catch (error) { primary = error; }
  // Both operation and close failures stay inside the structured diagnostic boundary.
  // Close-only failures are primary; a failed operation keeps its original code/message.
  if (ta) {
    try { ta.close(); }
    catch (cleanup) { if (primary) attachCleanupError(primary, cleanup); else primary = cleanup; }
  }
  if (primary) {
    stderr.write(`${JSON.stringify({ error: diagnostic(primary) })}\n`);
    process.exitCode = 1;
  } else stdout.write(`${JSON.stringify(response)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
