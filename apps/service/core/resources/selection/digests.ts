/*
 * The bytes a selection holds, as Authoring digests: each one checked, and a list of them distinct
 * and sorted. Pure; a malformed digest is `invalid-input` at `resources` (refusal.ts), and
 * Authoring owns recovery. Adding or removing Model's `sha256:` prefix is contract/brands.ts
 * (`pinnedDigest`, `bareDigest`).
 */
import type { AuthoringDigest } from '../../../contract/brands.js';
import type { AuthoringResult } from '../../../contract/records/capabilities.js';
import { authoringDigest } from '../../../contract/schemas.js';
import { collect, success } from '../../../contract/errors.js';
import { undecodable } from './refusal.js';

/**
 * Distinct digests in sorted order, each checked as an Authoring digest. Fails with
 * `invalid-input` at `resources` when one is malformed.
 */
export function sortedDigests(
  values: readonly string[],
): AuthoringResult<readonly AuthoringDigest[]> {
  return collect([...new Set(values)].toSorted(), checkedDigest);
}

/**
 * Bare digest text as an Authoring digest. Fails with `invalid-input` at `resources` when it is
 * malformed.
 */
export function checkedDigest(text: string): AuthoringResult<AuthoringDigest> {
  const digest = authoringDigest.safeParse(text);
  if (!digest.success) return undecodable();
  return success(digest.data);
}
