/*
 * Why this file exists
 *
 * A render can draw with a theme that isn't shipped: `--theme-file my.theme`. That theme has to be
 * checked and added to the themes the render knows (the catalog), with its fonts, before it can be
 * used. Adding it ("admitting" it) changes only this render's catalog, never the saved workspace.
 *
 * This file names the shipped catalog and that one step. `adapters/render/themes.ts` asks the
 * service and Templates.
 */
import type { RenderEvidence } from '../records/render-failure.js';
import type { Catalog, FontRole, ThemeAdmission } from '../records/foreign.js';
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';

/** One of a theme's fonts: its role (such as body or mono) and the digest of its stored bytes. */
export interface FontBinding {
  readonly alias: FontRole;
  readonly digest: AssetDigest;
}

/** The themes and recipes a render knows, and how it adds one more theme. */
export interface RenderThemes {
  /** The shipped themes and recipes, before any `--theme-file` is added. */
  readonly catalog: Catalog;
  /**
   * Adds `theme`, with its stored `fonts`, to `catalog`, and gives back the bigger catalog. Fails
   * when the service or Templates refuses the theme.
   */
  admit(
    catalog: Catalog,
    theme: ThemeAdmission,
    fonts: readonly FontBinding[],
  ): Result<Catalog, RenderEvidence>;
}
