import { catalog, themePayload, recipePayload } from '../../contract/records/preset.js';
import type {
  Catalog,
  Pin,
  Preset,
  ThemePayload,
  RecipePayload,
} from '../../contract/records/preset.js';
import { digest } from '../../contract/brands.js';
import type { Digest } from '../../contract/brands.js';
import type { IdentityPort } from '../../contract/ports/identity.js';
import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import { canonical, clone, parse, success, firstFailure } from './outcomes.js';

/**
 * The identity key of a preset version: `kind/id/version`. It names a version, not its content
 * (the digest is separate). IDs and versions cannot contain `/`, so keys never collide.
 *
 * @param value - Anything with kind, id and version.
 * @returns The key.
 * @throws Never.
 */
export function key(value: Pick<Pin, 'kind' | 'id' | 'version'>): string {
  return `${value.kind}/${value.id}/${value.version}`;
}

/**
 * The pin of a preset: kind, id, version and digest only, never the payload.
 *
 * @param value - The preset.
 * @returns A new pin.
 * @throws Never.
 */
export function pinOf(value: Preset): Pin {
  return { kind: value.kind, id: value.id, version: value.version, digest: value.digest };
}

/**
 * Hashes the canonical JSON of a value and checks the provider's answer is a digest, even when
 * the provider is plain JavaScript.
 *
 * @param value - The content to hash.
 * @param identity - The hashing provider.
 * @returns The digest; the provider's own failure; or `invalid-input` when its answer is not a
 * digest.
 * @throws `InputFault` from `canonical` for non-JSON content, and whatever the provider throws;
 * callers run inside `protect`.
 */
export function hashContent(
  value: unknown,
  identity: IdentityPort,
): Result<Digest> {
  const result = identity.hash(canonical(value));
  if (!result.ok) {
    return result;
  }
  return parse(digest, result.value);
}

/**
 * Finds the exact preset a pin names. It never falls back to another version.
 *
 * @param records - The validated catalog.
 * @param pin - The pin to resolve.
 * @returns The preset; `missing-preset` when no preset has the pin's key; or `digest-mismatch`
 * when the digest differs (path: the pin's key).
 * @throws Never.
 */
export function exact(
  records: Catalog,
  pin: Pin,
): Result<Preset> {
  const found = records.find((item) => key(item) === key(pin));
  return checkPinned(found, pin);
}

/**
 * The pins a preset depends on: a recipe's theme pins, or a theme's base (none when `base` is
 * `null`).
 *
 * @param value - The preset.
 * @returns The dependency pins.
 * @throws Never.
 */
export function dependencies(value: Preset): readonly Pin[] {
  if (value.kind === 'recipe') {
    return value.payload.themes;
  }
  return baseDependency(value.payload);
}

/**
 * Checks the payload rules that admission establishes, again, for records read back from storage
 * or import. The payload is parsed again with its schema first.
 *
 * - Theme: `fonts` equals the sorted unique font-token digests; `roles` has no duplicates.
 * - Recipe: `source` is at most 1 MiB in UTF-8 bytes; `assets` and `themes` have no duplicates.
 *
 * @param value - The preset.
 * @returns Success, or the first `invalid-input` failure (paths relative to the payload).
 * @throws `InputFault` from `canonical` (theme font comparison); callers run inside
 * `protect`.
 */
export function checkPayload(value: Preset): Result<void> {
  if (value.kind === 'theme') {
    return checkTheme(value.payload);
  }
  return checkRecipe(value.payload);
}

/**
 * Parses a theme payload (token shapes, limits, base pin shape) and checks its font manifest and
 * duplicate roles (see {@link checkPayload}). Token meaning and contrast belong to Design System.
 *
 * @param input - The theme payload.
 * @returns Success, or the first `invalid-input` failure.
 * @throws `InputFault` from `canonical`, and whatever the schema throws while reading `input`
 * (for example a throwing getter); callers run inside `protect`.
 */
export function checkTheme(input: unknown): Result<void> {
  const parsed = parse(themePayload, input);
  if (!parsed.ok) {
    return parsed;
  }
  return themeCorrespondence(parsed.value);
}

