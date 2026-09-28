import { selection, query, expansionRequest } from './records/preset.js';
import type { Catalog, Preset } from './records/preset.js';
import type { Dependencies, Templates, PresetPlan, Expansion, Summary } from './types.js';
import type { Result } from './errors.js';
import { protect, clone, parse, success } from '../core/validation/outcomes.js';
import { validateCatalog } from '../core/validation/catalog.js';
import { admit, plan } from '../core/admission/plan.js';
import { select, list } from '../core/discovery/select.js';
import { instantiate } from '../core/expansion/instantiate.js';

/** The `.theme` grammar: a theme file's text as its admission and fonts. Pure; never throws. */
export { readThemeSource } from '../core/theme-source/grammar.js';

/**
 * Creates the Templates facade over the given providers. It keeps no state and saves nothing;
 * Authoring owns commits and recovery. `deps` is read on every call, inside `protect`, so a
 * provider getter that throws becomes `provider-failed` (with the limit below).
 *
 * Every method runs entirely inside `protect`, and there:
 * 1. checks the whole `catalog` input (schemas, digests, pins, duplicates, cycles);
 * 2. parses its own input, if it has one, from a copy, so later changes by the caller have no
 *    effect.
 *
 * Input that is not plain JSON data, is nested deeper than 48 levels, or is larger than 8 MiB is
 * `invalid-input` at `$`. A returned result is a frozen copy. A throw becomes a failure that is
 * not copied or frozen: an `InputFault` keeps its code, path and message; anything else becomes
 * `provider-failed` at `$`.
 * Limit: `protect` inspects a thrown value to turn it into a failure: it checks
 * `instanceof InputFault`, then reads an `InputFault`'s `code`, `path` and `message`. If any of
 * these steps throws, that error escapes the method instead of a failure. Examples: a thrown proxy
 * whose `getPrototypeOf` trap throws, a revoked proxy, or an `InputFault` whose `code` is a
 * throwing getter.
 *
 * @param deps - The recipe codec, theme codec and hashing provider.
 * @returns A frozen {@link Templates} object.
 * @throws Never while building the object. Its methods throw only in the limit above.
 */
export function createTemplates<T>(deps: Dependencies<T>): Templates<T> {
  return Object.freeze({
    /** Checks the catalog and returns it. */
    readCatalog: (input) => withCatalog(input, deps, (records) => success(records)),
    /** Admits and plans the input, then returns the admitted preset. */
    validatePreset: (catalog, input) =>
      withCatalog(catalog, deps, (records) => validate(records, input, deps)),
    /** Admits the input and returns the plan for adding it. */
    planAdmission: (catalog, input) =>
      withCatalog(catalog, deps, (records) => planInput(records, input, deps)),
    /** Returns the selected preset. */
    read: (catalog, input) => withCatalog(catalog, deps, (records) => readInput(records, input)),
    /** Returns the summaries matching the query. */
    list: (catalog, input) => withCatalog(catalog, deps, (records) => listInput(records, input)),
    /** Expands the pinned recipe. */
    instantiate: (catalog, input) =>
      withCatalog(catalog, deps, (records) => expandInput(records, input, deps)),
  } satisfies Templates<T>);
}

/** Checks the catalog, then runs `operation` on it, all inside `protect`. */
function withCatalog<T, U>(
  input: unknown,
  deps: Pick<Dependencies<T>, 'identity'>,
  operation: (records: Catalog) => Result<U>,
): Result<U> {
  return protect(() => {
    const records = validateCatalog(input, deps.identity);
    if (!records.ok) {
      return records;
    }
    return operation(records.value);
  });
}

/**
 * Admits the input and plans it, so pins and cycles are checked and a changed preset under an
 * existing version is `version-exists`; then returns the admitted preset. Saves nothing.
 */
function validate<T>(
  records: Catalog,
  input: unknown,
  deps: Dependencies<T>,
): Result<Preset> {
  const result = admit(records, input, deps);
  if (!result.ok) {
    return result;
  }
  const planned = plan(records, result.value, deps);
  if (!planned.ok) {
    return planned;
  }
  return result;
}

/** Admits the input in full, then plans it; a failed admission exposes no partial record. */
function planInput<T>(
  records: Catalog,
  input: unknown,
  deps: Dependencies<T>,
): Result<PresetPlan> {
  const result = admit(records, input, deps);
  if (!result.ok) {
    return result;
  }
  return plan(records, result.value, deps);
}

/** Parses a strict selection (a digest needs an exact version), then selects the preset. */
function readInput(
  records: Catalog,
  input: unknown,
): Result<Preset> {
  const request = parse(selection, clone(input));
  if (!request.ok) {
    return request;
  }
  return select(records, request.value);
}

/** Parses the query (applying its defaults once), then lists matching summaries. */
function listInput(
  records: Catalog,
  input: unknown,
): Result<readonly Summary[]> {
  const request = parse(query, clone(input));
  if (!request.ok) {
    return request;
  }
  return success(list(records, request.value));
}

/** Parses the request (checking the namespace format) before the recipe codec remaps anything. */
function expandInput<T>(
  records: Catalog,
  input: unknown,
  deps: Dependencies<T>,
): Result<Expansion<T>> {
  const request = parse(expansionRequest, clone(input));
  if (!request.ok) {
    return request;
  }
  return instantiate(records, request.value, deps.recipe);
}
