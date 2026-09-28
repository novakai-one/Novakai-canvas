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

/** The parts finding a source uses: the render's file reads and Language's parser. */
export interface SourceDependencies {
  readonly inputFiles: Pick<InputFiles, 'read' | 'recipeFile' | 'shippedCollections'>;
  readonly sources: Pick<RenderSources, 'parse'>;
}

/** A recipe in the admitted catalog. */
type RecipePreset = Extract<Catalog[number], { readonly kind: 'recipe' }>;

/**
 * Finds the source text `selector` names, with the file its fonts and images are read relative to.
 * An ID is looked up as a recipe in `catalog` first.
 * Mistakes: a file that can't be read (`provider-failed`), or an ID that is no recipe and matches
 * no `.canvas` file, or more than one (`collection-selection`).
 */
export function findCollectionSource(
  selector: CollectionSelector,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderFailureSource>> {
  if (selector.kind === 'file') return dependencies.inputFiles.read(selector.path);
  return namedSource(selector.id, catalog, dependencies);
}

/**
 * A recipe's shipped source when `name` is a recipe ID; otherwise the shipped collection it names.
 * Fails as {@link recipeSource} or {@link shippedSource} does.
 */
function namedSource(
  name: RecipeOrCollectionId,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderFailureSource>> {
  const recipe = recipeNamed(catalog, name);
  if (recipe === undefined) return shippedSource(name, dependencies);
  return Promise.resolve(recipeSource(recipe, dependencies.inputFiles));
}

/**
 * The recipe's source, with its family's shipped file for its resources to resolve against. Fails
 * with `provider-failed` when that file's path fails its check.
 */
function recipeSource(
  recipe: RecipePreset,
  inputFiles: SourceDependencies['inputFiles'],
): Result<SourceFile, RenderFailureSource> {
  const file = inputFiles.recipeFile(recipe.payload.family);
  if (!file.ok) return file;
  return success({ source: recipe.payload.source, path: file.value });
}

/**
 * The one shipped collection whose parsed ID is `name`. Fails with `provider-failed` when the
 * shipped files cannot be read, or `collection-selection` unless exactly one matches.
 */
async function shippedSource(
  name: RecipeOrCollectionId,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderFailureSource>> {
  const sources = await dependencies.inputFiles.shippedCollections();
  if (!sources.ok) return sources;
  const parse = dependencies.sources.parse;
  return onlyMatch(
    name,
    sources.value.filter((source) => declares(source, name, parse)),
  );
}

/** The single match. Fails with `collection-selection`, counting the matches, unless there is one. */
function onlyMatch(
  name: RecipeOrCollectionId,
  matches: readonly SourceFile[],
): Result<SourceFile, RenderFault> {
  const [match] = matches;
  if (matches.length !== 1 || match === undefined)
    return renderFaultFailure({ code: 'collection-selection', id: name, matches: matches.length });
  return success(match);
}

/**
 * The recipe whose preset ID is `name`. None when `name` is not a Templates preset ID, since no
 * preset can have it, or when no recipe has it.
 */
function recipeNamed(
  catalog: Catalog,
  name: RecipeOrCollectionId,
): RecipePreset | undefined {
  const id = presetId.safeParse(name);
  if (!id.success) return undefined;
  return catalog.find((preset) => isRecipeWithId(preset, id.data));
}

/** Whether a preset is the recipe with preset ID `id`. */
function isRecipeWithId(
  preset: Catalog[number],
  id: PresetId,
): preset is RecipePreset {
  return preset.kind === 'recipe' && preset.id === id;
}

/** Whether Language parses `source` and its collection ID is `name`. */
function declares(
  source: SourceFile,
  name: RecipeOrCollectionId,
  parse: RenderSources['parse'],
): boolean {
  const parsed = parse(source.source);
  return parsed.ok && parsed.value.collection === name;
}