/**
 * Checks a whole catalog before any use.
 * 1. Copies it (see `clone`) and parses it with the catalog schema; a parse failure stops here.
 * 2. Runs every check, in this order, even after one returns a failure: duplicate keys, every
 *    record's digest (hashing each record), every record's payload rules, every dependency pin,
 *    cycles. A thrown exception stops the remaining checks.
 * 3. Returns the first failure in that order, or the parsed catalog.
 *
 * Authoring owns re-admission and commit recovery.
 *
 * @param input - The untrusted catalog.
 * @param identity - The hashing provider.
 * @returns The parsed catalog, or the first failure.
 * @throws `InputFault` from `clone`/`canonical`, and whatever the provider throws; callers
 * run inside `protect`.
 */
export function validateCatalog(
  input: unknown,
  identity: IdentityPort,
): Result<Catalog> {
  const parsed = parse(catalog, clone(input));
  if (!parsed.ok) {
    return parsed;
  }
  return validateRecords(parsed.value, identity);
}

/**
 * Every theme a list of pins reaches, including bases, each once, sorted by key. Only safe on a
 * catalog whose cycles were already rejected (it recurses). A pin that does not resolve is
 * skipped.
 *
 * @param records - The validated catalog.
 * @param pins - The starting theme pins.
 * @returns The reached presets, sorted by key (`localeCompare`, locale `en`).
 * @throws Never on a validated catalog.
 */
export function reachableThemes(
  records: Catalog,
  pins: readonly Pin[],
): readonly Preset[] {
  const values = pins.flatMap((pin) => {
    const result = exact(records, pin);
    if (!result.ok) {
      return [];
    }
    return [result.value, ...reachableThemes(records, dependencies(result.value))];
  });
  return [...new Map(values.map((value) => [key(value), value])).values()].sort((a, b) =>
    key(a).localeCompare(key(b), 'en'),
  );
}

/** Rehashes every field except the digest and compares; a difference is `digest-mismatch`. */
function verifyHash(
  value: Preset,
  identity: IdentityPort,
): Result<void> {
  const { digest: expected, ...content } = value;
  const result = identity.hash(canonical(content));
  if (!result.ok) {
    return result;
  }
  if (result.value !== expected) {
    return fail('digest-mismatch', key(value), 'Preset content differs from pin');
  }
  return success(undefined);
}

/** A theme's base pin as a list: empty when `base` is `null` (no base, on purpose). */
function baseDependency(value: ThemePayload): readonly Pin[] {
  if (value.base === null) {
    return [];
  }
  return [value.base];
}

/** Presets whose dependencies are not resolved yet, and the keys already resolved. */
interface AncestryProgress {
  readonly pending: Catalog;
  readonly resolved: ReadonlySet<string>;
}

/**
 * Rejects dependency cycles without recursion. Each round resolves every pending preset whose
 * dependencies are all resolved; at most `records.length` rounds are needed.
 */
function validateAncestry(records: Catalog): Result<void> {
  const initial: Result<AncestryProgress> = success({
    pending: records,
    resolved: new Set<string>(),
  });
  const result = records.reduce<Result<AncestryProgress>>(advanceAncestry, initial);
  if (!result.ok) {
    return result;
  }
  return success(undefined);
}

/** One round; a failure or an empty pending list is passed along unchanged. */
function advanceAncestry(progress: Result<AncestryProgress>): Result<AncestryProgress> {
  if (!progress.ok) {
    return progress;
  }
  if (progress.value.pending.length === 0) {
    return progress;
  }
  return resolveAncestryRound(progress.value);
}

/**
 * Resolves every pending preset whose dependencies are resolved. When none can be resolved, the
 * rest form a cycle: `dependency-cycle` at the first pending preset's ID.
 */
function resolveAncestryRound(progress: AncestryProgress): Result<AncestryProgress> {
  const ready = progress.pending.filter((value) =>
    dependencies(value).every((pin) => progress.resolved.has(key(pin))),
  );
  if (ready.length === 0) {
    return fail('dependency-cycle', progress.pending[0]?.id ?? '$', 'Preset ancestry is cyclic');
  }
  const resolved = new Set([...progress.resolved, ...ready.map(key)]);
  return success({
    pending: progress.pending.filter((value) => !resolved.has(key(value))),
    resolved,
  });
}

