import { loadSnapshot } from '../tools/truth-source.mjs';
import { loadMockContract } from './contract.mjs';
import { DEFAULT_JOURNAL } from './journal.mjs';
import { PersistentMockTACore } from './mock-ta-core.mjs';

export { ConflictError } from './mock-ta-core.mjs';

// Historical compatibility entry: keep the original snapshot and journal defaults.
// Explicit-configuration consumers import the core, never this wrapper.
export class PersistentMockTA extends PersistentMockTACore {
  constructor({ snapshot = loadSnapshot(), journalPath = DEFAULT_JOURNAL, journalIO } = {}) {
    super({ configuration: loadMockContract(snapshot), journalPath, journalIO });
  }
}

export function persistentMockTA(options = {}) { return new PersistentMockTA(options); }
