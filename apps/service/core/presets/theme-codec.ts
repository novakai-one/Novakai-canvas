/*
 * Why this file exists
 *
 * Templates saves themes but can't work out their colours, sizes and fonts. A theme only lists what
 * it changes: for example, `walkthrough` is `ink` with a different accent colour. Design System
 * works out every value from the base theme plus those changes, and checks the result.
 *
 * This file is the theme codec: Templates asks it to work out a theme, and it asks Design System.
 * Every mistake is `invalid-input` at `preset` (codec-refusal.ts), with Design System's own
 * failure kept as the source when it refused. It never saves.
 */
import type { PresetDigest } from '../../contract/brands.js';
import type {
  DesignSystem,
  PortableTheme,
  PortableToken,
  TemplatesResult,
  ThemePayload,
  ThemePreset,
} from '../../contract/records/capability-types.js';
import type { CapabilityFailure } from '../../contract/records/transport/failure-source.js';
import type { PresetCodecs } from '../../contract/records/presets/codecs.js';
import { exactTheme, type ExactTheme } from '../../contract/records/presets/theme-input.js';
import { collect, success } from '../../contract/errors.js';
import { codecFailure } from './codec-refusal.js';
import { checkPresetDigest, checkThemePin } from './branded-pin.js';

/** What the theme codec uses. */
export interface ThemeCodecContext {
  /** Design System, which works out a theme's full values from its base and its changes. */
  readonly system: Pick<DesignSystem, 'resolveTheme'>;
  /** The design token sources, as read from disk; Design System checks them on every call. */
  readonly sources: unknown;
}

/**
 * Builds the theme codec Templates uses. Its `resolve` works out a theme's full values from its
 * changes and its base: one of the app's own interface themes (`kind: 'ui'`, in
 * capability/design-system/tokens/themes) or exactly one of the `available` saved themes.
 * Mistakes: `invalid-input` at `preset` when the input isn't a theme, the base isn't available,
 * Design System refuses the theme, or an ID, version or digest fails Templates' check.
 */
export function createThemeCodec(context: ThemeCodecContext): PresetCodecs['theme'] {
  return { resolve: (raw, available) => resolveThemeInput(raw, available, context) };
}

/** A theme's base: the app's own interface tokens (`ui`), or a saved theme named by exact pin. */
type ThemeBase = ExactTheme['base'];

/** A base that names a saved theme by its exact ID, version and digest. */
type SavedBase = Extract<ThemeBase, { readonly kind: 'preset' }>;

/** A font of the saved base theme, as Design System reads it. */
interface BaseFont {
  readonly family: string;
  readonly digest: string;
  readonly approved: boolean;
}

/** A saved base as Design System reads it: its pin, the saved payload and the saved fonts. */
interface SavedBaseForDesignSystem {
  readonly kind: 'preset';
  readonly pin: SavedBase['pin'];
  readonly payload: ThemePayload;
  readonly fonts: readonly BaseFont[];
}

/** The base Design System works from: the app's own interface tokens, or a saved base. */
type DesignSystemBase = Extract<ThemeBase, { readonly kind: 'ui' }> | SavedBaseForDesignSystem;

/** One token of a theme payload, with a font's digest in Templates' checked form. */
type ThemeToken = ThemePayload['tokens'][string];

/** One font token of a saved theme. */
type FontToken = Extract<ThemeToken, { readonly type: 'font' }>;

/** One token under its ID. */
type TokenEntry = readonly [string, ThemeToken];

/** One token under its ID, as Design System worked it out. */
type PortableTokenEntry = readonly [string, PortableToken];

/** Checks the input is a theme in exact form, then works out its full values. */
function resolveThemeInput(
  raw: unknown,
  available: readonly ThemePreset[],
  context: ThemeCodecContext,
): TemplatesResult<ThemePayload> {
  const input = exactTheme.safeParse(raw);
  if (!input.success) {
    return notAThemeFailure();
  }
  return resolveExactTheme(input.data, available, context);
}

/** Finds the base, has Design System work out every value, then checks the IDs and digests. */
function resolveExactTheme(
  input: ExactTheme,
  available: readonly ThemePreset[],
  context: ThemeCodecContext,
): TemplatesResult<ThemePayload> {
  const base = selectBase(input.base, available);
  if (!base.ok) {
    return base;
  }
  const resolved = context.system.resolveTheme({
    sources: context.sources,
    theme: { ...input, base: base.value },
  });
  if (!resolved.ok) {
    return designSystemRefusedFailure(resolved.error);
  }
  return checkThemePayload(resolved.value);
}

/** Answers the base Design System works from: interface tokens as they are, or a saved theme. */
function selectBase(
  base: ThemeBase,
  available: readonly ThemePreset[],
): TemplatesResult<DesignSystemBase> {
  if (base.kind === 'ui') {
    return success(base);
  }
  return findSavedBase(base, available);
}

