import { captureProcessInspectionOptions, captureProcessOptions, inspectProcessEvidence, runVerifiedProcess } from '../../metarch-truthsrc/lib/verification/process.mjs';

const SCHEMA = 'bank.truthsrc-runtime-process/v1';
export { processEvidencePaths } from '../../metarch-truthsrc/lib/verification/process.mjs';

// Preserve the bank API and schema; bounded execution lives in the public tool.
export async function runRuntimeProcess(options = {}) {
  return runVerifiedProcess({ ...captureProcessOptions(options), receiptSchemaVersion: SCHEMA });
}

// Static successful-receipt gate. Never probes or signals a recorded PID.
export function inspectRuntimeProcessEvidence(base, options = {}) {
  const admitted = captureProcessInspectionOptions(options, ['schemaVersion', 'expectedSignal', 'embedded']);
  return inspectProcessEvidence(base, { ...admitted, schemaVersion: SCHEMA });
}
