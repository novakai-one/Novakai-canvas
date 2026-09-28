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
import type { RenderFault } from '../../contract/records/render-fault.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { Result } from '../../contract/errors.js';
import { renderFaultFailure, success } from '../../contract/errors.js';
import { findCollectionSource, type SourceDependencies } from './collection-source.js';
import { pinResources } from './pins.js';
import { admitSourceAssets, type AssetDependencies } from './source-assets.js';
import { setSourceTheme } from './source-theme.js';
import type { AdmittedThemes } from './themes.js';

/**
 * What loading a collection needs: file reads, the render's temporary store, and `sources`
 * (Language's parser, Language turning text into a collection, and Model's check).
 */
export interface CollectionDependencies extends SourceDependencies, AssetDependencies {
  readonly sources: RenderSources;
}

/**
 * Loads the collection `selector` names as a checked collection. When a theme was asked for,
 * `themes.choice` is first written in as its theme. It draws nothing; drawing comes later.
 * Mistakes: the source can't be found or read, the theme can't be written in or isn't known
 * (`missing-theme`), a font or image can't be stored, or Language or Model find a problem.
 */
export async function loadCollection(
  selector: CollectionSelector,
  themes: AdmittedThemes,
  dependencies: CollectionDependencies,
): Promise<Result<Collection, RenderFailureSource>> {
  const original = await findCollectionSource(selector, themes.catalog, dependencies);
  if (!original.ok) {
    return original;
  }
  const themed = applyThemeChoice(original.value, themes.choice, dependencies.sources.parse);
  if (!themed.ok) {
    return themed;
  }
  return makeCollection(themed.value, themes, dependencies);
}

/** Writes the chosen theme into a copy of the source. With no choice, the source stays as it is. */
function applyThemeChoice(
  source: SourceFile,
  choice: ThemeChoice | undefined,
  parse: RenderSources['parse'],
): Result<SourceFile, RenderFailureSource> {
  if (choice === undefined) {
    return success(source);
  }
  return setSourceTheme(source, choice, parse);
}

/**
 * Stores the source's fonts and images, has Language turn the text into a collection, then checks
 * it with the chosen theme.
 */
async function makeCollection(
  source: SourceFile,
  themes: AdmittedThemes,
  dependencies: CollectionDependencies,
): Promise<Result<Collection, RenderFailureSource>> {
  const assets = await admitSourceAssets(source, dependencies);
  if (!assets.ok) {
    return assets;
  }
  const pins = pinResources(themes.catalog, assets.value);
  const collection = dependencies.sources.lower(source.source, pins);
  if (!collection.ok) {
    return collection;
  }
  return checkWithChosenTheme(collection.value, pins, themes.choice, dependencies.sources);
}

/**
 * Has Model check the collection. When a theme was asked for, the chosen theme's pin takes the
 * place of the collection's own first.
 */
function checkWithChosenTheme(
  collection: Collection,
  pins: ResolvedResources,
  choice: ThemeChoice | undefined,
  sources: Pick<RenderSources, 'validate'>,
): Result<Collection, RenderFailureSource> {
  if (choice === undefined) {
    return sources.validate(collection);
  }
  const chosenPin = pins.themes[choice];
  if (chosenPin === undefined) {
    return missingThemeFailure(choice);
  }
  const withChosenTheme = { ...collection, theme: chosenPin };
  return sources.validate(withChosenTheme);
}

/** Makes the mistake for a theme the render doesn't know (`missing-theme`). */
function missingThemeFailure(theme: ThemeChoice): Result<never, RenderFault> {
  return renderFaultFailure({ code: 'missing-theme', theme });
}
