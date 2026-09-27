/*
 * Which source render:png draws. A `.canvas` file is read as given. A name selects a recipe ID in
 * the admitted catalog first, then the one shipped collection whose parsed ID it is; file names are
 * never trusted. Pure apart from the injected render files and parser. The caller names another
 * collection and runs render:png again.
 */
import type { RenderEnvironment, RenderFiles } from '../../contract/ports/render.js';
import type { Catalog } from '../../contract/records/foreign.js';
import type { CollectionSelector } from '../../contract/records/render.js';
import type { RenderEvidence, RenderFault } from '../../contract/records/render-failure.js';
import { faulted } from '../../contract/records/render-failure.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { CollectionName } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';

/** What choosing a source uses: the render's file reads and Language's parse. */
export interface SourceDependencies {
  readonly files: Pick<RenderFiles, 'read' | 'recipeFile' | 'shippedCollections'>;
  readonly env: Pick<RenderEnvironment, 'parse'>;
}

/** A recipe in the admitted catalog. */
type RecipePreset = Extract<Catalog[number], { readonly kind: 'recipe' }>;

/**
 * The source `selector` names, with the file its resources resolve against. Fails with
 * `provider-failed` when a file cannot be read, or `collection-selection` when a name is no recipe
 * and not exactly one shipped collection.
 */
export function collectionSource(
  selector: CollectionSelector,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderEvidence>> {
  if (selector.kind === 'file') return dependencies.files.read(selector.path);
  return namedSource(selector.name, catalog, dependencies);
}

/**
 * A recipe's shipped source when `name` is a recipe ID; otherwise the shipped collection it names.
 * Fails as {@link shippedSource} does.
 */
function namedSource(
  name: CollectionName,
  catalog: Catalog,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderEvidence>> {
  const recipe = catalog.find((preset) => isRecipeNamed(preset, name));
  if (recipe === undefined) return shippedSource(name, dependencies);
  return Promise.resolve(
    success({
      source: recipe.payload.source,
      file: dependencies.files.recipeFile(recipe.payload.family),
    }),
  );
}

/**
 * The one shipped collection whose parsed ID is `name`. Fails with `provider-failed` when the
 * shipped files cannot be read, or `collection-selection` unless exactly one matches.
 */
async function shippedSource(
  name: CollectionName,
  dependencies: SourceDependencies,
): Promise<Result<SourceFile, RenderEvidence>> {
  const sources = await dependencies.files.shippedCollections();
  if (!sources.ok) return sources;
  const parse = dependencies.env.parse;
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
    return faulted({ code: 'collection-selection', id: name, matches: matches.length });
  return success(match);
}

/** Whether a preset is the recipe named `name`. */
function isRecipeNamed(
  preset: Catalog[number],
  name: CollectionName,
): preset is RecipePreset {
  return preset.kind === 'recipe' && preset.id === String(name);
}

/** Whether Language parses `source` and its collection ID is `name`. */
function declares(
  source: SourceFile,
  name: CollectionName,
  parse: RenderEnvironment['parse'],
): boolean {
  const parsed = parse(source.source);
  return parsed.ok && parsed.value.collection === name;
}
