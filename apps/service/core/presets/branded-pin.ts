/*
 * Why this file exists
 *
 * Templates only accepts IDs, versions and digests it has checked itself. Model writes a digest as
 * `sha256:` then hex; Templates wants the bare hex. For example, a recipe using the `ink` theme
 * must name it as `ink`, `1.1.0` and the bare digest, each checked by Templates.
 *
 * This file runs those checks for the codecs. Text that fails a check is `invalid-input` at
 * `preset` (codec-refusal.ts). It never adds or removes `sha256:`; the caller does that first.
 */
import { presetId, presetVersion, presetDigest } from '../../contract/schemas.js';
import type { PresetPin, TemplatesResult } from '../../contract/records/capability-types.js';
import type { PresetDigest } from '../../contract/brands.js';
import { success } from '../../contract/errors.js';
import { invalidIdentityFailure } from './codec-refusal.js';

/**
 * Checks a theme pin's ID, version and bare digest with Templates, and answers the pin in
 * Templates' checked form (kind `theme`). Each part is text as read; the digest has no `sha256:`.
 * Fails with `invalid-input` at `preset` when a part fails Templates' check.
 */
export function checkThemePin(pin: {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}): TemplatesResult<PresetPin> {
  const id = presetId.safeParse(pin.id);
  const version = presetVersion.safeParse(pin.version);
  const digest = presetDigest.safeParse(pin.digest);
  if (!id.success || !version.success || !digest.success) {
    return invalidIdentityFailure();
  }
  const checked: PresetPin = {
    kind: 'theme',
    id: id.data,
    version: version.data,
    digest: digest.data,
  };
  return success(checked);
}

/**
 * Checks bare digest text (no `sha256:`) with Templates, and answers it in Templates' checked
 * form. Fails with `invalid-input` at `preset` when it isn't a Templates digest.
 */
export function checkPresetDigest(text: string): TemplatesResult<PresetDigest> {
  const digest = presetDigest.safeParse(text);
  if (!digest.success) {
    return invalidIdentityFailure();
  }
  return success(digest.data);
}
