import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadSnapshot, assertSnapshotStable } from './truth-source.mjs';
import { renderProjections, validateArtifacts, validateDeclarations } from './artifacts.mjs';
import { validateCashContract } from './cash-contract.mjs';

export function checkProjections(snapshot) {
  assertSnapshotStable(snapshot);
  const outputs = renderProjections(snapshot);
  const differences = [];
  for (const [name, content] of outputs) {
    const file = join(ROOT, 'projections', name);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) differences.push(name);
  }
  return { ok: differences.length === 0, differences, files: outputs.size };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--write'].includes(arg)) || args.length > 1) throw new Error('Usage: node tools/project.mjs [--check|--write]');
  const snapshot = loadSnapshot();
  const validation = { proposals: validateArtifacts(snapshot), declarations: validateDeclarations(snapshot), cashContract: validateCashContract(snapshot) };
  if (Object.values(validation).some((report) => report.errors.length)) { console.error(JSON.stringify(validation, null, 2)); process.exitCode = 1; return; }
  if (args[0] === '--write') {
    const outputs = renderProjections(snapshot);
    assertSnapshotStable(snapshot);
    mkdirSync(join(ROOT, 'projections'), { recursive: true });
    for (const [name, content] of outputs) writeFileSync(join(ROOT, 'projections', name), content);
    assertSnapshotStable(snapshot);
  }
  const result = checkProjections(snapshot);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
