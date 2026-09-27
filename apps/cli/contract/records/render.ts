/*
 * render:png's request and report: which collection to render, with which theme, into which
 * files, and the JSON a finished render prints. Pure declarations. `core/render/request.ts` mints
 * the request from argv; the caller corrects the named flag and runs render:png again.
 */
import type { CollectionName, FilePath, PresetDigest, PresetId, ThemeName } from '../brands.js';
import type { Collection, InspectionReport } from './foreign.js';

/** The file format every section is written in. */
export type RenderFormat = 'svg' | 'png';

/** `all` (`--labels`): wire labels the diagram hides are drawn too. `default`: only the shown ones. */
export type LabelMode = 'all' | 'default';

/**
 * What `--collection` names. Text ending in `.canvas` is a file. Any other text is a name: a
 * recipe ID first, then a shipped collection ID.
 */
export type CollectionSelector =
  | { readonly kind: 'file'; readonly path: FilePath }
  | { readonly kind: 'named'; readonly name: CollectionName };

/** One read-only render. No stored collection is changed. */
export interface RenderRequest {
  readonly collection: CollectionSelector;
  /** --theme: wins over the --theme-file's `@id`. */
  readonly theme?: ThemeName;
  /** --theme-file: admitted after the shipped themes. */
  readonly themeFile?: FilePath;
  /** The directory the section files are written to, as given; the render's file adapter resolves it. */
  readonly out: FilePath;
  readonly format: RenderFormat;
  readonly labels: LabelMode;
  /** The repo root. Every shipped file the render reads is found below it. */
  readonly root: FilePath;
}

/** An admitted theme and its content digest. */
export interface ThemeDigest {
  readonly id: PresetId;
  readonly digest: PresetDigest;
}

/** What a finished render prints: written files, the collection's theme, scene counts, theme digests. */
export interface RenderReport {
  readonly files: readonly FilePath[];
  readonly theme: Collection['theme'];
  readonly inspection: InspectionReport;
  readonly digests: readonly ThemeDigest[];
}