/** Checks every dependency pin resolves; records are indexed once so long chains stay cheap. */
function validateReferences(records: Catalog): Result<void> {
  const index: ReadonlyMap<string, Preset> = new Map(records.map((value) => [key(value), value]));
  return firstFailure(records.flatMap(dependencies).map((pin) => indexedReference(index, pin)));
}

/** Like {@link exact}, against the index: `missing-preset` or `digest-mismatch`. */
function indexedReference(
  index: ReadonlyMap<string, Preset>,
  pin: Pin,
): Result<Preset> {
  const found = index.get(key(pin));
  return checkPinned(found, pin);
}

/**
 * The preset a pin was looked up to: `missing-preset` when none was found, `digest-mismatch` when
 * its digest differs (path: the pin's key), otherwise the preset itself.
 */
function checkPinned(
  found: Preset | undefined,
  pin: Pin,
): Result<Preset> {
  if (!found) {
    return fail('missing-preset', key(pin), 'Pinned preset is absent');
  }
  if (found.digest !== pin.digest) {
    return fail('digest-mismatch', key(pin), 'Pinned digest differs');
  }
  return success(found);
}

/** Two records with the same key are `duplicate-preset` at `$`; a later one never hides an earlier one. */
function uniqueRecords(records: Catalog): Result<void> {
  const keys = records.map(key);
  if (new Set(keys).size !== keys.length) {
    return fail('duplicate-preset', '$', 'Duplicate preset identity');
  }
  return success(undefined);
}

/** `fonts` must equal the sorted unique font-token digests; `roles` must have no duplicates. */
function themeCorrespondence(value: ThemePayload): Result<void> {
  const fonts = Object.values(value.tokens).flatMap((token) =>
    token.type === 'font' ? [token.digest] : [],
  );
  const expected = [...new Set(fonts)].sort();
  if (canonical(expected) !== canonical(value.fonts)) {
    return fail('invalid-input', 'fonts', 'Font manifest must equal sorted unique token digests');
  }
  if (new Set(value.roles).size !== value.roles.length) {
    return fail('invalid-input', 'roles', 'Duplicate role name');
  }
  return success(undefined);
}

/** Parses a recipe payload, then checks its source size and manifests. */
function checkRecipe(input: unknown): Result<void> {
  const parsed = parse(recipePayload, input);
  if (!parsed.ok) {
    return parsed;
  }
  return recipeCorrespondence(parsed.value);
}

/** Source is limited to 1 MiB in UTF-8 bytes (the schema limits code units only). */
function recipeCorrespondence(value: RecipePayload): Result<void> {
  if (new TextEncoder().encode(value.source).byteLength > 1024 * 1024) {
    return fail('invalid-input', 'source', 'Recipe source exceeds 1 MiB');
  }
  return uniqueManifest(value);
}

/** `assets` and `themes` must have no duplicates (themes compared by key). */
function uniqueManifest(value: RecipePayload): Result<void> {
  if (new Set(value.assets).size !== value.assets.length) {
    return fail('invalid-input', 'assets', 'Duplicate asset dependency');
  }
  if (new Set(value.themes.map(key)).size !== value.themes.length) {
    return fail('invalid-input', 'themes', 'Duplicate theme dependency');
  }
  return success(undefined);
}

/**
 * Runs every check even after a returned failure (so each record is hashed), then returns the
 * first failure or the catalog. A throw stops the remaining checks.
 */
function validateRecords(
  records: Catalog,
  identity: IdentityPort,
): Result<Catalog> {
  const checks = [
    uniqueRecords(records),
    ...records.map((value) => verifyHash(value, identity)),
    ...records.map(checkPayload),
    validateReferences(records),
    validateAncestry(records),
  ];
  const checked = firstFailure(checks);
  if (!checked.ok) {
    return checked;
  }
  return success(records);
}
