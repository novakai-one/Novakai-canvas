/*
 * Why this file exists
 *
 * A render reads files and writes files. `--collection states --out out/` looks through the
 * shipped collections for `states`, then writes one image per section into `out/`. PNG output
 * also needs its image engine started first.
 *
 * This file names those three jobs: the input files, the PNG engine, and the section files. Only
 * the `--out` folder is ever written. `adapters/render/` does the work.
 */
import type { ProviderFault } from '../records/render-fault.js';
import type { SourceFile } from '../records/source-file.js';
import type { ExportDiagnostic, RecipeFamily } from '../records/foreign.js';
import type { FilePath, SectionId } from '../brands.js';
import type { Result } from '../errors.js';

/**
 * The files a render reads, found below the repo folder. Each fails with `provider-failed`, with
 * Node's details of what went wrong.
 */
export interface InputFiles {
  /** Lists the shipped `.theme` files, directly under `resources/`, sorted by name. */
  shippedThemes(): Promise<Result<readonly FilePath[], ProviderFault>>;
  /** Reads every shipped `.canvas` file, anywhere under `resources/`, sorted by path. */
  shippedCollections(): Promise<Result<readonly SourceFile[], ProviderFault>>;
  /** Reads one file's text. A relative path is taken from the folder the command runs in. */
  read(path: FilePath): Promise<Result<SourceFile, ProviderFault>>;
  /**
   * Gives the path of a recipe family's shipped source, such as `er`'s. Reads nothing. Fails only
   * if the joined path were empty, which can't happen.
   */
  recipeFile(family: RecipeFamily): Result<FilePath, ProviderFault>;
}

/** The engine that turns a drawing into PNG bytes, loaded from the repo folder. */
export interface RasterEngine {
  /**
   * Prepares the engine: loads its WebAssembly file and starts it. Fails with `provider-failed`, or
   * with Export's own finding.
   */
  prepare(): Promise<Result<void, ProviderFault | ExportDiagnostic>>;
}

/**
 * The image files a render writes, one per section, into the `--out` folder. Each fails with
 * `provider-failed`, with Node's details of what went wrong.
 */
export interface SectionFiles {
  /** Makes the `--out` folder, and any folders above it that are missing. */
  makeOutFolder(): Promise<Result<void, ProviderFault>>;
  /** Writes one section's image bytes to its file, and gives back the file's path. */
  write(
    section: SectionId,
    bytes: Uint8Array,
  ): Promise<Result<FilePath, ProviderFault>>;
}
