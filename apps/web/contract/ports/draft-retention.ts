/*
 * Browser draft storage seam. Declarations only; `adapters/sessions/draft-retention.ts`
 * implements it over `Storage` and is the one place that turns a place into storage key text.
 * Every method answers a `Result`; a storage failure is `draft-retention-unavailable`, and the
 * caller that asked owns recovery.
 */
import type { RetentionSlot, WorkspaceId } from '../brands.js';
import type { Result } from '../errors.js';

/** Keyed browser storage for drafts, pending requests and preferences. */
export interface DraftRetention {
  /** Stores `value` at `place`. Fails with `draft-retention-unavailable`. */
  write(
    place: RetentionPlace,
    value: unknown,
  ): Result<void>;
  /** Reads the value at `place`, or `null` when none. Fails with `draft-retention-unavailable`. */
  read(place: RetentionPlace): Result<unknown>;
  /** Removes the value at `place`. Fails with `draft-retention-unavailable`. */
  remove(place: RetentionPlace): Result<void>;
}

/** Where one stored value lives: a slot of one workspace, or the one browser-wide slot. */
export type RetentionPlace =
  | { readonly slot: WorkspaceSlot; readonly workspace: WorkspaceId }
  | { readonly slot: BrowserSlot };

/** The slot kept once for the whole browser: interface preferences. */
export type BrowserSlot = Extract<RetentionSlot, 'ui-preferences'>;

/** The slots kept once per workspace. */
export type WorkspaceSlot = Exclude<RetentionSlot, BrowserSlot>;
