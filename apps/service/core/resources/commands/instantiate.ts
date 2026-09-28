/*
 * Why this file exists
 *
 * A recipe is a stored starter diagram. An agent types
 * `pnpm canvas recipe instantiate er@1.0.0#sha256:… --namespace demo` to get a copy of it as DSL
 * text. `er@1.0.0#sha256:…` is the recipe's pin: its name, version and digest. `demo` names the new
 * collection. The copy must use the recipe exactly as stored.
 *
 * This file finds the recipe, picks the themes and files it names, has Templates fill it in, and
 * has Language print it as DSL. Each step answers a `Result` (contract/errors.ts); the first
 * mistake stops it. It never saves anything: the caller creates the collection.
 */
import type {
  Catalog,
  Language,
  LanguageError,
  LoweredIntent,
  Preset,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capability-types.js';
import type {
  InstantiateInput,
  ResourceResult,
} from '../../../contract/records/presets/resource-commands.js';
import { instantiateInput } from '../../../contract/records/presets/resource-commands.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import { success } from '../../../contract/errors.js';
import { buildSelectionRequest, readStoredCatalog, templatesWithoutResources } from './catalog.js';
import { invalidInputFailure, resourceFailure } from './refusal.js';

/** What turning a recipe into DSL needs. */
export interface InstantiateDependencies {
  /** Picks the themes and files the recipe uses (selection/select.ts). */
  readonly selector: Pick<ResourceSelector, 'select'>;
  /** Language's printer, which turns the filled-in collection into DSL text. */
  readonly language: Pick<Language, 'print'>;
  /** Makes a Templates that can use only the themes and files picked for this recipe. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'read' | 'instantiate'>;
}

/**
 * Turns one stored recipe into DSL text for a new collection. `input` is the request body as sent
 * (`{ pin, namespace }`); it is checked here. Fails with `invalid-input` at `resources` for a
 * malformed body, at `preset.kind` when the pin names a theme, at `language` when the result can't
 * be printed, or with the mistake of Templates or the selector.
 */
export function instantiateRecipe(
  input: unknown,
  snapshot: Snapshot,
  dependencies: InstantiateDependencies,
): ResourceResult<string> {
  const found = findRecipe(input, snapshot, dependencies);
  if (!found.ok) {
    return found;
  }
  const expanded = expandRecipe(found.value, snapshot, dependencies);
  if (!expanded.ok) {
    return expanded;
  }
  return printRecipe(expanded.value, dependencies);
}

/** A stored recipe preset. */
type RecipePreset = Extract<Preset, { readonly kind: 'recipe' }>;

/** The collection a recipe expands to. */
type ExpandedCollection = LoweredIntent['collection'];

/** The checked request, the stored catalog it reads and the recipe it pins. */
interface FoundRecipe {
  readonly catalog: Catalog;
  readonly request: InstantiateInput;
  readonly recipe: RecipePreset;
}

/** Reads the stored catalog, checks the request body, then finds the recipe it pins. */
function findRecipe(
  body: unknown,
  snapshot: Snapshot,
  dependencies: InstantiateDependencies,
): ResourceResult<FoundRecipe> {
  const catalog = readStoredCatalog(snapshot, dependencies);
  if (!catalog.ok) {
    return catalog;
  }
  const request = instantiateInput.safeParse(body);
  if (!request.success) {
    return invalidInputFailure();
  }
  return findPinnedRecipe(catalog.value, request.data, dependencies);
}

/** Finds the recipe the request pins in the stored catalog, and keeps it with the request. */
function findPinnedRecipe(
  catalog: Catalog,
  request: InstantiateInput,
  dependencies: InstantiateDependencies,
): ResourceResult<FoundRecipe> {
  const recipe = readPinnedRecipe(catalog, request.pin, dependencies);
  if (!recipe.ok) {
    return recipe;
  }
  return success({ catalog, request, recipe: recipe.value });
}

/**
 * Reads the recipe the pin names. `pin` is the pin as sent; Templates checks it while reading.
 * Refuses a pin that names a theme.
 */
function readPinnedRecipe(
  catalog: Catalog,
  pin: unknown,
  dependencies: InstantiateDependencies,
): ResourceResult<RecipePreset> {
  const templates = templatesWithoutResources(dependencies);
  const preset = templates.read(catalog, pin);
  if (!preset.ok) {
    return preset;
  }
  if (preset.value.kind !== 'recipe') {
    return notARecipeFailure();
  }
  return success(preset.value);
}

/** Picks the themes and files the recipe uses, then has Templates fill the recipe in with them. */
function expandRecipe(
  found: FoundRecipe,
  snapshot: Snapshot,
  dependencies: InstantiateDependencies,
): ResourceResult<ExpandedCollection> {
  const resources = selectRecipeResources(found.recipe, snapshot, dependencies);
  if (!resources.ok) {
    return resources;
  }
  const templates = dependencies.templates(resources.value);
  const expansion = templates.instantiate(found.catalog, found.request);
  if (!expansion.ok) {
    return expansion;
  }
  const collection = expansion.value.intent.collection;
  return success(collection);
}

/** Asks the selector which themes and files the recipe's source uses. */
function selectRecipeResources(
  recipe: RecipePreset,
  snapshot: Snapshot,
  dependencies: InstantiateDependencies,
): ResourceResult<ResolvedResources> {
  const admission = { kind: 'recipe', source: recipe.payload.source };
  const selection = buildSelectionRequest({ admission, assets: [] }, snapshot);
  if (!selection.ok) {
    return selection;
  }
  const selected = dependencies.selector.select(selection.value, snapshot);
  if (!selected.ok) {
    return selected;
  }
  return success(selected.value.resources);
}

/** Has Language print the whole filled-in collection as DSL text. */
function printRecipe(
  collection: ExpandedCollection,
  dependencies: InstantiateDependencies,
): ResourceResult<string> {
  const printed = dependencies.language.print({ collection, scope: { kind: 'all' } });
  if (!printed.ok) {
    return unprintableRecipeFailure(printed.error);
  }
  return success(printed.value.source);
}

/** Makes the mistake for a pin that names a theme: `invalid-input` at `preset.kind`. */
function notARecipeFailure(): ResourceResult<never> {
  return resourceFailure({
    code: 'invalid-input',
    path: 'preset.kind',
    message: 'Only recipes can be instantiated',
    recovery: 'Select an immutable recipe pin and prepare again.',
  });
}

/**
 * Makes the mistake for a recipe Language could not print: `invalid-input` at `language`, with all
 * of Language's diagnostics kept as `source`.
 */
function unprintableRecipeFailure(source: LanguageError): ResourceResult<never> {
  return resourceFailure({
    code: 'invalid-input',
    path: 'language',
    message: 'Language could not print the prepared recipe',
    recovery: 'Correct the named source diagnostics and prepare again.',
    source,
  });
}
