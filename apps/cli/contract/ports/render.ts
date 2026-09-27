/*
 * What one headless render gets injected: an opener for the render's environment, the render's file
 * I/O and confined resource reads. Also the temporary asset store the environment is opened over.
 * Declarations only. Adapters in adapters/render/ implement TempAssetStore and RenderFiles; compose
 * binds them and the capability values. Every method returns its failure as a value;
 * core/render/render.ts decides what each one means.
 */
import type { Assets } from '@novakai/canvas-assets';
import type { Diagnostic as ExportDiagnostic } from '@novakai/canvas-export';
import type { ResourceReader } from './resource-reader.js';
import type { FontRole, ThemeAdmission } from '../records/theme-source.js';
import type { ProviderFault, RenderEvidence } from '../records/render-failure.js';
import type { SourceFile } from '../records/source-file.js';
import type {
  Catalog,
  Collection,
  ExportSnapshot,
  ParsedSource,
  RecipeFamily,
  RenderDocument,
  ResolvedResources,
  Resources,
  StageInput,
  StoredBlob,
} from '../records/foreign.js';
import type { AssetDigest, FilePath, SectionId } from '../brands.js';
import type { Result } from '../errors.js';

/** Everything compose injects into one headless render. */
export interface RenderPorts {
  /**
   * Make the render's temporary asset store and its capability environment. Fails with
   * `provider-failed`, Assets' failure or the service's installation failure; nothing is left open.
   */
  open(): Promise<Result<RenderEnvironment, RenderEvidence>>;
  readonly files: RenderFiles;
  readonly resources: ResourceReader;
}

/** A theme font as the theme admission binds it: its role and the Assets digest of its bytes. */
export interface FontBinding {
  readonly alias: FontRole;
  readonly digest: AssetDigest;
}

/** What Export draws one render's sections from. */
export interface ExportInput {
  readonly document: RenderDocument;
  readonly snapshot: ExportSnapshot;
  /** The pins Export's documents port lowers DSL against. */
  readonly pins: ResolvedResources;
  /** The inspector that admits only resources the snapshot retained. */
  readonly resources: Resources;
}

/** Export bound to one snapshot, format and label mode. */
export interface SectionExporter {
  /** One section's file bytes. Fails with Export's or Presentation's diagnostic. */
  export(section: SectionId): Promise<Result<Uint8Array, RenderEvidence>>;
}

/**
 * The capability rules of one render, over its temporary asset store. Each failure is the owner's
 * own evidence, returned whole: Language, Model, Assets, Templates, the service or Export.
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
  /**
   * The service's rendered document of `collection` over `catalog`. Fails with Library's, the
   * render job's or the producer's failure.
   */
  produce(
    collection: Collection,
    catalog: Catalog,
  ): Promise<Result<RenderDocument, RenderEvidence>>;
  /** Export over one snapshot. Fails with Presentation's font failure. */
  exporter(input: ExportInput): Promise<Result<SectionExporter, RenderEvidence>>;
  /** The bytes a base64 text holds. Assets and the service verified the text; cannot fail. */
  decodeBase64(text: string): Uint8Array;
  /** Close the asset store and remove its directory. Call once, last. */
  close(): Promise<Result<void, RenderEvidence>>;
}

/** One render's Assets store, opened in a fresh private temporary directory. */
export interface TempAssetStore {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  /**
   * Close the store, then remove the directory; both are always attempted. Fails with Assets'
   * close failure first, else `provider-failed` from the removal.
   */
  close(): Promise<Result<void, RenderEvidence>>;
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
