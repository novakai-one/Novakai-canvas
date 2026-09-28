/*
 * Why this file exists
 *
 * render:png draws a collection into image files, one per section. The agent says what to draw
 * and where: `pnpm render:png --collection states --out out/ --format svg`.
 *
 * This file names what those flags ask for once checked, and the JSON a finished render prints:
 * the files it wrote and the theme it used. Themes are one kind of Templates "preset" (a saved
 * theme or recipe), so a theme's ID and digest have preset types. It declares types only.
 */
import type { RecipeOrCollectionId, FilePath, PresetDigest, PresetId, ThemeId } from '../brands.js';
import type { Collection, InspectionReport } from './foreign.js';

/** The image format every section file is written in. */
export type RenderFormat = 'svg' | 'png';

/** `all` (`--labels` typed): hidden wire labels are drawn too. `default`: only the shown ones. */
export type LabelMode = 'all' | 'default';

/**
 * What `--collection` names. Text ending in `.canvas` is a file. Any other text is an ID, looked
 * up as a recipe ID first, then as a shipped collection's ID.
 */
export type CollectionSelector =
  | { readonly kind: 'file'; readonly path: FilePath }
  | { readonly kind: 'id'; readonly id: RecipeOrCollectionId };

/**
 * The theme to draw with, not the collection's own: `--theme` as typed, or the `--theme-file`'s
 * `@id`, which Templates has already checked as a preset ID.
 */
export type ThemeChoice = ThemeId | PresetId;

/** What render:png's flags ask for, checked. */
export interface RenderChoice {
  readonly collection: CollectionSelector;
  /** `--theme`: wins over the `--theme-file`'s `@id`. */
  readonly theme?: ThemeId;
  /** `--theme-file`: a `.theme` file, added to the shipped themes for this render only. */
  readonly themeFile?: FilePath;
  /** `--out`: the folder the section files are written to. */
  readonly out: FilePath;
  readonly format: RenderFormat;
  readonly labels: LabelMode;
}

/** What one render needs: the flags' choice, and the repo folder the shipped files are found in. */
export interface RenderRequest extends RenderChoice {
  /** The repo folder. Every shipped theme, collection and wasm file is found below it. */
  readonly root: FilePath;
}

/** A theme the render knew (shipped, or from `--theme-file`), and Templates' hash of it. */
export interface ThemeDigest {
  readonly id: PresetId;
  readonly digest: PresetDigest;
}

/**
 * What a finished render prints as JSON: the files it wrote, the collection's theme, the service's
 * inspection report of the drawing, and a content hash for every theme the render knew.
 */
export interface RenderReport {
  readonly files: readonly FilePath[];
  readonly theme: Collection['theme'];
  readonly inspection: InspectionReport;
  readonly digests: readonly ThemeDigest[];
}
