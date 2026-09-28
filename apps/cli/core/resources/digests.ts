/*
 * Why this file exists
 *
 * The same stored bytes are named two ways. A source names them as a pin: `sha256:` then 64 hex
 * digits, as in `source="sha256:ab12…"`. That is Model's form. Assets and Templates use the same
 * 64 hex digits without `sha256:`.
 *
 * This file converts between the two forms, in one place. Text that isn't a pin gives back
 * `undefined`, not a mistake, because only the caller knows what to name in its message.
 */
import { assetDigest, pinnedDigest, presetDigest } from '../../contract/brands.js';
import type { AssetDigest, PresetDigest } from '../../contract/brands.js';
import type { Parser } from '../../contract/schemas.js';

/** A digest in Model's pinned form: `sha256:` then the 64 hex digits. */
export type PinnedDigest = `sha256:${string}`;

/** What Model's pinned form puts before the hex. */
const pinPrefix = 'sha256:';

/** Writes an Assets or Templates digest in Model's pinned form: `sha256:` then the same hex. */
export function formatPin(digest: AssetDigest | PresetDigest): PinnedDigest {
  return `${pinPrefix}${digest}`;
}

/**
 * Reads the Assets digest out of a pin such as `sha256:ab12…`. `text` is unchecked, such as a
 * source's `source=` value. Gives back `undefined` when it isn't a pin.
 */
export function parseAssetPin(text: string): AssetDigest | undefined {
  return hexOfPin(text, assetDigest);
}

/**
 * Reads the Templates digest out of a pin, such as the `sha256:…` part of `er@1.0.0#sha256:…`
 * in `recipe instantiate`. `text` is unchecked. Gives back `undefined` when it isn't a pin.
 */
export function parsePresetPin(text: string): PresetDigest | undefined {
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
