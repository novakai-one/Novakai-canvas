/*
 * What one headless render gets injected: an opener for the render's environment, the render's
 * three file ports, confined resource reads and Templates' theme grammar. The environment is four
 * capability ports plus `close`. Declarations only. Adapters in adapters/render/ implement the
 * ports; compose builds the adapters and the capability values and injects them. Every method
 * returns its failure as a value; core/render/render.ts decides what each one means.
 */
import type { ResourceReader } from './resource-reader.js';
import type { RenderAssets } from './render-assets.js';
import type { InputFiles, RasterEngine, SectionFiles } from './render-files.js';
import type { RenderOutput } from './render-output.js';
import type { RenderSources } from './render-sources.js';
import type { RenderThemes } from './render-themes.js';
import type { ThemeGrammar } from './theme-grammar.js';
import type { RenderEvidence } from '../records/render-failure.js';
import type { Result } from '../errors.js';

/** Everything compose injects into one headless render. */
export interface RenderPorts {
  /**
   * Make the render's temporary asset store and its capability environment. Fails with
   * `provider-failed`, Assets' failure or the service's installation failure; nothing is left open.
   */
  open(): Promise<Result<RenderEnvironment, RenderEvidence>>;
  /** Finds shipped themes and collections and reads the render's source files. */
  readonly inputFiles: InputFiles;
  /** Starts the PNG raster engine. */
  readonly raster: RasterEngine;
  /** Makes the output directory and writes section files into it. */
  readonly sectionFiles: SectionFiles;
  /** Reads the fonts and images a source or theme file declares. */
  readonly resources: ResourceReader;
  /** Reads a `.theme` file's text as its theme admission and fonts. */
  readonly themeGrammar: ThemeGrammar;
}

/**
 * The capability rules of one render, over its temporary asset store. Each failure is the owner's
 * own evidence, returned whole: Language, Model, Assets, Templates, the service or Export.
 */
export interface RenderEnvironment {
  /** Language's parse and lowering, and Model's check. */
  readonly sources: RenderSources;
  /** The temporary asset store: stage bytes, read them back, decode base64. */
  readonly assets: RenderAssets;
  /** The installation's catalog and theme admission. */
  readonly themes: RenderThemes;
  /** The service's drawing and Export's section bytes. */
  readonly output: RenderOutput;
  /** Close the asset store and remove its directory. Call once, last. */
  close(): Promise<Result<void, RenderEvidence>>;
}
