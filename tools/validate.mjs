import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadSnapshot, sourceGates, roundtripLocal, protectedFiles, assertSnapshotStable } from './truth-source.mjs';
import { validateDeclarations, validateArtifacts } from './artifacts.mjs';
import { checkProjections } from './project.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => !['--roundtrip', '--check-projections'].includes(arg))) throw new Error('Usage: node tools/validate.mjs [--roundtrip] [--check-projections]');
const snapshot = loadSnapshot();
const baseline = JSON.parse(readFileSync(join(ROOT, 'docs/BASELINE.json'), 'utf8'));
const source = sourceGates(snapshot);
const declarations = validateDeclarations(snapshot);
const proposals = validateArtifacts(snapshot);
const protection = { ok: JSON.stringify(protectedFiles()) === JSON.stringify(baseline.protectedFiles) };
const report = { schemaVersion: 'bank-wealth.validation-report/v1', readiness: 'truth-and-design-preview',
  canonicalSha256: snapshot.canonicalSha256, tool: { head: snapshot.tool.head, sha256: snapshot.tool.sha256 },
  baseline: { canonicalSha256: baseline.canonicalSha256, hardErrors: baseline.gates.structure.hard.length },
  structure: { ok: !source.structure.hard.length, hard: source.structure.hard, notices: source.structure.notices },
  declarations, proposals, protection, strictSaga: source.saga, strictExecution: source.execution,
  generation: 'not-run', runtime: 'not-run', codeBackAnchoring: 'not-run' };
if (args.includes('--roundtrip')) report.roundtrip = roundtripLocal(snapshot);
if (args.includes('--check-projections')) report.projections = checkProjections(snapshot);
assertSnapshotStable(snapshot);
console.log(JSON.stringify(report, null, 2));
if (!report.structure.ok || declarations.errors.length || proposals.errors.length || !protection.ok
  || report.roundtrip?.ok === false || report.projections?.ok === false
  || (baseline.gates.saga.ok && !source.saga.ok) || (baseline.gates.execution.ok && !source.execution.ok)) process.exitCode = 1;
