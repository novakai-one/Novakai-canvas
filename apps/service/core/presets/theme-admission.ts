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
  const theme = readThemeForPeople(preset);
  // Any other preset is saved as it is.
  if (theme === undefined) {
    return success(preset);
  }
  const base = findBaseTheme(theme.raw.base, catalog, inputs);
  if (!base.ok) {
    return base;
  }
  return rewriteTheme(preset, theme.raw, base.value, fontBindings, inputs.assets);
}

/** The theme's settings as written for people, such as `base=ink` and `"#72dbe8"`. */
type SourceSettings = SourceTheme['raw'];

/** What Templates reads to pick a theme: an ID alone (its latest version), or an exact version. */
type TemplatesThemeSelection =
  | { readonly kind: 'theme'; readonly id: string }
  | {
      readonly kind: 'theme';
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };

/** The chrome field of the rewritten settings; left out when the theme names no chrome. */
interface ChromeField {
  readonly chrome?: ChromeName;
}

/** One override as written for people, under its token ID. */
type SourceOverrideEntry = readonly [string, ThemeOverride];

/** One override under its token ID, in exact form. */
type OverrideEntry = readonly [string, Json];

/** Reads the preset as a theme written for people; any other preset gives `undefined`. */
function readThemeForPeople(preset: Json): SourceTheme | undefined {
  const parsed = sourceTheme.safeParse(preset);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

/** Finds the saved theme the base names, with Templates. */
function findBaseTheme(
  baseText: string,
  catalog: Catalog,
  inputs: ThemeSavingInputs,
): AuthoringResult<Preset> {
  const selection = writeTemplatesSelection(baseText);
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
function writeTemplatesSelection(baseText: string): TemplatesThemeSelection {
  const selection = parseThemeSelection(baseText);
  if (selection.kind === 'latest') {
    return { kind: 'theme', id: selection.id };
  }
  return { kind: 'theme', id: selection.id, version: selection.version, digest: selection.digest };
}

/**
 * Checks each font with Assets, rewrites the preset's `raw` field (its settings) in exact form, and
 * puts the settings back into the preset.
 */
function rewriteTheme(
  preset: Json,
  settings: SourceSettings,
  base: Preset,
  fontBindings: readonly FontBinding[],
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<Json> {
  const fonts = collect(fontBindings, (binding) => checkFont(binding, assets));
  if (!fonts.ok) {
    return fonts;
  }
  const exactSettings = rewriteSettings(settings, base, fonts.value);
  if (!exactSettings.ok) {
    return exactSettings;
  }
  return replaceSettings(preset, exactSettings.value);
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

/**
 * Rewrites the settings in exact form: the chrome kept, the base as an exact pin, each font
 * pinned and each colour as numbers.
 */
function rewriteSettings(
  settings: SourceSettings,
  base: Preset,
  fonts: readonly FontEntry[],
): AuthoringResult<Json> {
  const chrome = checkChrome(settings.chrome);
  if (!chrome.ok) {
    return chrome;
  }
  const overrides = collect(Object.entries(settings.overrides), rewriteOverride);
  if (!overrides.ok) {
    return overrides;
  }
  const pin = { kind: base.kind, id: base.id, version: base.version, digest: base.digest };
  const exactSettings: Json = {
    ...chrome.value,
    base: { kind: 'preset', pin },
    fonts: Object.fromEntries(fonts),
    overrides: Object.fromEntries(overrides.value),
  };
  return success(exactSettings);
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
function rewriteOverride(entry: SourceOverrideEntry): AuthoringResult<OverrideEntry> {
  const [tokenId, override] = entry;
  const exact = exactOverrideValue(override);
  if (!exact.ok) {
    return exact;
  }
  const rewritten: OverrideEntry = [tokenId, exact.value];
  return success(rewritten);
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

/**
 * Puts the rewritten settings back into the preset, in place of `raw`. Refuses a preset whose
 * fields aren't a JSON record: `invalid-input` at `theme`.
 */
function replaceSettings(
  preset: Json,
  settings: Json,
): AuthoringResult<Json> {
  const fields = presetFields.safeParse(preset);
  if (!fields.success) {
    return malformedThemeFailure();
  }
  const rewritten = { ...fields.data, raw: settings };
  return success(rewritten);
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
