/*
 * Why this file exists
 *
 * Templates saves themes but can't work out their colours, sizes and fonts. A theme only lists what
 * it changes: for example, `walkthrough` is `ink` with a different accent colour. Design System
 * works out every value from the base theme plus those changes, and checks the result.
 *
 * This file is that theme codec. Every mistake is `invalid-input` at `preset` (codec-refusal.ts),
 * with Design System's own failure kept as the source when it refused. It never saves.
 */
import type {
  DesignSystem,
  PortableTheme,
  PortableToken,
  TemplatesResult,
  ThemePayload,
  ThemePreset,
} from '../../contract/records/capability-types.js';
import type { PresetCodecs } from '../../contract/records/presets/codecs.js';
import { exactTheme, type ExactTheme } from '../../contract/records/presets/theme-input.js';
import { andThen, collect, success } from '../../contract/errors.js';
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
 * changes and its base, which must be a UI base or exactly one of the `available` themes.
 * Mistakes: `invalid-input` at `preset` when the input isn't a theme, the base isn't available,
 * Design System refuses the theme, or an ID, version or digest fails Templates' check.
 */
export function createThemeCodec(context: ThemeCodecContext): PresetCodecs['theme'] {
  return { resolve: (raw, available) => theme(raw, available, context) };
}

/**
 * The theme payload for one raw admission (see `resolvedTheme`). Fails with `invalid-input` at
 * `preset` ("Theme admission requires a base, fonts and overrides") when the input is not a
 * theme selection envelope.
 */
function theme(
  raw: unknown,
  available: readonly ThemePreset[],
  context: ThemeCodecContext,
): TemplatesResult<ThemePayload> {
  const input = exactTheme.safeParse(raw);
  if (!input.success) return codecFailure('Theme admission requires a base, fonts and overrides');
  return resolvedTheme(input.data, available, context);
}

/**
 * Resolves complete tokens through Design System over the exact base; a malformed selector
 * returns no partial theme. Fails with `invalid-input` at `preset` when the exact base is not
 * available, with Design System's message when it rejects the theme (its failure kept as
 * source), or as `checkedThemePayload` fails.
 */
function resolvedTheme(
  input: ExactTheme,
  available: readonly ThemePreset[],
  context: ThemeCodecContext,
): TemplatesResult<ThemePayload> {
  const base = selectedBase(input.base, available);
  if (!base.ok) return base;
  const result = context.system.resolveTheme({
    sources: context.sources,
    theme: { ...input, base: base.value },
  });
  if (!result.ok) return codecFailure(result.error.message, result.error);
  return checkedThemePayload(result.value);
}

/**
 * The base Design System resolves against: a UI base unchanged, or the stored preset whose ID,
 * version and digest all match, with its own payload and fonts (a caller-submitted payload is
 * ignored). Fails with `invalid-input` at `preset` ("The exact base theme is unavailable") when
 * no stored theme matches.
 */
function selectedBase(
  input: ExactTheme['base'],
  available: readonly ThemePreset[],
): TemplatesResult<unknown> {
  if (input.kind === 'ui') return success(input);
  const found = available.find(
    (item) =>
      item.id === input.pin.id &&
      item.version === input.pin.version &&
      item.digest === input.pin.digest,
  );
  if (!found) return codecFailure('The exact base theme is unavailable');
  return success({
    kind: 'preset',
    pin: input.pin,
    payload: found.payload,
    fonts: baseFonts(found),
  });
}

/** The stored theme's font tokens as approved font pins; they already passed owner admission. */
function baseFonts(
  theme: ThemePreset,
): readonly { readonly family: string; readonly digest: string; readonly approved: boolean }[] {
  return Object.values(theme.payload.tokens)
    .filter((value) => value.type === 'font')
    .map((value) => ({ family: value.family, digest: value.digest, approved: true }));
}

/** One token under its ID. */
type TokenEntry = readonly [string, ThemePayload['tokens'][string]];

/**
 * The theme payload with Templates brands on font digests, the sorted unique font set and the
 * base pin; token values are unchanged. Fails with `invalid-input` at `preset` ("Preset provider
 * returned invalid identity or token data") when an identity does not match its Templates schema.
 */
function checkedThemePayload(resolved: PortableTheme): TemplatesResult<ThemePayload> {
  const tokens = collect(Object.entries(resolved.tokens), tokenEntry);
  if (!tokens.ok) return tokens;
  const fonts = collect(resolved.fonts, checkPresetDigest);
  if (!fonts.ok) return fonts;
  return andThen(basePin(resolved.base), (base) =>
    success({
      ...resolved,
      tokens: Object.fromEntries(tokens.value),
      fonts: [...new Set(fonts.value)].toSorted(),
      base,
    }),
  );
}

/** One token under its ID, its digest branded when it is a font (see `token`). */
function tokenEntry([id, entry]: readonly [string, PortableToken]): TemplatesResult<TokenEntry> {
  return andThen(token(entry), (branded) => success([id, branded] as const));
}

/**
 * A font token with its digest branded; other tokens unchanged. Fails with `invalid-input` at
 * `preset` on a malformed digest.
 */
function token(entry: PortableToken): TemplatesResult<ThemePayload['tokens'][string]> {
  if (entry.type !== 'font') return success(entry);
  return andThen(checkPresetDigest(entry.digest), (digest) => success({ ...entry, digest }));
}

/**
 * The exact base pin with Templates brands, or `null` for no base. Fails with `invalid-input` at
 * `preset` on a malformed identity.
 */
function basePin(base: PortableTheme['base']): TemplatesResult<ThemePayload['base']> {
  if (base === null) return success(null);
  return checkThemePin(base);
}
