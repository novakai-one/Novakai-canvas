import { admission, preset, recipePayload, themePayload } from '../../contract/records/preset.js';
import type { Admission, Catalog, Preset, ThemePreset } from '../../contract/records/preset.js';
import type { PresetPlan } from '../../contract/types.js';
import type { RecipePort, ThemePort } from '../../contract/ports/codecs.js';
import type { IdentityPort } from '../../contract/ports/identity.js';
import type { Digest } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { fail } from '../../contract/errors.js';
import { parse, clone, success } from '../validation/outcomes.js';
import { hashContent, validateCatalog, checkPayload, key, pinOf } from '../validation/catalog.js';

/** The providers admission needs. Only the recipe codec's `inspect` is used, never `expand`. */
interface AdmissionDependencies {
  readonly recipe: Pick<RecipePort<unknown>, 'inspect'>;
  readonly theme: ThemePort;
  readonly identity: IdentityPort;
}

/**
 * Turns submitted input into a complete preset, without adding it to the catalog.
 * 1. Copies the input (see `clone`) and parses it with the admission schema.
 * 2. Resolves the payload through its codec: a recipe's source through `recipe.inspect` (which
 *    returns canonical source and the exact asset and theme references), or a theme's `raw`
 *    input through `theme.resolve` with the catalog's themes as possible bases.
 * 3. Copies and parses the codec's payload with the payload schema.
 * 4. Hashes the header and payload into the digest, parses the whole preset, and checks the
 *    payload rules (see `checkPayload`).
 *
 * The first failure stops admission. A codec's own failure is returned as it is.
 *
 * @param records - The validated catalog.
 * @param input - The untrusted admission input.
 * @param deps - The recipe and theme codecs and the hashing provider.
 * @returns The admitted preset, or the first failure.
 * @throws `InputFault` from `clone`, and whatever a provider throws; callers run inside `protect`.
 */
export function admit(
  records: Catalog,
  input: unknown,
  deps: AdmissionDependencies,
): Result<Preset> {
  const parsed = parse(admission, clone(input));
  if (!parsed.ok) {
    return parsed;
  }
  return resolveAdmission(records, parsed.value, deps);
}

/**
 * Plans adding an admitted preset to the catalog. Authoring commits the plan.
 * - Same key already present with the same digest: the catalog is unchanged (`changed: false`,
 *   the existing pin), so a replay is safe.
 * - Same key with a different digest: `version-exists` at the key; a published version never
 *   gets new content.
 * - New key: the catalog with the preset appended is validated in full (see `validateCatalog`),
 *   so dependency pins and cycles are checked.
 *
 * @param records - The validated catalog.
 * @param value - The admitted preset.
 * @param deps - The hashing provider.
 * @returns The plan, or the first failure.
 * @throws `InputFault` and provider throws from `validateCatalog`; callers run inside `protect`.
 */
export function plan(
  records: Catalog,
  value: Preset,
  deps: Pick<AdmissionDependencies, 'identity'>,
): Result<PresetPlan> {
  const previous = records.find((item) => key(item) === key(value));
  if (previous) {
    return existing(records, previous, value);
  }
  const candidate = validateCatalog([...records, value], deps.identity);
  if (!candidate.ok) {
    return candidate;
  }
  return success({ candidate: candidate.value, pin: pinOf(value), changed: true });
}

/** Sends a recipe to the recipe codec and a theme to the theme codec. */
function resolveAdmission(
  records: Catalog,
  input: Admission,
  deps: AdmissionDependencies,
): Result<Preset> {
  if (input.kind === 'recipe') {
    return admitRecipe(input, deps);
  }
  return admitTheme(records, input, deps);
}

/** The manifest comes from `inspect`, never from a list the caller wrote. */
function admitRecipe(
  input: Extract<Admission, { kind: 'recipe' }>,
  deps: Pick<AdmissionDependencies, 'recipe' | 'identity'>,
): Result<Preset> {
  const result = deps.recipe.inspect(input.source, input.family);
  if (!result.ok) {
    return result;
  }
  const checked = parse(recipePayload, clone(result.value));
  if (!checked.ok) {
    return checked;
  }
  return finish({ ...header(input), payload: checked.value }, deps);
}

/** Theme input may be a change on top of a base; `resolve` must return complete values and font pins. */
function admitTheme(
  records: Catalog,
  input: Extract<Admission, { kind: 'theme' }>,
  deps: Pick<AdmissionDependencies, 'theme' | 'identity'>,
): Result<Preset> {
  const themes = records.filter((value): value is ThemePreset => value.kind === 'theme');
  const result = deps.theme.resolve(input.raw, themes);
  if (!result.ok) {
    return result;
  }
  const checked = parse(themePayload, clone(result.value));
  if (!checked.ok) {
    return checked;
  }
  return finish({ ...header(input), payload: checked.value }, deps);
}

/** Hashes the whole record (header and payload) and builds the preset. */
function finish(
  content: Omit<Preset, 'digest'>,
  deps: Pick<AdmissionDependencies, 'identity'>,
): Result<Preset> {
  const hashed = hashContent(content, deps.identity);
  if (!hashed.ok) {
    return hashed;
  }
  return finishRecord(content, hashed.value);
}

/** Parses the record with its digest (the schema gives the final type), then checks payload rules. */
function finishRecord(
  content: Omit<Preset, 'digest'>,
  digest: Digest,
): Result<Preset> {
  const parsed = parse(preset, { ...content, digest });
  if (!parsed.ok) {
    return parsed;
  }
  const checked = checkPayload(parsed.value);
  if (!checked.ok) {
    return checked;
  }
  return success(parsed.value);
}

/** A version that exists may be replayed only with the same content; otherwise `version-exists`. */
function existing(
  records: Catalog,
  previous: Preset,
  value: Preset,
): Result<PresetPlan> {
  if (previous.digest !== value.digest) {
    return fail(
      'version-exists',
      key(value),
      'Create a new version instead of overwriting this one',
    );
  }
  return success({ candidate: records, pin: pinOf(previous), changed: false });
}

/** A new object with the admission's header fields only (not `source`, `family` or `raw`). */
function header(
  input: Admission,
): Pick<Preset, 'schemaVersion' | 'id' | 'version' | 'title' | 'description' | 'kind'> {
  return {
    schemaVersion: input.schemaVersion,
    id: input.id,
    version: input.version,
    title: input.title,
    description: input.description,
    kind: input.kind,
  };
}
