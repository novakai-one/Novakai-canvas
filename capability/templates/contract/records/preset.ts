import { z } from 'zod';
import { chromeName, digest, presetId, version } from '../brands.js';

/** The two preset kinds. */
export const kind = z.enum(['recipe', 'theme']);

/** The diagram families a recipe can declare. */
export const family = z.enum(['er', 'modules', 'sop', 'mindmap', 'sequence', 'infographic']);

/** Readable text: 1–256 characters and not only whitespace. */
const text = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0);

/**
 * An exact reference to one preset version: kind, id, version and content digest. A pin never
 * means "latest"; only a selection can leave the version out.
 */
export const pin = z.strictObject({ kind, id: presetId, version, digest }).readonly();

/** A pin that passed {@link pin}. */
export type Pin = z.infer<typeof pin>;

/** A pin whose kind must be `theme` ("Expected theme pin"). */
export const themePin = pin.refine((value) => value.kind === 'theme', 'Expected theme pin');

/**
 * One resolved theme token:
 * - `color`: `#RRGGBB` or `#RRGGBBAA` hex;
 * - `dimension`: a finite number with a unit (`px`, `world`, `ms` or `scalar`);
 * - `font`: a family name and the digest of the exact font bytes. The family name is kept, but
 *   the font is always identified by its digest, never by a system font name.
 */
export const token = z.discriminatedUnion('type', [
  z
    .strictObject({
      type: z.literal('color'),
      value: z.string().regex(/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/),
    })
    .readonly(),
  z
    .strictObject({
      type: z.literal('dimension'),
      value: z.number().finite(),
      unit: z.enum(['px', 'world', 'ms', 'scalar']),
    })
    .readonly(),
  z.strictObject({ type: z.literal('font'), family: text, digest }).readonly(),
]);

/**
 * A new schema for recipe source text: 1 to 1,048,576 UTF-16 code units. (`checkPayload`
 * separately limits stored source to 1 MiB of UTF-8 bytes.) Each call builds a separate schema
 * object, so the stored and the submitted source keep their own schemas.
 *
 * @returns The schema.
 */
function recipeSource(): z.ZodString {
  return z
    .string()
    .min(1)
    .max(1024 * 1024);
}

/**
 * A recipe's content as the recipe codec returns it: language version 1, the canonical source
 * (at most 1,048,576 UTF-16 code units here; `checkPayload` also limits it to 1 MiB of UTF-8), its family,
 * and the exact asset digests (up to 1000) and theme pins (up to 100) it uses.
 */
export const recipePayload = z
  .strictObject({
    languageVersion: z.literal(1),
    source: recipeSource(),
    family,
    assets: z.array(digest).max(1000).readonly(),
    themes: z.array(themePin).max(100).readonly(),
  })
  .readonly();

/**
 * A theme's content as the theme codec returns it: an optional chrome name, up to 1000 named
 * tokens, 1–100 role names, the font digests (up to 100; `checkPayload` requires them to equal
 * the sorted unique font-token digests), and the base theme pin or `null` for none.
 */
export const themePayload = z
  .strictObject({
    chrome: chromeName.optional(),
    tokens: z
      .record(z.string().min(1).max(120), token)
      .refine((values) => Object.keys(values).length <= 1000),
    roles: z.array(text).min(1).max(100).readonly(),
    fonts: z.array(digest).max(100).readonly(),
    base: themePin.nullable(),
  })
  .readonly();

/** A payload that passed {@link recipePayload}. */
export type RecipePayload = z.infer<typeof recipePayload>;

/** A payload that passed {@link themePayload}. */
export type ThemePayload = z.infer<typeof themePayload>;

/** The fields every preset and every admission share. */
const header = {
  schemaVersion: z.literal(1),
  id: presetId,
  version,
  title: text,
  description: z.string().max(4096),
};

/**
 * A stored preset: the shared header, its kind, its payload and the digest of all of that. Recipes
 * and themes follow the same identity and admission rules.
 */
export const preset = z.discriminatedUnion('kind', [
  z
    .strictObject({ ...header, kind: z.literal('recipe'), payload: recipePayload, digest })
    .readonly(),
  z.strictObject({ ...header, kind: z.literal('theme'), payload: themePayload, digest }).readonly(),
]);

/** A preset that passed {@link preset}. */
export type Preset = z.infer<typeof preset>;

/** A theme preset. */
export type ThemePreset = Extract<Preset, { kind: 'theme' }>;

/** A whole catalog: up to 1000 presets. Uniqueness, digests and pins are checked by `validateCatalog`. */
export const catalog = z.array(preset).max(1000).readonly();

/** A catalog that passed {@link catalog}. */
export type Catalog = z.infer<typeof catalog>;

/**
 * What a caller submits to add a preset: the header plus either recipe `source` and `family`, or
 * theme `raw` input. This schema accepts any `raw` value; the public admission flow first copies
 * the whole input with `clone`, so `raw` must still be bounded plain JSON data. The payload is
 * always built by the codec, never taken from the caller.
 */
export const admission = z.discriminatedUnion('kind', [
  z
    .strictObject({
      ...header,
      kind: z.literal('recipe'),
      source: recipeSource(),
      family,
    })
    .readonly(),
  z.strictObject({ ...header, kind: z.literal('theme'), raw: z.unknown() }).readonly(),
]);

/** An admission that passed {@link admission}. */
export type Admission = z.infer<typeof admission>;

/**
 * Names a preset to read: kind and id, an optional version (latest when left out), and an
 * optional digest that must match. A digest without a version fails ("Digest requires an exact
 * version").
 */
export const selection = z
  .strictObject({ kind, id: presetId, version: version.optional(), digest: digest.optional() })
  .refine((value) => !value.digest || !!value.version, 'Digest requires an exact version')
  .readonly();

/** A selection that passed {@link selection}. */
export type Selection = z.infer<typeof selection>;

/** A list query: `search` text (up to 256 characters, default empty) and an optional kind. */
export const query = z
  .strictObject({ search: z.string().max(256).default(''), kind: kind.optional() })
  .readonly();

/** A query that passed {@link query}, with its default applied. */
export type Query = z.infer<typeof query>;

/**
 * A loose check of a theme admission's `kind` and `id` only; other fields are allowed and dropped.
 * No app imports it today: Templates' `.theme` grammar builds a typed admission itself
 * (`readThemeSource`, core/theme-source/grammar.ts).
 */
export const themeInput = z.object({ kind: z.literal('theme'), id: presetId }).readonly();

/** A request to instantiate a recipe: its exact pin and the namespace to remap aliases into. */
export const expansionRequest = z.strictObject({ pin, namespace: presetId }).readonly();

/** A request that passed {@link expansionRequest}. */
export type ExpansionRequest = z.infer<typeof expansionRequest>;
