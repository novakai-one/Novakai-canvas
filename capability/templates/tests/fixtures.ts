import type { Catalog, Preset, IdentityPort } from '../contract/index.js';
import { expect } from 'vitest';
import { composeTemplates, digest, presetId, version } from '../contract/index.js';
import type {
  Result,
  Dependencies,
  Digest,
  ErrorCode,
  RecipePort,
  ThemePayload,
  ThemePort,
  Pin,
  Admission,
  Templates,
} from '../contract/index.js';
import { createIdentity } from '../adapters/identity.js';

/** The diagram intent the test recipe codec expands into: nodes with an id and a label. */
export interface Intent {
  readonly nodes: readonly { readonly id: string; readonly label: string }[];
}

/** A font digest (`a` × 64). */
export const font = digest.parse('a'.repeat(64));

/** A media digest (`b` × 64). */
export const media = digest.parse('b'.repeat(64));

/**
 * A complete resolved theme: one font token, one color, two roles, no base. Each call returns a
 * new object, so no test can change another test's theme.
 *
 * @returns The theme payload.
 */
export function themePayload(): ThemePayload {
  return {
    tokens: {
      'font.body': { type: 'font', family: 'Inter', digest: font },
      'color.text': { type: 'color', value: '#111111' },
    },
    roles: ['neutral', 'primary'],
    fonts: [font],
    base: null,
  };
}

/**
 * A test theme codec whose `resolve` always succeeds with `payload`, whatever it is given.
 *
 * @param payload - The resolved theme to return. Defaults to a new {@link themePayload}.
 * @returns The codec.
 */
export function themeCodec(payload: ThemePayload = themePayload()): ThemePort {
  return { resolve: () => ({ ok: true, value: payload }) };
}

/**
 * A test recipe codec, not a real DSL parser. `inspect` trims the source and reports the given
 * theme pins and assets; `expand` returns one node `<namespace>_start` labelled with the source.
 *
 * @param themes - The theme pins `inspect` reports.
 * @param assets - The asset digests `inspect` reports.
 * @returns The codec.
 */
export function recipe(
  themes: readonly Pin[] = [],
  assets: readonly Digest[] = [],
): RecipePort<Intent> {
  return {
    inspect: (source, family) => ({
      ok: true,
      value: { languageVersion: 1, source: source.trim(), family, themes, assets },
    }),
    expand: (source, namespace) => ({
      ok: true,
      value: { nodes: [{ id: `${namespace}_start`, label: source }] },
    }),
  };
}

/**
 * Test providers: the test recipe codec, a theme codec that always returns {@link themePayload},
 * and the real SHA-256 identity adapter. Templates has no default providers; this helper supplies
 * test ones, each replaceable through `overrides`.
 *
 * @param overrides - Providers to replace.
 * @returns The providers.
 */
export function dependencies(overrides: Partial<Dependencies<Intent>> = {}): Dependencies<Intent> {
  return {
    recipe: recipe(),
    theme: themeCodec(),
    identity: createIdentity(),
    ...overrides,
  };
}

/**
 * Templates built with the public `composeTemplates` (native hashing), the same constructor the
 * hosts use.
 *
 * @returns The facade.
 */
export function service(): Templates<Intent> {
  const defaults = dependencies();
  return composeTemplates({ recipe: defaults.recipe, theme: defaults.theme });
}

/**
 * A recipe admission for `demo` (family `er`). It has no storage fields, coordinates or code.
 *
 * @param release - The version. Defaults to `1.0.0`.
 * @param source - The recipe source. Defaults to `fixture:hello`.
 * @returns The admission.
 */
export function input(
  release = '1.0.0',
  source = 'fixture:hello',
): Admission {
  return {
    schemaVersion: 1,
    id: presetId.parse('demo'),
    version: version.parse(release),
    title: 'Demo',
    description: 'A recipe',
    kind: 'recipe',
    source,
    family: 'er',
  };
}

/**
 * A theme admission. Its `raw` input is opaque to Templates; the test theme codec returns
 * {@link themePayload} whatever it is given.
 *
 * @param id - The theme ID. Defaults to `paper`.
 * @param release - The version. Defaults to `1.0.0`.
 * @returns The admission.
 */
export function themeInput(
  id = 'paper',
  release = '1.0.0',
): Admission {
  return {
    schemaVersion: 1,
    id: presetId.parse(id),
    version: version.parse(release),
    title: 'Paper',
    description: 'Pinned theme',
    kind: 'theme',
    raw: {},
  };
}

/**
 * Asserts a result succeeded and returns its value, so a failure never passes as a success.
 *
 * @param result - The result to check.
 * @returns The success value.
 * @throws Vitest's assertion error when the result failed (and an `Error` with the failure
 * message, which is not reached after a failed assertion).
 */
export function value<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Asserts a result failed with `code`. The message wording is not checked.
 *
 * @param result - The result to check.
 * @param code - The expected failure code.
 * @throws Vitest's assertion error otherwise.
 */
export function rejects(
  result: Result<unknown>,
  code: ErrorCode,
): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

/**
 * A provider failure (`provider-failed` at `fixture`), for failure-path tests.
 *
 * @returns A new failed result.
 */
export function failed<T>(): Result<T> {
  return {
    ok: false,
    error: {
      code: 'provider-failed',
      path: 'fixture',
      message: 'Unavailable',
      recovery: 'Repair fixture',
    },
  };
}

/**
 * A valid chain of `size` themes where each theme's base is the previous one (`theme0` has none).
 * Used to check that a long supported chain validates, without a timing assertion.
 *
 * @param size - The number of themes.
 * @param identity - The hasher used for each theme's digest.
 * @returns The catalog.
 */
export function chainedThemes(
  size: number,
  identity: Pick<IdentityPort, 'hash'>,
): Catalog {
  return Array.from({ length: size }).reduce<Catalog>(
    (records) => appendTheme(records, identity),
    [],
  );
}

/**
 * Appends theme `theme<n>` based on the last record. Its digest hashes a JSON text written here in
 * canonical key order, independently of the production canonicalizer.
 */
function appendTheme(
  records: Catalog,
  identity: Pick<IdentityPort, 'hash'>,
): Catalog {
  const previous = records.at(-1);
  const base = fixtureBase(previous);
  const content = {
    description: '',
    id: presetId.parse(`theme${records.length}`),
    kind: 'theme',
    payload: { base, fonts: [], roles: ['neutral'], tokens: {} },
    schemaVersion: 1,
    title: `Theme ${records.length}`,
    version: version.parse('1.0.0'),
  } as const;
  const result: Preset = { ...content, digest: value(identity.hash(JSON.stringify(content))) };
  return [...records, result];
}

/** The pin of the previous theme, fields in canonical order; `null` for the first theme. */
function fixtureBase(previous: Preset | undefined): Pin | null {
  if (!previous) {
    return null;
  }
  return {
    digest: previous.digest,
    id: previous.id,
    kind: previous.kind,
    version: previous.version,
  };
}
