/*
 * Why this file exists
 *
 * A render draws a collection into image files without a browser. To do that, core needs files,
 * fonts, Language, Model, the service's layout and Export, but core may not import any of them.
 * So compose builds them all and hands them to the render in one bundle.
 *
 * This file names that bundle (`RenderPorts`) and the part of it opened fresh for each render
 * (`RenderEnvironment`). It declares types only; `core/render/render.ts` decides what each
 * failure means.
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

/** Everything compose hands to one render. */
export interface RenderPorts {
  /**
   * Opens the render's environment, with its own throwaway font and image store. If it fails, with
   * `provider-failed` or another part's failure, nothing is left open.
   */
  open(): Promise<Result<RenderEnvironment, RenderEvidence>>;
  /** Finds the shipped themes and collections, and reads the render's source files. */
  readonly inputFiles: InputFiles;
  /** Starts the engine that makes PNG bytes. */
  readonly raster: RasterEngine;
  /** Makes the `--out` folder and writes the section images into it. */
  readonly sectionFiles: SectionFiles;
  /** Reads the fonts and images a source or theme file declares. */
  readonly resources: ResourceReader;
  /** Reads a `.theme` file's text into the theme and fonts it declares. */
  readonly themeGrammar: ThemeGrammar;
}

/**
 * The parts one render asks, over its own throwaway store. Each part's failure comes back whole:
 * Language, Model, Assets, Templates, the service or Export.
 */
export interface RenderEnvironment {
  /** Reads `.canvas` text with Language, and checks the collection with Model. */
  readonly sources: RenderSources;
  /** The throwaway font and image store: store bytes, and read them back. */
  readonly assets: RenderAssets;
  /** The themes and recipes the render knows, and how it adds a `--theme-file`. */
  readonly themes: RenderThemes;
  /** The service's layout, and Export's section images. */
  readonly output: RenderOutput;
  /** Closes the throwaway store and removes its folder. Call it once, at the end. */
  close(): Promise<Result<void, RenderEvidence>>;
}
