/*
 * The one conversion between Model's pinned content identity (`sha256:` then 64 hex digits) and the
 * bare hex digests Assets and Templates use. Pure. A text that is not a pin is no failure here: the
 * caller decides what it names (a file path for a resource declaration, a usage line for a recipe
 * pin).
 */
import { assetDigest, pinnedDigest, presetDigest } from '../../contract/brands.js';
import type { AssetDigest, PresetDigest } from '../../contract/brands.js';
import type { Parser } from '../../contract/schemas.js';

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
  return hexOfPin(text, assetDigest);
}

/**
 * The Templates digest `text` pins, when it passes Model's {@link pinnedDigest}; otherwise
 * `undefined`. The hex is branded by Templates' own schema.
 */
export function presetOfPin(text: string): PresetDigest | undefined {
  return hexOfPin(text, presetDigest);
}

/** The hex after Model's pin prefix as `owner` brands it; `undefined` when either check refuses. */
function hexOfPin<T>(
  text: string,
  owner: Parser<T>,
): T | undefined {
  if (!pinnedDigest.safeParse(text).success) return undefined;
  const digest = owner.safeParse(text.slice(pinPrefix.length));
  if (!digest.success) return undefined;
  return digest.data;
}
