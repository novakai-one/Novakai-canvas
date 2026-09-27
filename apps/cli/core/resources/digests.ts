/*
 * The one conversion between Model's pinned content identity (`sha256:` then 64 hex digits) and the
 * bare hex digests Assets and Templates use. Pure. A text that is not a pin is no failure here: the
 * caller decides what it names (a file path, for a resource declaration).
 */
import { assetDigest, pinnedDigest } from '../../contract/brands.js';
import type { AssetDigest, PresetDigest } from '../../contract/brands.js';

/** Model's pinned form of a hex digest. */
export type PinnedDigest = `sha256:${string}`;

/** What Model's pinned form puts before the hex. */
const pinPrefix = 'sha256:';

/** Model's pinned form of an Assets or Templates digest: `sha256:` then the same hex. */
export function pinOf(digest: AssetDigest | PresetDigest): PinnedDigest {
  return `${pinPrefix}${digest}`;
}

/**
 * The Assets digest `text` pins, when it passes Model's {@link pinnedDigest}; otherwise
 * `undefined`. The hex is branded by Assets' own schema.
 */
export function assetOfPin(text: string): AssetDigest | undefined {
  if (!pinnedDigest.safeParse(text).success) return undefined;
  const digest = assetDigest.safeParse(text.slice(pinPrefix.length));
  if (!digest.success) return undefined;
  return digest.data;
}
