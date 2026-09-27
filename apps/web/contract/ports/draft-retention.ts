/*
 * Browser draft storage seam. Declarations only; `adapters/sessions/draft-retention.ts`
 * implements it over `Storage`. Every method answers a `Result`; a storage failure is
 * `draft-retention-unavailable`, and the caller that asked owns recovery.
 */
import type { Result } from '../errors.js';

/** Keyed browser storage for drafts, pending requests and preferences. */
export interface DraftRetention {
  /** Stores `value` under `key`. Fails with `draft-retention-unavailable`. */
  write(
    key: string,
    value: unknown,
  ): Result<void>;
  /** Reads the value under `key`, or `null` when none. Fails with `draft-retention-unavailable`. */
  read(key: string): Result<unknown>;
  /** Removes the value under `key`. Fails with `draft-retention-unavailable`. */
  remove(key: string): Result<void>;
}
