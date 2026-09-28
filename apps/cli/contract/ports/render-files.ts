/*
 * The file I/O of one render, as three ports: finding and reading input files, starting the PNG
 * raster engine, and writing section files. Declarations only; adapters/render/render-files.ts
 * implements the input and section files, adapters/render/raster.ts the raster engine. Only the
 * output directory is written. Every failure is returned as a value.
 */
import type { ProviderFault } from '../records/render-fault.js';
import type { SourceFile } from '../records/source-file.js';
import type { ExportDiagnostic, RecipeFamily } from '../records/foreign.js';
import type { FilePath, SectionId } from '../brands.js';
import type { Result } from '../errors.js';

/**
 * The render's input files, bound to its repo root. Every method fails with `provider-failed`
 * (the OS path, code and syscall).
 */
export interface InputFiles {
  /** The `.theme` files directly under `resources/`, sorted by name. */
  shippedThemes(): Promise<Result<readonly FilePath[], ProviderFault>>;
  /** Every `.canvas` file anywhere under `resources/`, sorted by path, with its text. */
  shippedCollections(): Promise<Result<readonly SourceFile[], ProviderFault>>;
  /** One file's UTF-8 text; a relative path resolves against the working directory. */
  read(path: FilePath): Promise<Result<SourceFile, ProviderFault>>;
  /** Where the shipped source of a recipe family lives. Reads nothing. */
  recipeFile(family: RecipeFamily): Result<FilePath, ProviderFault>;
}

/** The PNG raster engine, loaded from the repo root. */
export interface RasterEngine {
  /** Start the engine. Fails with `provider-failed`, or Export's own diagnostic. */
  prepare(): Promise<Result<void, ProviderFault | ExportDiagnostic>>;
}

/**
 * The render's section files, bound to its output directory and format. Every method fails with
 * `provider-failed` (the OS path, code and syscall).
 */
export interface SectionFiles {
  /** Create the output directory, parents included. */
  prepare(): Promise<Result<void, ProviderFault>>;
  /** Write one section's bytes to its file in the output directory; returns the path. */
  write(
    section: SectionId,
    bytes: Uint8Array,
  ): Promise<Result<FilePath, ProviderFault>>;
}
