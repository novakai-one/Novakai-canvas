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
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/resource-commands.js';
import { instantiateInput } from '../../../contract/records/presets/resource-commands.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import { andThen, success } from '../../../contract/errors.js';
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
  if (!found.ok) return found;
  const expanded = expandRecipe(found.value, snapshot, dependencies);
  return andThen(expanded, (collection) => printedRecipe(collection, dependencies));
}

/** A stored recipe preset. */
type RecipePreset = Extract<Preset, { readonly kind: 'recipe' }>;

/** The collection a recipe expands to. */
type ExpandedCollection = LoweredIntent['collection'];

/** The decoded request, the stored catalog it reads and the recipe it pins. */
interface FoundRecipe {
  readonly catalog: Catalog;
  readonly request: InstantiateInput;
  readonly recipe: RecipePreset;
}

/**
 * Reads the stored catalog, decodes the request, then reads the recipe it pins. Fails with the
 * Templates diagnostic, `invalid-input` at `resources` for a malformed request, or as
 * `storedRecipe` fails.
 */
function findRecipe(
  raw: unknown,
  snapshot: Snapshot,
  dependencies: InstantiateDependencies,
): ResourceResult<FoundRecipe> {
  const catalog = readStoredCatalog(snapshot, dependencies);
  if (!catalog.ok) return catalog;
  const request = instantiateInput.safeParse(raw);
  if (!request.success) return invalidInputFailure();
  const recipe = storedRecipe(catalog.value, request.data.pin, dependencies);
  return andThen(recipe, (found) =>
    success({ catalog: catalog.value, request: request.data, recipe: found }),
  );
}

/**
 * The stored preset the pin names, which must be a recipe. Fails with the Templates diagnostic,
 * or `invalid-input` at `preset.kind` ("Only recipes can be instantiated") for any other preset.
 */
function storedRecipe(
  catalog: Catalog,
  pin: unknown,
  dependencies: InstantiateDependencies,
): ResourceResult<RecipePreset> {
  const preset = templatesWithoutResources(dependencies).read(catalog, pin);
  if (!preset.ok) return preset;
  if (preset.value.kind !== 'recipe') return resourceFailure(NOT_A_RECIPE);
  return success(preset.value);
}

/** The refusal for a pin that names a theme. */
const NOT_A_RECIPE: ResourceDiagnostic = Object.freeze({
  code: 'invalid-input',
  path: 'preset.kind',
  message: 'Only recipes can be instantiated',
  recovery: 'Select an immutable recipe pin and prepare again.',
});

/**
 * Selects the recipe source's resources, then expands the recipe with them. Fails with
 * `invalid-input` at `resources` when the selection envelope does not parse, and with the
 * selector's or Templates' diagnostic.
 */
function expandRecipe(
  found: FoundRecipe,
  snapshot: Snapshot,
  dependencies: InstantiateDependencies,
): ResourceResult<ExpandedCollection> {
  const admission = { kind: 'recipe', source: found.recipe.payload.source };
  const selection = buildSelectionRequest({ admission, assets: [] }, snapshot);
  if (!selection.ok) return selection;
  const selected = dependencies.selector.select(selection.value, snapshot);
  if (!selected.ok) return selected;
  const templates = dependencies.templates(selected.value.resources);
  const expanded = templates.instantiate(found.catalog, found.request);
  return andThen(expanded, (expansion) => success(expansion.intent.collection));
}

/**
 * The expanded collection printed as DSL source. Fails with `invalid-input` at `language`
 * ("Language could not print the prepared recipe", Language's diagnostics kept as source).
 */
function printedRecipe(
  collection: ExpandedCollection,
  dependencies: InstantiateDependencies,
): ResourceResult<string> {
  const printed = dependencies.language.print({ collection, scope: { kind: 'all' } });
  if (!printed.ok) return resourceFailure(languageRefusal(printed.error));
  return success(printed.value.source);
}

/** Language's complete diagnostic batch survives resource preparation under its typed source. */
function languageRefusal(source: LanguageError): ResourceDiagnostic {
  return {
    code: 'invalid-input',
    path: 'language',
    message: 'Language could not print the prepared recipe',
    recovery: 'Correct the named source diagnostics and prepare again.',
    source,
  };
}
