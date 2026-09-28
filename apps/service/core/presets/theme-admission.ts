/*
 * Why this file exists
 *
 * A theme file is written for people: `base=ink`, colours such as `"#72dbe8"`, and fonts by file,
 * such as `font body source="./fonts/inter.woff2"`. Templates and Design System need the exact
 * form: the base as an exact pin, each font as a checked font file, each colour as numbers.
 *
 * This file rewrites a theme into that exact form. It finds the base with Templates and checks each
 * font with Assets. Any other preset comes back unchanged. Mistakes are an Authoring `Result`
 * (contract/errors.ts). It never saves; Authoring does.
 */
import type {
  Assets,
  AuthoringResult,
  Catalog,
  ChromeName,
  Json,
  Preset,
  StoredBlob,
} from '../../contract/records/capability-types.js';
import type { CapabilityFailure } from '../../contract/records/transport/failure-source.js';
import {
  hexColour,
  sourceTheme,
  type SourceTheme,
  type ThemeOverride,
} from '../../contract/records/presets/theme-input.js';
import { presetFields } from '../../contract/records/presets/preparation.js';
import { chromeName } from '../../contract/schemas.js';
import { authoringFailure, collect, success } from '../../contract/errors.js';
import type { FontBinding, ThemeSavingInputs } from '../../contract/ports/headless.js';
import { parseThemeSelection } from './theme-pin.js';

/** One font alias bound to the family Assets verified and the digest of its bytes. */
type FontEntry = readonly [
  string,
  { readonly family: string; readonly digest: string; readonly approved: true },
];

/**
 * Readies one preset for saving: a theme written for people comes back in the exact form Templates
 * saves; any other preset comes back unchanged. The base is found in `catalog` (the saved presets)
 * with `inputs.templates`; each of `fontBindings` is checked with `inputs.assets`.
 * Mistakes: `invalid-input` when the base can't be found, a font file isn't a checked font, or the
 * theme is malformed; `missing-asset` when Assets can't find a font file.
 */
export function prepareTheme(
  preset: Json,
  catalog: Catalog,
  fontBindings: readonly FontBinding[],
  inputs: ThemeSavingInputs,
): AuthoringResult<Json> {
  const theme = sourceTheme.safeParse(preset);
  if (!theme.success) {
    return success(preset);
  }
  const base = findBaseTheme(theme.data.raw.base, catalog, inputs);
  if (!base.ok) {
    return base;
  }
  return rewriteTheme(preset, theme.data.raw, base.value, fontBindings, inputs.assets);
}

/** The theme's settings as written for people, such as `base=ink` and `"#72dbe8"`. */
type SourceRaw = SourceTheme['raw'];

/** The chrome field of the rewritten settings; left out when the theme names no chrome. */
interface ChromeField {
  readonly chrome?: ChromeName;
}

/** One override under its token ID, in exact form. */
type OverrideEntry = readonly [string, Json];

/** Finds the saved theme the base names, with Templates. */
function findBaseTheme(
  baseText: string,
  catalog: Catalog,
  inputs: ThemeSavingInputs,
): AuthoringResult<Preset> {
  const selection = templatesSelection(baseText);
  const base = inputs.templates.read(catalog, selection);
  if (!base.ok) {
    return baseNotFoundFailure(base.error);
  }
  return success(base.value);
}

/**
 * Writes the base as the selection Templates reads (grammar in theme-pin.ts): an exact pin
 * selects that version and bare digest; any other text is an ID, meaning its latest version.
 */
function templatesSelection(baseText: string): unknown {
  const selection = parseThemeSelection(baseText);
  if (selection.kind === 'latest') {
    return { kind: 'theme', id: selection.id };
  }
  return { kind: 'theme', id: selection.id, version: selection.version, digest: selection.digest };
}

