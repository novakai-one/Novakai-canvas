/*
 * Workspace decoders seam: checks untrusted server and browser-stored input with the owners'
 * schemas. Declarations only; `adapters/edge/workspace-inputs.ts` implements it. Every method
 * answers a `Result` and never throws; the caller that read the input owns recovery.
 */
import type { Result } from '../errors.js';
import type { RecoveredSource } from '../records/editor-recovery.js';
import type { CarriedSnapshot } from '../records/submission.js';
import type { RenderDocument } from '../records/owners.js';

/** Turns unknown input into checked workspace records. */
export interface WorkspaceDecoders {
  /** Checks a workspace snapshot and every live collection in it. Fails with `invalid-workspace`. */
  snapshot(input: unknown): Result<CarriedSnapshot>;
  /** Checks a diagram readout as a render document. Fails with `invalid-diagram`. */
  diagram(input: unknown): Result<RenderDocument>;
  /** Checks a stored source draft against the collection it captured. Fails with `invalid-recovery`. */
  sourceRecovery(input: unknown): Result<RecoveredSource>;
}
