import type { Receipt, Snapshot } from '../capabilities.js';
/** An apply answer: the durable receipt and the workspace it committed, so callers install truth without a second read. */
export interface AppliedCommit {
  readonly receipt: Receipt;
  readonly snapshot: Snapshot;
}
