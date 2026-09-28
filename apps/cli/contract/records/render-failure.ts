/*
 * Why this file exists
 *
 * When render:png can't finish, it still prints one JSON record, so a script can read what went
 * wrong. `--collection commerce` matches two shipped collections, so it prints `render-failed`
 * with a `collection-selection` fault as the record's `source`.
 *
 * This file names that record and what its `source` may hold. It declares types only. The
 * render's own faults are listed in `render-fault.ts`.
 */
import type { CliFailure } from '../errors.js';
import type { FailureSource } from './foreign.js';
import type { RenderFault } from './render-fault.js';

/**
 * Why a render failed: one of render:png's own faults, a CLI mistake (such as a font it couldn't
 * read), or another part's own failure, kept whole.
 */
export type RenderEvidence = RenderFault | CliFailure | FailureSource;

/** The failure render:png prints as JSON. A render never changes a saved collection. */
export interface RenderFailure {
  readonly code: 'render-failed';
  readonly message: string;
  readonly recovery: string;
  readonly source: RenderEvidence;
}
