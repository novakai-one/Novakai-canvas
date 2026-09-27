/*
 * The digests a preset's record retains: a theme's fonts, a recipe's assets. Pure and total.
 * Templates owns the preset and its digests; Authoring owns the record that retains them.
 */
import type { Preset, ThemePayload } from '../../contract/records/capabilities.js';

/** The digests a preset's record retains: a theme's fonts, a recipe's assets. Never fails. */
export function presetResources(preset: Preset): ThemePayload['fonts'] {
  if (preset.kind === 'theme') return preset.payload.fonts;
  return preset.payload.assets;
}
