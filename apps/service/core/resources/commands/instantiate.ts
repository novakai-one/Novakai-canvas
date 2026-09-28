/*
 * Recipe instantiation: one stored recipe expanded with its selected resources and printed as DSL
 * source. Pure over the injected owners; Language owns all identity remapping. Every refusal is a
 * returned value (refusal.ts), and Authoring owns the canonical write and receipt.
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
import { selectionRequest, storedCatalog, unboundTemplates } from './catalog.js';
import { invalidPreparation, preparationRefused } from './refusal.js';

/** The owners instantiation works through. */
export interface InstantiateOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
  readonly language: Pick<Language, 'print'>;
  /** Templates bound to one call's resolved resources. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'read' | 'instantiate'>;
}

/**
 * Expansion uses exact stored recipe source and normalized resource bindings.
 *
 * Steps; the first failure stops the instantiation:
 * 1. Find the stored recipe the input pins (see `findRecipe`).
 * 2. Select its resources and expand it through Templates (see `expandRecipe`).
 * 3. Print the expanded collection through Language (see `printedRecipe`).
 *
 * Fails with `invalid-input` at `resources` for a malformed input, at `preset.kind` for a
 * non-recipe pin, at `language` for an unprintable expansion, or with the owner's diagnostic when
 * Templates or the selector refuses.
 */
export function instantiate(
  raw: unknown,
  snapshot: Snapshot,
  owners: InstantiateOwners,
): ResourceResult<string> {
  const found = findRecipe(raw, snapshot, owners);
  if (!found.ok) return found;
  const expanded = expandRecipe(found.value, snapshot, owners);
  return andThen(expanded, (collection) => printedRecipe(collection, owners));
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
  owners: InstantiateOwners,
): ResourceResult<FoundRecipe> {
  const catalog = storedCatalog(snapshot, owners);
  if (!catalog.ok) return catalog;
  const request = instantiateInput.safeParse(raw);
  if (!request.success) return invalidPreparation();
  const recipe = storedRecipe(catalog.value, request.data.pin, owners);
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
  owners: InstantiateOwners,
): ResourceResult<RecipePreset> {
  const preset = unboundTemplates(owners).read(catalog, pin);
  if (!preset.ok) return preset;
  if (preset.value.kind !== 'recipe') return preparationRefused(NOT_A_RECIPE);
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
  owners: InstantiateOwners,
): ResourceResult<ExpandedCollection> {
  const admission = { kind: 'recipe', source: found.recipe.payload.source };
  const selection = selectionRequest({ admission, assets: [] }, snapshot);
  if (!selection.ok) return selection;
  const selected = owners.selector.select(selection.value, snapshot);
  if (!selected.ok) return selected;
  const templates = owners.templates(selected.value.resources);
  const expanded = templates.instantiate(found.catalog, found.request);
  return andThen(expanded, (expansion) => success(expansion.intent.collection));
}

/**
 * The expanded collection printed as DSL source. Fails with `invalid-input` at `language`
 * ("Language could not print the prepared recipe", Language's diagnostics kept as source).
 */
function printedRecipe(
  collection: ExpandedCollection,
  owners: InstantiateOwners,
): ResourceResult<string> {
  const printed = owners.language.print({ collection, scope: { kind: 'all' } });
  if (!printed.ok) return preparationRefused(languageRefusal(printed.error));
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
