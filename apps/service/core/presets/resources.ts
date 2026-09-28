/*
 * Why this file exists
 *
 * A saved theme or recipe uses stored files: a theme its fonts, a recipe its images. Clean-up must
 * not remove a file that a saved preset still uses, so the preset's record lists them. For example,
 * the Ink theme's record lists the digests of its three fonts.
 *
 * This file answers that list for one preset. It never fails and never reads storage.
 */
import type { Preset } from '../../contract/records/capability-types.js';
import type { PresetDigest } from '../../contract/brands.js';

/** Lists the digests of the stored files a preset uses: a theme's fonts, a recipe's images. */
export function listPresetFileDigests(preset: Preset): readonly PresetDigest[] {
  if (preset.kind === 'theme') return preset.payload.fonts;
  return preset.payload.assets;
}
