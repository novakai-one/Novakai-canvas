/*
 * Templates brands minted for preset payloads: a bare preset digest, and a theme pin in Templates'
 * own `Pin` form (bare digest, not the `sha256:`-pinned text Model reads). Pure. A value that does
 * not match its Templates schema is `invalid-input` at `preset` (codec-refusal.ts), and Authoring
 * owns recovery.
 */
import { presetId, presetVersion, presetDigest } from '../../contract/schemas.js';
import type { PresetPin, TemplatesResult } from '../../contract/records/capability-types.js';
import { success } from '../../contract/errors.js';
import { invalidIdentity } from './codec-refusal.js';

/**
 * The theme pin (kind `theme`) with Templates' brands minted on its ID, version and bare digest.
 * Fails with `invalid-input` at `preset` when one of them does not match its Templates schema.
 */
export function brandedThemePin(pin: {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}): TemplatesResult<PresetPin> {
  const id = presetId.safeParse(pin.id);
  const version = presetVersion.safeParse(pin.version);
  const digest = presetDigest.safeParse(pin.digest);
  if (!id.success || !version.success || !digest.success) return invalidIdentity();
  return success({ kind: 'theme', id: id.data, version: version.data, digest: digest.data });
}

/**
 * Bare digest text with Templates' digest brand minted. Fails with `invalid-input` at `preset`
 * when it is not a Templates digest.
 */
export function brandedDigest(text: string): TemplatesResult<PresetPin['digest']> {
  const digest = presetDigest.safeParse(text);
  if (!digest.success) return invalidIdentity();
  return success(digest.data);
}
