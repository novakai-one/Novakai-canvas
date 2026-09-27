/*
 * A theme pin in Templates' branded form, as recipe and theme payloads carry it. Pure. A
 * malformed identity throws zod's error; the codecs' guard (codec-refusal.ts) turns it into
 * `invalid-input` at `preset`, and Authoring owns recovery.
 */
import { presetId, presetVersion, presetDigest } from '../../contract/schemas.js';
import type { RecipePayload } from '../../contract/records/capabilities.js';

/** A theme pin as Templates stores it: kind `theme`, ID, version and bare digest. */
export type ThemePin = RecipePayload['themes'][number];

/**
 * The pin with Templates' brands minted on its ID, version and bare digest. Throws zod's error
 * when one of them does not match its Templates schema.
 */
export function brandedThemePin(pin: {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}): ThemePin {
  return {
    kind: 'theme',
    id: presetId.parse(pin.id),
    version: presetVersion.parse(pin.version),
    digest: presetDigest.parse(pin.digest),
  };
}
