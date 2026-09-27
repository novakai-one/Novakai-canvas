/*
 * What one headless render gets injected: the service bindings, confined resource reads, a
 * temporary asset store, the render's file I/O, and the capability rules the render calls once its
 * environment is open. Declarations only. The adapters in adapters/render/ implement TempAssets and
 * RenderFiles; compose binds them. Every method returns its failure as a value; the headless render
 * decides what each one means.
 */
import type { AssetError, Assets } from '@novakai/canvas-assets';
import type { Diagnostic as ExportDiagnostic } from '@novakai/canvas-export';
import type { ResourceReader } from './resource-reader.js';
import type { FontRole, ThemeAdmission } from '../records/theme-source.js';
import type { ProviderFault, RenderEvidence } from '../records/render-failure.js';
import type { SourceFile } from '../records/source-file.js';
import type {
  Catalog,
  Collection,
  HeadlessBindings,
  ParsedSource,
  RecipeFamily,
  ResolvedResources,
  StageInput,
  StoredBlob,
} from '../records/foreign.js';
import type { AssetDigest, FilePath, SectionId } from '../brands.js';
import type { Result } from '../errors.js';

/** Everything compose injects into one headless render. */
export interface HeadlessOwners {
  readonly resources: ResourceReader;
  /** Theme preparation, preset codecs, render jobs and the diagram producer. */
  readonly service: HeadlessBindings;
  readonly temp: TempAssets;
  readonly files: RenderFiles;
}

/** A theme font as the theme admission binds it: its role and the Assets digest of its bytes. */
export interface FontBinding {
  readonly alias: FontRole;
  readonly digest: AssetDigest;
}

/**
 * The capability rules of one render, bound over its temporary asset store. Each failure is the
 * owner's own evidence, returned whole: Language, Model, Assets, Templates or the service.
 */
export interface RenderEnvironment {
  /** The installation's shipped presets, before any `.theme` file is admitted. */
  readonly catalog: Catalog;
  /** Language's parse of one source. Fails with Language's diagnostics. */
  parse(source: string): Result<ParsedSource, RenderEvidence>;
  /** Lower `source` as a new collection against `resources`. Fails with Language's diagnostics. */
  lower(
    source: string,
    resources: ResolvedResources,
  ): Result<Collection, RenderEvidence>;
  /** Model's check of a whole collection. Fails with Model's diagnostics. */
  validate(value: unknown): Result<Collection, RenderEvidence>;
  /** Normalize and store one file's bytes; returns their digest. Fails with Assets' failure. */
  stageAsset(input: StageInput): Promise<Result<AssetDigest, RenderEvidence>>;
  /** The stored, verified bytes of one digest. Fails with Assets' failure. */
  resolveAsset(digest: AssetDigest): Result<StoredBlob, RenderEvidence>;
  /**
   * `catalog` with `theme` admitted over its staged `fonts`. Fails with the service's theme
   * preparation or Templates' admission failure.
   */
  admitTheme(
    catalog: Catalog,
    theme: ThemeAdmission,
    fonts: readonly FontBinding[],
  ): Result<Catalog, RenderEvidence>;
  /** The bytes a base64 text holds. Assets and the service verified the text; cannot fail. */
  decodeBase64(text: string): Uint8Array;
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