/** Checks each font with Assets, rewrites the settings, and puts them back into the preset. */
function rewriteTheme(
  preset: Json,
  raw: SourceRaw,
  base: Preset,
  fontBindings: readonly FontBinding[],
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<Json> {
  const fonts = collect(fontBindings, (binding) => checkFont(binding, assets));
  if (!fonts.ok) {
    return fonts;
  }
  const exactRaw = rewriteRaw(raw, base, fonts.value);
  if (!exactRaw.ok) {
    return exactRaw;
  }
  return replaceRaw(preset, exactRaw.value);
}

/** Checks one font file with Assets, and pins it under its name with the family Assets found. */
function checkFont(
  binding: FontBinding,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<FontEntry> {
  const blob = assets.resolve(binding.digest);
  if (!blob.ok) {
    return missingFontFailure(blob.error);
  }
  const family = verifiedFontFamily(blob.value.descriptor);
  if (family === null) {
    return unverifiedFontFailure(binding.alias);
  }
  const entry: FontEntry = [binding.alias, { family, digest: binding.digest, approved: true }];
  return success(entry);
}

/** Gives the font family Assets verified for a stored file, or `null` when it isn't a font. */
function verifiedFontFamily(descriptor: StoredBlob['descriptor']): string | null {
  if (descriptor.kind !== 'font') {
    return null;
  }
  return descriptor.fontFamily;
}

/** Puts the rewritten settings back into the preset, in place of `raw`. */
function replaceRaw(
  preset: Json,
  raw: Json,
): AuthoringResult<Json> {
  const fields = presetFields.safeParse(preset);
  if (!fields.success) {
    return malformedThemeFailure();
  }
  const rewritten = { ...fields.data, raw };
  return success(rewritten);
}

/**
 * Rewrites the settings in exact form: the chrome kept, the base as an exact pin, each font
 * pinned and each colour as numbers.
 */
function rewriteRaw(
  raw: SourceRaw,
  base: Preset,
  fonts: readonly FontEntry[],
): AuthoringResult<Json> {
  const chrome = checkChrome(raw.chrome);
  if (!chrome.ok) {
    return chrome;
  }
  const overrides = collect(Object.entries(raw.overrides), exactOverride);
  if (!overrides.ok) {
    return overrides;
  }
  const pin = { kind: base.kind, id: base.id, version: base.version, digest: base.digest };
  const exactRaw: Json = {
    ...chrome.value,
    base: { kind: 'preset', pin },
    fonts: Object.fromEntries(fonts),
    overrides: Object.fromEntries(overrides.value),
  };
  return success(exactRaw);
}

/** Checks the chrome is a Design System chrome name; no chrome written means no field. */
function checkChrome(chrome: unknown): AuthoringResult<ChromeField> {
  if (chrome === undefined) {
    return success({});
  }
  const name = chromeName.safeParse(chrome);
  if (!name.success) {
    return malformedThemeFailure();
  }
  return success({ chrome: name.data });
}

/** Rewrites one override in exact form, and keeps it under its token ID. */
function exactOverride([id, override]: readonly [
  string,
  ThemeOverride,
]): AuthoringResult<OverrideEntry> {
  const exact = exactOverrideValue(override);
  if (!exact.ok) {
    return exact;
  }
  const entry: OverrideEntry = [id, exact.value];
  return success(entry);
}

/** Keeps a number or pixel size as it is, and turns hex colour text into numbers. */
function exactOverrideValue(override: ThemeOverride): AuthoringResult<Json> {
  if (typeof override !== 'string') {
    return success(override);
  }
  return colourFromHex(override);
}

/** Checks hex colour text is `#rrggbb` or `#rrggbbaa`, and turns it into an sRGB colour. */
function colourFromHex(text: string): AuthoringResult<Json> {
  const hex = hexColour.safeParse(text);
  if (!hex.success) {
    return malformedThemeFailure();
  }
  const colour = srgbColour(hex.data);
  return success(colour);
}

/** Builds Design System's sRGB record from checked hex text, each part from 0 to 1. */
function srgbColour(hex: string): Json {
  const components = [hexChannel(hex, 1), hexChannel(hex, 3), hexChannel(hex, 5)];
  const alpha = hexAlpha(hex);
  return { colorSpace: 'srgb', components, alpha };
}

/** Reads the two hex digits at `offset` as a fraction from 0 to 1: `ff` is 1. */
function hexChannel(
  hex: string,
  offset: number,
): number {
  const byte = Number.parseInt(hex.slice(offset, offset + 2), 16);
  return byte / 255;
}

/** Reads the alpha: 1 (opaque) for six digits, or the last two digits as a fraction for eight. */
function hexAlpha(hex: string): number {
  if (hex.length !== 9) {
    return 1;
  }
  return hexChannel(hex, 7);
}

/** Makes the mistake for a base Templates can't find: `invalid-input`, Templates' kept. */
function baseNotFoundFailure(source: CapabilityFailure): AuthoringResult<never> {
  return authoringFailure('invalid-input', source.path, source.message, [], source);
}

/** Makes the mistake for a font file Assets can't find: `missing-asset`, Assets' kept. */
function missingFontFailure(source: CapabilityFailure): AuthoringResult<never> {
  return authoringFailure('missing-asset', source.path, source.message, [], source);
}

/** Makes the mistake for a file that isn't a verified font: `invalid-input` at its name. */
function unverifiedFontFailure(alias: string): AuthoringResult<never> {
  return authoringFailure('invalid-input', alias, 'Theme input must identify a verified font');
}

/** Makes the mistake for a malformed theme: `invalid-input` at `theme`. */
function malformedThemeFailure(): AuthoringResult<never> {
  return authoringFailure('invalid-input', 'theme', 'Theme preparation failed');
}
