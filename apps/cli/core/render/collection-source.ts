/*
 * Why this file exists
 *
 * `--collection` names either a file or an ID. `--collection my.canvas` means that file.
 * `--collection states` means the recipe with that ID or, if there is none, the one `.canvas`
 * file under the repo's `resources/` folder whose text declares `collection @states`.
 *
 * This file finds that source text. An ID is matched against what each file declares, never
 * against its file name. Each step gives back a `Result` (see `contract/errors.ts`). It only reads.
 */
import type { InputFiles } from '../../contract/ports/render-files.js';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type { Catalog } from '../../contract/records/foreign.js';
import type { CollectionSelector } from '../../contract/records/render.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { RenderFault } from '../../contract/records/render-fault.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import { presetId, type RecipeOrCollectionId, type PresetId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { renderFaultFailure, success } from '../../contract/errors.js';

/** What finding a source needs: the render's file reads and Language's parser. */
export interface SourceDependencies {
  readonly inputFiles: Pick<InputFiles, 'read' | 'recipeFile' | 'shippedCollections'>;
  readonly sources: Pick<RenderSources, 'parse'>;
}

/** A recipe in the admitted catalog. */
type RecipePreset = Extract<Catalog[number], { readonly kind: 'recipe' }>;

/**
 * Finds the source text `selector` names, and the path of its file. Fonts and images the text
 * names are found relative to that path. An ID is looked up as a recipe in `catalog` first.
 * Mistakes: a file that can't be read (`provider-failed`), or an ID that is no recipe and matches
 * no `.canvas` file, or more than one (`collection-selection`).
 */
export function findCollectionSource(
  selector: CollectionSelector,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderFailureSource>> {
  if (selector.kind === 'file') {
    return dependencies.inputFiles.read(selector.path);
  }
  return findNamedSource(selector.id, catalog, dependencies);
}

/** Finds the source an ID names: the recipe with that ID, or else the one shipped collection. */
async function findNamedSource(
  name: RecipeOrCollectionId,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderFailureSource>> {
  const recipe = findRecipe(catalog, name);
  if (recipe === undefined) {
    return findShippedSource(name, dependencies);
  }
  return recipeSource(recipe, dependencies.inputFiles);
}

/**
 * Gives back a recipe's source text, with the path of its family's shipped file, so its fonts and
 * images are found next to that file.
 */
function recipeSource(
  recipe: RecipePreset,
  inputFiles: SourceDependencies['inputFiles'],
): Result<SourceFile, RenderFailureSource> {
  const familyFile = inputFiles.recipeFile(recipe.payload.family);
  if (!familyFile.ok) {
    return familyFile;
  }
  return success({ source: recipe.payload.source, path: familyFile.value });
}

/** Finds the one shipped `.canvas` file whose text declares the collection ID `name`. */
async function findShippedSource(
  name: RecipeOrCollectionId,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderFailureSource>> {
  const shipped = await dependencies.inputFiles.shippedCollections();
  if (!shipped.ok) {
    return shipped;
  }
  const parse = dependencies.sources.parse;
  const matches = shipped.value.filter((source) => declaresId(source, name, parse));
  return requireOneMatch(name, matches);
}

/** Gives back the only match; no match, or more than one, is a mistake. */
function requireOneMatch(
  name: RecipeOrCollectionId,
  matches: readonly SourceFile[],
): Result<SourceFile, RenderFault> {
  const [match] = matches;
  if (match === undefined || matches.length > 1) {
    return collectionSelectionFailure(name, matches.length);
  }
  return success(match);
}

/**
 * Finds the recipe in `catalog` whose preset ID is `name`. There is none when `name` can't be a
 * preset ID at all.
 */
function findRecipe(
  catalog: Catalog,
  name: RecipeOrCollectionId,
): RecipePreset | undefined {
  const id = presetId.safeParse(name);
  if (!id.success) {
    return undefined;
  }
  return catalog.find((preset) => isRecipeWithId(preset, id.data));
}

/** Whether a preset is the recipe with preset ID `id`. */
function isRecipeWithId(
  preset: Catalog[number],
  id: PresetId,
): preset is RecipePreset {
  return preset.kind === 'recipe' && preset.id === id;
}

/** Whether Language can parse `source`, and the collection ID it declares is `name`. */
function declaresId(
  source: SourceFile,
  name: RecipeOrCollectionId,
  parse: RenderSources['parse'],
): boolean {
  const parsed = parse(source.source);
  return parsed.ok && parsed.value.collection === name;
}

/**
 * Makes the mistake for an ID that matches no shipped collection, or more than one
 * (`collection-selection`). It says how many matched.
 */
function collectionSelectionFailure(
  name: RecipeOrCollectionId,
  matchCount: number,
): Result<never, RenderFault> {
  return renderFaultFailure({ code: 'collection-selection', id: name, matches: matchCount });
}
