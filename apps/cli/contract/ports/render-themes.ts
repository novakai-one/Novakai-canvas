/*
 * The render environment's theme rules: the installation's shipped presets, and admitting one
 * `.theme` file's theme over its staged fonts. Declaration only; adapters/render/themes.ts
 * implements it. Admission grows a catalog value; nothing stored is changed. Every failure is the
 * owner's evidence, returned as a value.
 */
import type { RenderEvidence } from '../records/render-failure.js';
import type { FontRole, ThemeAdmission } from '../records/theme-source.js';
import type { Catalog } from '../records/foreign.js';
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';

/** A theme font as the theme admission binds it: its role and the Assets digest of its bytes. */
export interface FontBinding {
  readonly alias: FontRole;
  readonly digest: AssetDigest;
}

/** The installation's catalog and theme admission for one render. */
export interface RenderThemes {
  /** The installation's shipped presets, before any `.theme` file is admitted. */
  readonly catalog: Catalog;
  /**
   * `catalog` with `theme` admitted over its staged `fonts`. Fails with the service's theme
   * preparation or Templates' admission failure.
   */
  admit(
    catalog: Catalog,
    theme: ThemeAdmission,
    fonts: readonly FontBinding[],
  ): Result<Catalog, RenderEvidence>;
}
