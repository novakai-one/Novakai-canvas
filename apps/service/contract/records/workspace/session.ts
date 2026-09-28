/*
 * Why this file exists
 *
 * A change goes through the session in two calls. `prepare` checks it, and can also render
 * preview images. `apply` saves it and answers the new workspace, so the caller doesn't need a
 * second request to see it.
 *
 * This file declares the preview choice (`PrepareMode`) and what `apply` answers (`AppliedCommit`).
 * Declarations only. Authoring saves the change.
 */
import type { Receipt, Snapshot } from '../capabilities.js';

/** What `apply` answers: the receipt of the save, and the workspace right after it. */
export interface AppliedCommit {
  readonly receipt: Receipt;
  readonly snapshot: Snapshot;
}

/**
 * Whether `prepare` also renders preview images. Set from the request body's `preview` flag.
 */
export type PrepareMode = 'with-preview' | 'without-preview';
