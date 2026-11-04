import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot, sourceGates, roundtripLocal, protectionReport, assertSnapshotStable } from './truth-source.mjs';
import { validateDeclarations, validateArtifacts } from './artifacts.mjs';
import { validateCashContract } from './cash-contract.mjs';
import { checkProjections } from './project.mjs';

const args = process.argv.slice(2);
if (args.shift() !== '--historical') throw new Error('Historical root-tree validator. Use tools/truthsrc-project.mjs validate for the current project; historical use requires --historical.');
if (args.some((arg) => !['--roundtrip', '--check-projections'].includes(arg))) throw new Error('Usage: node tools/validate.mjs [--roundtrip] [--check-projections]');
const snapshot = loadSnapshot();
const baseline = JSON.parse(readFileSync(join(ROOT, 'docs/BASELINE.json'), 'utf8'));
const source = sourceGates(snapshot);
const declarations = validateDeclarations(snapshot);
const proposals = validateArtifacts(snapshot);
const cashContract = validateCashContract(snapshot);
const protection = protectionReport();
const report = { schemaVersion: 'bank-wealth.validation-report/v1', readiness: 'cash-contract-and-mock-ta-preview',
  canonicalSha256: snapshot.canonicalSha256, sourceFingerprint: snapshot.sourceFingerprint, tool: { head: snapshot.tool.head, sha256: snapshot.tool.sha256 },
  baseline: { canonicalSha256: baseline.canonicalSha256, hardErrors: baseline.gates.structure.hard.length },
  structure: { ok: !source.structure.hard.length, hard: source.structure.hard, notices: source.structure.notices },
  declarations, proposals, cashContract, protection, strictSaga: source.saga, strictExecution: source.execution, runtimeLowering: source.lowering,
  generation: 'not-run', runtime: 'not-run', codeBackAnchoring: 'not-run' };
if (args.includes('--roundtrip')) report.roundtrip = roundtripLocal(snapshot);
if (args.includes('--check-projections')) report.projections = checkProjections(snapshot);
assertSnapshotStable(snapshot);
console.log(JSON.stringify(report, null, 2));
if (!report.structure.ok || declarations.errors.length || proposals.errors.length || cashContract.errors.length || !protection.ok
  || report.roundtrip?.ok === false || report.projections?.ok === false
  || (baseline.gates.saga.ok && !source.saga.ok) || (baseline.gates.execution.ok && !source.execution.ok)
  || !source.lowering.ok) process.exitCode = 1;
