/*
 * render:png's request and report: which collection to render, with which theme, into which
 * files, and the JSON a finished render prints. Pure declarations plus `renderRequest`, the option
 * check cli/render.ts runs until core/render/request.ts owns it. The caller corrects the named
 * option and runs render:png again.
 */
import { z } from 'zod';
import {
  collectionName,
  filePath,
  themeName,
  type CollectionName,
  type FilePath,
  type PresetDigest,
  type PresetId,
  type ThemeName,
} from '../brands.js';
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
  /** The directory the section files are written to. */
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

/**
 * render:png's option values → RenderRequest. `parse` throws a ZodError naming the first
 * malformed option (an empty --theme or --theme-file); cli/render.ts prints it and exits 1.
 */
export const renderRequest = z
  .strictObject({
    collection: collectionName,
    theme: themeName.optional(),
    themeFile: filePath.optional(),
    out: filePath,
    format: z.enum(['svg', 'png']),
    labels: z.boolean().optional(),
    root: filePath,
  })
  .transform((options): RenderRequest => ({
    collection: selector(options.collection),
    ...themeEntry(options.theme),
    ...themeFileEntry(options.themeFile),
    out: options.out,
    format: options.format,
    labels: labelMode(options.labels),
    root: options.root,
  }));

/** `.canvas` text is a file path; both brands take the same non-empty text, so the mint holds. */
function selector(text: CollectionName): CollectionSelector {
  if (!text.endsWith('.canvas')) return { kind: 'named', name: text };
  return { kind: 'file', path: filePath.parse(text) };
}

/** `{ theme }` when --theme was given; `{}` otherwise, so the key stays absent. */
function themeEntry(theme: ThemeName | undefined): Pick<RenderRequest, 'theme'> {
  if (theme === undefined) return {};
  return { theme };
}

/** `{ themeFile }` when --theme-file was given; `{}` otherwise, so the key stays absent. */
function themeFileEntry(themeFile: FilePath | undefined): Pick<RenderRequest, 'themeFile'> {
  if (themeFile === undefined) return {};
  return { themeFile };
}

/** `--labels` draws hidden wire labels too; without it only the shown ones are drawn. */
function labelMode(labels: boolean | undefined): LabelMode {
  if (labels === true) return 'all';
  return 'default';
}
