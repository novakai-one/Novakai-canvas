/*
 * Digest text as selection handles it: Model pins bytes as `sha256:<hex>`, Assets and Authoring
 * as bare hex. Pure; the one place selection adds or removes the prefix. A malformed digest throws
 * zod's error (select.ts turns it into `invalid-input`), and Authoring owns recovery.
 * Planned: the service `contract/brands.ts` PR replaces `PIN_PREFIX`, `prefixed` and `bare` with
 * `pinnedDigest` / `bareDigest`; only `sortedDigests` stays here.
 */
import type { Digest } from '../../../contract/records/capabilities.js';
import { authoringDigest } from '../../../contract/schemas.js';

/** Model digests carry this prefix; Assets and Authoring digests do not. */
export const PIN_PREFIX = 'sha256:';

/** Model's form of an Assets digest. */
export function prefixed(value: string): string {
  return `${PIN_PREFIX}${value}`;
}

/** Assets' form of a Model digest: the `sha256:` prefix removed. */
export function bare(value: string): string {
  return value.slice(PIN_PREFIX.length);
}

/** Distinct digests in sorted order, each checked as an Authoring digest (throws zod's error when one is malformed). */
export function sortedDigests(values: readonly string[]): readonly Digest[] {
  return [...new Set(values)].toSorted().map((value) => authoringDigest.parse(value));
}
