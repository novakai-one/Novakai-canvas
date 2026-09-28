/*
 * Why this file exists
 *
 * render:png draws a collection into image files, one per section. The agent says what to draw
 * and where: `pnpm render:png --collection states --out out/ --format svg`.
 *
 * This file names what those flags ask for once checked, and the JSON a finished render prints:
 * the files it wrote and the theme it used. It declares types only; `core/render/request.ts`
 * checks the flags. A render never changes a saved collection.
 */
import type { CollectionName, FilePath, PresetDigest, PresetId, ThemeName } from '../brands.js';
import type { Collection, InspectionReport } from './foreign.js';

/** The image format every section file is written in. */
export type RenderFormat = 'svg' | 'png';

/** `all` (`--labels` typed): hidden wire labels are drawn too. `default`: only the shown ones. */
export type LabelMode = 'all' | 'default';

/**
 * What `--collection` names. Text ending in `.canvas` is a file. Any other text is a name, looked
 * up as a recipe ID first, then as a shipped collection's ID.
 */
export type CollectionSelector =
  | { readonly kind: 'file'; readonly path: FilePath }
  | { readonly kind: 'named'; readonly name: CollectionName };

/** The theme to draw with, not the collection's own: `--theme`, or the `--theme-file`'s `@id`. */
export type ThemeChoice = ThemeName | PresetId;

/** What render:png's flags ask for, checked. */
export interface RenderChoice {
  readonly collection: CollectionSelector;
  /** `--theme`: wins over the `--theme-file`'s `@id`. */
  readonly theme?: ThemeName;
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

/** A theme the render knew (shipped, or from `--theme-file`), and a hash of its content. */
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
