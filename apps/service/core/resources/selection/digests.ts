/*
 * Why this file exists
 *
 * Files are known by their digest, a fingerprint of their bytes. Model writes a digest with a
 * `sha256:` prefix; Assets, Templates and Authoring write it bare, like `5341f2…`. The selector
 * gathers digests from several places, and must hand Authoring a clean list of bare ones.
 *
 * This file checks digests as Authoring's (`AuthoringDigest`) and sorts a list, each digest once.
 * A malformed one is `invalid-input` at `resources`. The prefix is handled in contract/brands.ts.
 */
import type { AuthoringDigest } from '../../../contract/brands.js';
import type { AuthoringResult } from '../../../contract/records/capability-types.js';
import { authoringDigest } from '../../../contract/schemas.js';
import { collect, success } from '../../../contract/errors.js';
import { unreadableRequestFailure } from './refusal.js';

/**
 * Checks each bare digest (text without `sha256:`), and answers them sorted, each once. Fails with
 * `invalid-input` at `resources` when one is malformed.
 */
export function checkDigests(
  bareDigests: readonly string[],
): AuthoringResult<readonly AuthoringDigest[]> {
  const sortedDigests = sortEachOnce(bareDigests);
  return collect(sortedDigests, checkDigest);
}

/**
 * Checks one bare digest (text without `sha256:`) as Authoring's. Fails with `invalid-input` at
 * `resources` when it is malformed.
 */
export function checkDigest(bareDigest: string): AuthoringResult<AuthoringDigest> {
  const digest = authoringDigest.safeParse(bareDigest);
  if (!digest.success) {
    return unreadableRequestFailure();
  }
  return success(digest.data);
}

/** Sorts the digests, keeping each one once. */
function sortEachOnce(bareDigests: readonly string[]): readonly string[] {
  const distinctDigests = new Set(bareDigests);
  return [...distinctDigests].toSorted();
}
