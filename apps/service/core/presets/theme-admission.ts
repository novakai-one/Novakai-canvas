/*
 * Theme admission: translates a theme written in source syntax (a base name or exact pin, hex
 * colours, font aliases) into the exact admission Templates and Design System check. The base
 * becomes an exact preset pin, each font alias the family Assets verified, each hex colour an
 * sRGB record. Any other admission passes through unchanged. Pure over the injected owners; every
 * refusal is a returned Result. Authoring keeps the draft on every failure and owns commit and
 * retry.
 */
import type {
  Assets,
  AuthoringResult,
  Catalog,
  ChromeName,
  Json,
  Preset,
} from '../../contract/records/capabilities.js';
import {
  hexColour,
  themeConfig,
  type ThemeConfig,
  type ThemeOverride,
} from '../../contract/records/presets/theme-input.js';
import { admissionFields } from '../../contract/records/presets/preparation.js';
import { chromeName } from '../../contract/schemas.js';
import { authoringFailure, collect, success } from '../../contract/errors.js';
import type { FontBinding, ThemeAdmissionOwners } from '../../contract/ports/headless.js';
import { parseThemePin } from './theme-pin.js';

/** One font alias bound to the family Assets verified and the digest of its bytes. */
type FontEntry = readonly [
  string,
  { readonly family: string; readonly digest: string; readonly approved: true },
];

/**
 * Prepares one admission: selects the exact base through Templates, then binds fonts and rewrites
 * the raw block (see `withFonts`). An admission that is not a source-syntax theme is returned
 * unchanged. Fails with `invalid-input` at Templates' path when the base theme cannot be selected
 * (Templates' failure kept as source), `missing-asset` at Assets' path for any failure of Assets
 * to resolve a font digest, such as bytes not stored or a malformed digest (Assets' failure kept
 * as source), `invalid-input` at the font alias when the bytes are not a verified font, and
 * `invalid-input` at `theme` ("Theme preparation failed") for a malformed admission header,
 * chrome name or hex colour.
 */
export function prepareTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly FontBinding[],
  owners: ThemeAdmissionOwners,
): AuthoringResult<Json> {
  const parsed = themeConfig.safeParse(admission);
  if (!parsed.success) return success(admission);
  const base = owners.templates.read(catalog, selection(parsed.data.raw.base));
  if (!base.ok)
    return authoringFailure('invalid-input', base.error.path, base.error.message, [], base.error);
  return withFonts(admission, parsed.data.raw, base.value, bindings, owners.assets);
}

/**
 * The Templates selection for a base (grammar in theme-pin.ts): an exact pin selects that version
 * and bare digest, any other text is an ID Templates resolves to its latest version. Templates
 * parses the selection and refuses what it does not store.
 */
function selection(base: string): unknown {
  const pin = parseThemePin(base);
  if (pin.kind === 'latest') return { kind: 'theme', id: pin.id };
  return { kind: 'theme', id: pin.id, version: pin.version, digest: pin.digest };
}

/**
 * The admission with its raw block rewritten (see `rawBlock`); other admission keys stay. Fails
 * with the first font's failure (see `font`), as `rawBlock` fails, or as `withRaw` fails.
 */
function withFonts(
  admission: Json,
  raw: ThemeConfig['raw'],
  base: Preset,
  bindings: readonly FontBinding[],
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<Json> {
  const fonts = collect(bindings.map((item) => font(item, assets)));
  if (!fonts.ok) return fonts;
  const block = rawBlock(raw, base, fonts.value);
  if (!block.ok) return block;
  return withRaw(admission, block.value);
}

/**
 * The approved font pin for one alias, with the family from the Assets descriptor (never a
 * caller-supplied name or an OS fallback). Fails with `missing-asset` at Assets' path for any
 * failure of Assets to resolve the digest, such as bytes not stored or a malformed digest (Assets'
 * failure kept as source), and `invalid-input` at the alias when the bytes are not a font with a
 * verified family.
 */
function font(
  input: FontBinding,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<FontEntry> {
  const blob = assets.resolve(input.digest);
  if (!blob.ok)
    return authoringFailure('missing-asset', blob.error.path, blob.error.message, [], blob.error);
  if (blob.value.descriptor.kind !== 'font' || blob.value.descriptor.fontFamily === null)
    return authoringFailure(
      'invalid-input',
      input.alias,
      'Theme input must identify a verified font',
    );
  return {
    ok: true,
    value: [
      input.alias,
      { family: blob.value.descriptor.fontFamily, digest: input.digest, approved: true },
    ],
  };
}

/**
 * The admission's fields with `raw` replaced by the rewritten block. Fails with `invalid-input` at
 * `theme` when the admission is not a record of JSON fields.
 */
function withRaw(
  admission: Json,
  raw: Json,
): AuthoringResult<Json> {
  const header = admissionFields.safeParse(admission);
  if (!header.success) return preparationFailed();
  return { ok: true, value: { ...header.data, raw } };
}

/**
 * The rewritten raw block: the authored chrome kept, the base as an exact preset pin, each font
 * alias bound to its verified family and each override translated. Fails with `invalid-input` at
 * `theme` when the chrome is not a Design System chrome name or an override is not a hex colour.
 */
function rawBlock(
  raw: ThemeConfig['raw'],
  base: Preset,
  fonts: readonly FontEntry[],
): AuthoringResult<Json> {
  const chrome = chromeField(raw.chrome);
  if (!chrome.ok) return chrome;
  const overrides = collect(Object.entries(raw.overrides).map(tokenEntry));
  if (!overrides.ok) return overrides;
  const pin = { kind: base.kind, id: base.id, version: base.version, digest: base.digest };
  return {
    ok: true,
    value: {
      ...chrome.value,
      base: { kind: 'preset', pin },
      fonts: Object.fromEntries(fonts),
      overrides: Object.fromEntries(overrides.value),
    },
  };
}

/**
 * The authored chrome selector as its own field, or no field when none was authored. Fails with
 * `invalid-input` at `theme` when it is not a Design System chrome name.
 */
function chromeField(chrome: unknown): AuthoringResult<{ readonly chrome?: ChromeName }> {
  if (chrome === undefined) return { ok: true, value: {} };
  const name = chromeName.safeParse(chrome);
  if (!name.success) return preparationFailed();
  return { ok: true, value: { chrome: name.data } };
}

/**
 * One override: numbers and pixel dimensions unchanged, a hex colour as an sRGB record. Fails
 * with `invalid-input` at `theme` when a string is not `#rrggbb` or `#rrggbbaa`.
 */
function tokenEntry([id, value]: readonly [string, ThemeOverride]): AuthoringResult<
  readonly [string, Json]
> {
  if (typeof value !== 'string') return { ok: true, value: [id, value] };
  const hex = hexColour.safeParse(value);
  if (!hex.success) return preparationFailed();
  return { ok: true, value: [id, color(hex.data)] };
}

/** The Design System sRGB record for checked `#rrggbb` or `#rrggbbaa` text. Never fails. */
function color(hex: string): Json {
  return {
    colorSpace: 'srgb',
    components: [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
    alpha: colorAlpha(hex),
  };
}

/** Opaque (1) for six digits; the final byte over 255 for eight. */
function colorAlpha(hex: string): number {
  if (hex.length !== 9) return 1;
  return Number.parseInt(hex.slice(7, 9), 16) / 255;
}

/** The refusal for a malformed theme: `invalid-input` at `theme`. */
function preparationFailed(): AuthoringResult<never> {
  return authoringFailure('invalid-input', 'theme', 'Theme preparation failed');
}
