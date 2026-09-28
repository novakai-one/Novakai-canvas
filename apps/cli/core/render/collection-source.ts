/*
 * Which source render:png draws. A `.canvas` file is read as given. A name selects a recipe ID in
 * the admitted catalog first, then the one shipped collection whose parsed ID it is; file names are
 * never trusted. Pure apart from the injected render files and parser. The caller names another
 * collection and runs render:png again.
 */
import type { InputFiles } from '../../contract/ports/render-files.js';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type { Catalog } from '../../contract/records/foreign.js';
import type { CollectionSelector } from '../../contract/records/render.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { RenderFault } from '../../contract/records/render-fault.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import { presetId, type CollectionName, type PresetId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { renderFaultFailure, success } from '../../contract/errors.js';

/** What choosing a source uses: the render's file reads and Language's parse. */
export interface SourceDependencies {
  readonly inputFiles: Pick<InputFiles, 'read' | 'recipeFile' | 'shippedCollections'>;
  readonly sources: Pick<RenderSources, 'parse'>;
}

/** A recipe in the admitted catalog. */
type RecipePreset = Extract<Catalog[number], { readonly kind: 'recipe' }>;

/**
 * The source `selector` names, with the file its resources resolve against. Fails with
 * `provider-failed` when a file cannot be read or its path fails its check, or
 * `collection-selection` when a name is no recipe and not exactly one shipped collection.
 */
export function collectionSource(
  selector: CollectionSelector,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderEvidence>> {
  if (selector.kind === 'file') return dependencies.inputFiles.read(selector.path);
  return namedSource(selector.name, catalog, dependencies);
}

/**
 * A recipe's shipped source when `name` is a recipe ID; otherwise the shipped collection it names.
 * Fails as {@link recipeSource} or {@link shippedSource} does.
 */
function namedSource(
  name: CollectionName,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderEvidence>> {
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
): Result<SourceFile, RenderEvidence> {
  const file = inputFiles.recipeFile(recipe.payload.family);
  if (!file.ok) return file;
  return success({ source: recipe.payload.source, file: file.value });
}

/**
 * The one shipped collection whose parsed ID is `name`. Fails with `provider-failed` when the
 * shipped files cannot be read, or `collection-selection` unless exactly one matches.
 */
async function shippedSource(
  name: CollectionName,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderEvidence>> {
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
  name: CollectionName,
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
  name: CollectionName,
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
  name: CollectionName,
  parse: RenderSources['parse'],
): boolean {
  const parsed = parse(source.source);
  return parsed.ok && parsed.value.collection === name;
}
