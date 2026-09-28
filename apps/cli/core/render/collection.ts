/*
 * Why this file exists
 *
 * `--collection states --theme atlas` asks to draw the `states` collection with the `atlas`
 * theme in place of its own. The source text can't be drawn as it is. It needs the theme written
 * in and its fonts and images stored, then Language and Model turn it into a checked collection.
 *
 * This file does those steps, in that order, on a fresh copy of the text. Each step gives back a
 * `Result` (see `contract/errors.ts`). It never changes a saved collection or a source file.
 */
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type { Collection, ResolvedResources } from '../../contract/records/foreign.js';
import type { CollectionSelector, ThemeChoice } from '../../contract/records/render.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { Result } from '../../contract/errors.js';
import { renderFaultFailure, success } from '../../contract/errors.js';
import { findCollectionSource, type SourceDependencies } from './collection-source.js';
import { pinResources } from './pins.js';
import { admitSourceAssets, type AssetDependencies } from './source-assets.js';
import { setSourceTheme } from './source-theme.js';
import type { AdmittedThemes } from './themes.js';

/**
 * The parts loading a collection uses: file reads, the render's temporary store, and `sources`
 * (Language's parser, Language turning text into a collection, and Model's check).
 */
export interface CollectionDependencies extends SourceDependencies, AssetDependencies {
  readonly sources: RenderSources;
}

/**
 * Loads the collection `selector` names as a checked collection, and draws it with
 * `themes.choice` in place of its own theme, when a theme was asked for.
 * Mistakes: the source can't be found or read, the theme can't be written in or isn't known
 * (`missing-theme`), a font or image can't be stored, or Language or Model find a problem.
 */
export async function loadCollection(
  selector: CollectionSelector,
  themes: AdmittedThemes,
  dependencies: CollectionDependencies,
): Promise<Result<Collection, RenderFailureSource>> {
  const original = await findCollectionSource(selector, themes.catalog, dependencies);
  if (!original.ok) return original;
  const source = themedSource(original.value, themes.choice, dependencies.sources.parse);
  if (!source.ok) return source;
  return lowered(source.value, themes, dependencies);
}

/** The source as it is without a choice; otherwise a copy naming the chosen theme. */
function themedSource(
  source: SourceFile,
  choice: ThemeChoice | undefined,
  parse: RenderSources['parse'],
): Result<SourceFile, RenderFailureSource> {
  if (choice === undefined) return success(source);
  return setSourceTheme(source, choice, parse);
}

/**
 * The source's asset records, then the source lowered against the catalog's theme pins and those
 * records (Language has Model check the collection, records included), then checked with the
 * chosen pin. Fails as each step does.
 */
async function lowered(
  source: SourceFile,
  themes: AdmittedThemes,
  dependencies: CollectionDependencies,
): Promise<Result<Collection, RenderFailureSource>> {
  const assets = await admitSourceAssets(source, dependencies);
  if (!assets.ok) return assets;
  const pins = pinResources(themes.catalog, assets.value);
  const collection = dependencies.sources.lower(source.source, pins);
  if (!collection.ok) return collection;
  return withChoice(collection.value, pins, themes.choice, dependencies.sources);
}

/**
 * Model's check of the lowered collection, with the chosen theme's pin in place of its own when
 * there is a choice. Fails with `missing-theme` or Model's diagnostics.
 */
function withChoice(
  collection: Collection,
  pins: ResolvedResources,
  choice: ThemeChoice | undefined,
  sources: Pick<RenderSources, 'validate'>,
): Result<Collection, RenderFailureSource> {
  if (choice === undefined) return sources.validate(collection);
  const pin = pins.themes[choice];
  if (pin === undefined) return renderFaultFailure({ code: 'missing-theme', theme: choice });
  return sources.validate({ ...collection, theme: pin });
}
