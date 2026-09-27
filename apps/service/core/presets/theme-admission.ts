/*
 * Theme admission: translates a theme written in source syntax (a base name or exact pin, hex
 * colours, font aliases) into the exact admission Templates and Design System check. The base
 * becomes an exact preset pin, each font alias the family Assets verified, each hex colour an
 * sRGB record. Any other admission passes through unchanged. Pure over the injected owners;
 * Authoring keeps the draft on every failure and owns commit and retry.
 */
import type {
  Assets,
  AuthoringResult,
  Catalog,
  ChromeName,
  Json,
  LoweredIntent,
  Preset,
  Templates,
} from '../../contract/records/capabilities.js';
import {
  hexColour,
  rawFields,
  themeConfig,
  type ThemeConfig,
  type ThemeOverride,
} from '../../contract/records/presets/theme-input.js';
import { admissionFields } from '../../contract/records/presets/preparation.js';
import { chromeName } from '../../contract/schemas.js';
import { authoringFailure } from '../../contract/errors.js';

/** What theme admission uses: Assets to verify fonts, Templates to select the base theme. */
export interface ThemeAdmissionOwners {
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}

/** One font alias the theme names and the digest of the uploaded font bytes it binds. */
type FontBinding = { readonly alias: string; readonly digest: string };

/**
 * Prepares one admission. An admission that is not a source-syntax theme is returned unchanged.
 * Fails with `invalid-input` at Templates' path when the base theme cannot be selected
 * (Templates' failure kept as source), `missing-asset` at Assets' path for any failure of Assets
 * to resolve a font digest, such as bytes not stored or a malformed digest (Assets' failure kept
 * as source), `invalid-input` at the font alias when the bytes are not a verified font, and
 * `invalid-input` at `theme` ("Theme preparation failed") for any throw: a malformed hex colour,
 * chrome name or admission header, or a throw from an owner.
 */
export function prepareTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly FontBinding[],
  owners: ThemeAdmissionOwners,
): AuthoringResult<Json> {
  try {
    return prepareSourceTheme(admission, catalog, bindings, owners);
  } catch {
    return authoringFailure('invalid-input', 'theme', 'Theme preparation failed');
  }
}

/**
 * Selects the exact base through Templates, then binds fonts and overrides (see `withFonts`).
 * Returns a non-theme admission unchanged. Fails with `invalid-input` at Templates' path when no
 * base matches (Templates' failure kept as source). Throws on a malformed override or chrome.
 */
function prepareSourceTheme(
  admission: Json,
  catalog: Catalog,
  bindings: readonly FontBinding[],
  owners: ThemeAdmissionOwners,
): AuthoringResult<Json> {
  const parsed = themeConfig.safeParse(admission);
  if (!parsed.success) return { ok: true, value: admission };
  const base = owners.templates.read(catalog, selection(parsed.data.raw.base));
  if (!base.ok)
    return authoringFailure('invalid-input', base.error.path, base.error.message, [], base.error);
  return withFonts(admission, parsed.data.raw.overrides, base.value, bindings, owners.assets);
}

/**
 * The Templates selection for a base: an exact `id@version#sha256:hex` pin (the syntax Language
 * prints), otherwise a bare ID Templates resolves to its latest version.
 */
function selection(source: string): unknown {
  const exact = /^([^@]+)@([^#]+)#sha256:([a-f0-9]{64})$/.exec(source);
  if (exact) return { kind: 'theme', id: exact[1], version: exact[2], digest: exact[3] };
  return { kind: 'theme', id: source };
}

/**
 * The admission with its raw block rewritten: the authored chrome kept, the base as an exact
 * preset pin, each font alias bound to its verified family and each override translated. Other
 * admission keys stay. Fails with the first font's failure (see `font`). Throws on a malformed
 * header, chrome name or hex colour.
 */
function withFonts(
  admission: Json,
  overrides: ThemeConfig['raw']['overrides'],
  base: Preset,
  bindings: readonly FontBinding[],
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<Json> {
  const fonts = bindings.map((item) => font(item, assets));
  const failed = fonts.find((item) => !item.ok);
  if (failed) return failed;
  const header = admissionFields.parse(admission);
  const pin = {
    kind: base.kind,
    id: base.id,
    version: base.version,
    digest: base.digest,
  };
  return {
    ok: true,
    value: {
      ...header,
      raw: {
        ...chromeField(header.raw),
        base: { kind: 'preset', pin },
        fonts: Object.fromEntries(fonts.filter((item) => item.ok).map((item) => item.value)),
        overrides: Object.fromEntries(
          Object.entries(overrides).map(([id, value]) => [id, tokenValue(value)]),
        ),
      },
    },
  };
}

/**
 * The approved font pin for one alias, with the family from the Assets descriptor (never a
 * caller-supplied name or an OS fallback). Fails with `missing-asset` at Assets' path for any
 * failure of Assets to resolve the digest, such as bytes not stored or a malformed digest (Assets'
 * failure kept as source), and `invalid-input` at the alias when the bytes are not a font with a
 * verified family. A throw from Assets propagates to `prepareTheme`.
 */
function font(
  input: FontBinding,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<
  readonly [string, { readonly family: string; readonly digest: string; readonly approved: true }]
> {
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
 * The authored chrome selector as its own field, or no field when none was authored. Throws
 * when the raw block is not a record or the chrome is not a Design System chrome name.
 */
function chromeField(raw: unknown): { readonly chrome?: ChromeName } {
  // Project one field from the guarded source envelope; unrelated admission keys stay intact.
  const record = rawFields.parse(raw);
  if (record.chrome === undefined) return {};
  return { chrome: chromeName.parse(record.chrome) };
}

/** One override: numbers and pixel dimensions unchanged, a hex colour as an sRGB record. Throws on bad hex. */
function tokenValue(value: ThemeOverride): Json {
  if (typeof value !== 'string') return value;
  return color(value);
}

/** The Design System sRGB record for `#rrggbb` or `#rrggbbaa`. Throws on any other text. */
function color(value: string): Json {
  const hex = hexColour.parse(value);
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