/** Finds the saved theme the pin names, using its stored payload and fonts, never the input's. */
function findSavedBase(
  base: SavedBase,
  available: readonly ThemePreset[],
): TemplatesResult<DesignSystemBase> {
  const saved = available.find((theme) => isPinnedTheme(theme, base.pin));
  if (saved === undefined) {
    return missingBaseFailure();
  }
  const savedBase: SavedBaseForDesignSystem = {
    kind: 'preset',
    pin: base.pin,
    payload: saved.payload,
    fonts: baseFonts(saved),
  };
  return success(savedBase);
}

/** Whether the saved theme has exactly the pin's ID, version and digest. */
function isPinnedTheme(
  theme: ThemePreset,
  pin: SavedBase['pin'],
): boolean {
  return theme.id === pin.id && theme.version === pin.version && theme.digest === pin.digest;
}

/** Lists the saved theme's font tokens as approved fonts; they were checked when it was saved. */
function baseFonts(theme: ThemePreset): readonly BaseFont[] {
  const tokens = Object.values(theme.payload.tokens);
  const fontTokens = tokens.filter(isFontToken);
  return fontTokens.map(approvedFont);
}

/** Whether the token is a font. */
function isFontToken(token: ThemeToken): token is FontToken {
  return token.type === 'font';
}

/** Turns a saved font token into an approved font. */
function approvedFont(token: FontToken): BaseFont {
  return { family: token.family, digest: token.digest, approved: true };
}

/** Checks the worked-out theme's tokens and fonts with Templates, then its base pin. */
function checkThemePayload(resolved: PortableTheme): TemplatesResult<ThemePayload> {
  const tokens = checkTokens(resolved.tokens);
  if (!tokens.ok) {
    return tokens;
  }
  const fonts = checkFontDigests(resolved.fonts);
  if (!fonts.ok) {
    return fonts;
  }
  return buildPayloadWithCheckedBase(resolved, tokens.value, fonts.value);
}

/** Checks the base pin, then builds the payload from the checked tokens, fonts and base. */
function buildPayloadWithCheckedBase(
  resolved: PortableTheme,
  tokens: ThemePayload['tokens'],
  fonts: readonly PresetDigest[],
): TemplatesResult<ThemePayload> {
  const base = checkBasePin(resolved.base);
  if (!base.ok) {
    return base;
  }
  const payload: ThemePayload = { ...resolved, tokens, fonts, base: base.value };
  return success(payload);
}

/** Checks every token, and keeps each under its ID. */
function checkTokens(tokens: PortableTheme['tokens']): TemplatesResult<ThemePayload['tokens']> {
  const entries = Object.entries(tokens);
  const checked = collect(entries, checkTokenEntry);
  if (!checked.ok) {
    return checked;
  }
  const tokensById = Object.fromEntries(checked.value);
  return success(tokensById);
}

/** Checks every font digest, then keeps each digest once, sorted. */
function checkFontDigests(fonts: PortableTheme['fonts']): TemplatesResult<readonly PresetDigest[]> {
  const checked = collect(fonts, checkPresetDigest);
  if (!checked.ok) {
    return checked;
  }
  const unique = new Set(checked.value);
  const sorted = [...unique].toSorted();
  return success(sorted);
}

/** Checks one token, and keeps it under its ID. */
function checkTokenEntry(entry: PortableTokenEntry): TemplatesResult<TokenEntry> {
  const [tokenId, token] = entry;
  const checked = checkToken(token);
  if (!checked.ok) {
    return checked;
  }
  const checkedEntry: TokenEntry = [tokenId, checked.value];
  return success(checkedEntry);
}

/** Checks a font token's digest with Templates; any other token comes back as it is. */
function checkToken(token: PortableToken): TemplatesResult<ThemeToken> {
  if (token.type !== 'font') {
    return success(token);
  }
  const digest = checkPresetDigest(token.digest);
  if (!digest.ok) {
    return digest;
  }
  const checked: ThemeToken = { ...token, digest: digest.value };
  return success(checked);
}

/** Checks the base's exact pin with Templates; a theme with no base has `null`. */
function checkBasePin(base: PortableTheme['base']): TemplatesResult<ThemePayload['base']> {
  if (base === null) {
    return success(null);
  }
  return checkThemePin(base);
}

/** Makes the mistake for input that isn't a theme in exact form: `invalid-input` at `preset`. */
function notAThemeFailure(): TemplatesResult<never> {
  return codecFailure('Theme admission requires a base, fonts and overrides');
}

/** Makes the mistake for a base no saved theme matches: `invalid-input` at `preset`. */
function missingBaseFailure(): TemplatesResult<never> {
  return codecFailure('The exact base theme is unavailable');
}

/** Makes the mistake for a theme Design System refused, keeping Design System's own mistake. */
function designSystemRefusedFailure(source: CapabilityFailure): TemplatesResult<never> {
  return codecFailure(source.message, source);
}
