/*
 * The bytes a selection holds, as Authoring digests: distinct and sorted. Pure; a malformed digest
 * throws zod's error (select.ts turns it into `invalid-input`), and Authoring owns recovery.
 * Adding or removing Model's `sha256:` prefix is contract/brands.ts (`pinnedDigest`,
 * `bareDigest`).
 */
import type { AuthoringDigest } from '../../../contract/brands.js';
import { authoringDigest } from '../../../contract/schemas.js';

/** Distinct digests in sorted order, each checked as an Authoring digest (throws zod's error when one is malformed). */
export function sortedDigests(values: readonly string[]): readonly AuthoringDigest[] {
  return [...new Set(values)].toSorted().map((value) => authoringDigest.parse(value));
}
