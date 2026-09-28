import type {
  Catalog,
  ExpansionRequest,
  Preset,
  RecipePayload,
} from '../../contract/records/preset.js';
import type { RecipePort } from '../../contract/ports/codecs.js';
import type { Expansion } from '../../contract/types.js';
import type { Digest } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { fail } from '../../contract/errors.js';
import { success, canonical, clone } from '../validation/outcomes.js';
import { exact, pinOf, reachableThemes } from '../validation/catalog.js';

/**
 * Expands a pinned recipe into diagram intent. Nothing is placed or saved; Authoring merges the
 * intent and owns commit recovery.
 * 1. Resolves the exact pin (`missing-preset` or `digest-mismatch`, path: the pin's key).
 * 2. A theme pin is `invalid-input` at `pin.kind`, "Select a recipe to instantiate".
 * 3. Re-inspects the stored source with the recipe codec. A codec failure is returned as it is;
 *    a canonical payload that differs from the stored one is `digest-mismatch` at `payload`. So
 *    an imported record cannot skip the codec's checks.
 * 4. Expands the source into `request.namespace` (a codec failure is returned as it is) and
 *    copies the intent.
 * 5. Returns the pin, namespace and intent, the media digests (the recipe's assets plus the fonts
 *    of every reachable theme, sorted, without duplicates) and the pins of every reachable theme,
 *    sorted by kind, id and version.
 *
 * @param records - The validated catalog.
 * @param request - The parsed request.
 * @param recipe - The recipe codec.
 * @returns The expansion, or the first failure.
 * @throws `InputFault` from `canonical`/`clone`, and whatever the codec throws; callers run inside
 * `protect`.
 */
export function instantiate<T>(
  records: Catalog,
  request: ExpansionRequest,
  recipe: RecipePort<T>,
): Result<Expansion<T>> {
  const selected = exact(records, request.pin);
  if (!selected.ok) {
    return selected;
  }
  return expandRecipe(records, selected.value, request, recipe);
}

/** Rejects a theme, then re-inspects the recipe's stored source. */
function expandRecipe<T>(
  records: Catalog,
  value: Preset,
  request: ExpansionRequest,
  recipe: RecipePort<T>,
): Result<Expansion<T>> {
  if (value.kind !== 'recipe') {
    return fail('invalid-input', 'pin.kind', 'Select a recipe to instantiate');
  }
  const inspected = recipe.inspect(value.payload.source, value.payload.family);
  if (!inspected.ok) {
    return inspected;
  }
  return expandChecked(
    records,
    { stored: value.payload, inspected: inspected.value },
    request,
    recipe,
  );
}

/** The recipe payload as stored in the catalog, and as the codec reads it again now. */
interface CheckedPayloads {
  readonly stored: RecipePayload;
  readonly inspected: RecipePayload;
}

/** Requires the re-inspected payload to equal the stored one, then expands the source. */
function expandChecked<T>(
  records: Catalog,
  { stored: payload, inspected }: CheckedPayloads,
  request: ExpansionRequest,
  recipe: RecipePort<T>,
): Result<Expansion<T>> {
  if (canonical(payload) !== canonical(inspected)) {
    return fail(
      'digest-mismatch',
      'payload',
      'Recipe inspection differs from admitted canonical payload',
    );
  }
  const expanded = recipe.expand(payload.source, request.namespace);
  if (!expanded.ok) {
    return expanded;
  }
  return success(assemble(records, payload, request, clone(expanded.value)));
}

/** Builds the expansion; media digests are de-duplicated by value and sorted. */
function assemble<T>(
  records: Catalog,
  payload: RecipePayload,
  request: ExpansionRequest,
  intent: T,
): Expansion<T> {
  const themes = reachableThemes(records, payload.themes);
  const fonts = themes.flatMap(themeFonts);
  return {
    pin: request.pin,
    namespace: request.namespace,
    intent,
    assets: sortedUnique([...payload.assets, ...fonts]),
    themes: themes.map(pinOf),
  };
}

/** A theme's font digests; a recipe has none. */
function themeFonts(value: Preset): readonly Digest[] {
  if (value.kind !== 'theme') {
    return [];
  }
  return value.payload.fonts;
}

/** The digests without duplicates, sorted. */
function sortedUnique(digests: readonly Digest[]): Digest[] {
  const unique = new Set(digests);
  return [...unique].toSorted();
}
