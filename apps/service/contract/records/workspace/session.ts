/*
 * What the session's mutation calls take and answer: the prepare mode and the applied commit.
 * Declarations only. Authoring owns commit and receipt recovery.
 */
import type { Receipt, Snapshot } from '../capabilities.js';

/** An apply answer: the durable receipt and the workspace it committed, so callers install truth without a second read. */
export interface AppliedCommit {
  readonly receipt: Receipt;
  readonly snapshot: Snapshot;
}

/**
 * Whether a prepare also asks Authoring's feasibility check for preview images: `with-preview`
 * or `without-preview`. Read from the mutation envelope's `preview` flag (core/transport/command.ts).
 */
export type PrepareMode = 'with-preview' | 'without-preview';
