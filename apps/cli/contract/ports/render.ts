/*
 * What one headless render gets injected: the service bindings, confined resource reads, the
 * theme grammar, a temporary asset store and the render's file I/O. Declarations only. The
 * adapters in adapters/render/ implement TempAssets and RenderFiles; compose binds them. Every
 * method returns its failure as a value; the headless render decides what each one means.
 */
import type { AssetError, Assets } from '@novakai/canvas-assets';
import type { Diagnostic as ExportDiagnostic } from '@novakai/canvas-export';
import type { ResourceReader } from './resource-reader.js';
import type { ThemeSource } from '../records/theme-source.js';
import type { ProviderFault } from '../records/render-failure.js';
import type { SourceFile } from '../records/source-file.js';
import type { HeadlessBindings, RecipeFamily } from '../records/foreign.js';
import type { FilePath, SectionId } from '../brands.js';
import type { Result } from '../errors.js';

/** Everything compose injects into one headless render. */
export interface HeadlessOwners {
  readonly resources: ResourceReader;
  /** Theme preparation, preset codecs, render jobs and the diagram producer. */
  readonly service: HeadlessBindings;
  /** The theme grammar. Fails with `invalid-theme` or `duplicate-token`. */
  readTheme(source: string): Result<ThemeSource>;
  readonly temp: TempAssets;
  readonly files: RenderFiles;
}

/** Creates the private temporary directory one render stages its assets in. */
export interface TempAssets {
  /** Create a fresh directory under the OS temp root. Fails with `provider-failed`. */
  create(): Promise<Result<TempDirectory, ProviderFault>>;
}

/** One created temporary directory. The render opens its asset store, then removes it once. */
export interface TempDirectory {
  /** Open the Assets store inside this directory. Assets' own failure is returned whole. */
  openAssets(): Result<Assets, AssetError>;
  /**
   * Remove this directory and all it holds; a missing one is not a failure.
   * Fails with `provider-failed`.
   */
  remove(): Promise<Result<void, ProviderFault>>;
}

/**
 * File I/O of one render, bound to its repo root, output directory and format. Every method
 * except `recipeFile` fails with `provider-failed` (the OS path, code and syscall).
 */
export interface RenderFiles {
  /** The `.theme` files directly under `resources/`, sorted by name. */
  shippedThemes(): Promise<Result<readonly FilePath[], ProviderFault>>;
  /** Every `.canvas` file anywhere under `resources/`, sorted by path, with its text. */
  shippedCollections(): Promise<Result<readonly SourceFile[], ProviderFault>>;
  /** One file's UTF-8 text; a relative path resolves against the working directory. */
  read(path: FilePath): Promise<Result<SourceFile, ProviderFault>>;
  /** Where the shipped source of a recipe family lives. Reads nothing and cannot fail. */
  recipeFile(family: RecipeFamily): FilePath;
  /** Start the PNG raster engine. Can also fail with Export's own diagnostic. */
  prepareRaster(): Promise<Result<void, ProviderFault | ExportDiagnostic>>;
  /** Create the output directory, parents included. */
  prepareOutput(): Promise<Result<void, ProviderFault>>;
  /** Write one section's bytes to its file in the output directory; returns the path. */
  writeSection(
    section: SectionId,
    bytes: Uint8Array,
  ): Promise<Result<FilePath, ProviderFault>>;
}
