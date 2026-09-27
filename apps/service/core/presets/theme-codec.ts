/*
 * The theme codec Templates admits themes with. Design System resolves the theme against an exact
 * base; Templates brands are minted after Design System has checked the tokens. Pure over the
 * injected context. Every failure is Templates' `invalid-input` at `preset` (codec-refusal.ts):
 * the caller keeps the source, corrects it and prepares again; Authoring owns commit.
 */
import { presetDigest } from '../../contract/schemas.js';
import type {
  DesignSystem,
  PortableTheme,
  PortableToken,
  TemplatesResult,
  ThemePayload,
  ThemePreset,
} from '../../contract/records/capabilities.js';
import type { PresetCodecs } from '../../contract/records/presets/codecs.js';
import { themeInput, type ThemeInput } from '../../contract/records/presets/theme-input.js';
import { success } from '../../contract/errors.js';
import { guarded, rejected } from './codec-refusal.js';
import { brandedThemePin } from './theme-pin.js';

/** What the theme codec reads: Design System to resolve a theme, and the token sources. */
export interface ThemeCodecContext {
  readonly system: Pick<DesignSystem, 'resolveTheme'>;
  /** The raw token source envelope; Design System revalidates it on every call. */
  readonly sources: unknown;
}

/**
 * Binds the theme codec to one context. `resolve` never throws: a throw inside it becomes
 * `invalid-input` at `preset` ("Preset provider returned invalid identity or token data"). Other
 * failures are listed on `theme`.
 */
export function createThemeCodec(context: ThemeCodecContext): PresetCodecs['theme'] {
  return { resolve: (raw, available) => guarded(() => theme(raw, available, context)) };
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
  const input = themeInput.safeParse(raw);
  if (!input.success) return rejected('Theme admission requires a base, fonts and overrides');
  return resolvedTheme(input.data, available, context);
}

/**
 * Resolves complete tokens through Design System over the exact base; a malformed selector
 * returns no partial theme. Fails with `invalid-input` at `preset` when the exact base is not
 * available, or with Design System's message when it rejects the theme (its failure kept as
 * source). Throws when an identity is not a Templates brand.
 */
function resolvedTheme(
  input: ThemeInput,
  available: readonly ThemePreset[],
  context: ThemeCodecContext,
): TemplatesResult<ThemePayload> {
  const base = selectedBase(input.base, available);
  if (!base.ok) return base;
  const result = context.system.resolveTheme({
    sources: context.sources,
    theme: { ...input, base: base.value },
  });
  if (!result.ok) return rejected(result.error.message, result.error);
  return checkedThemePayload(result.value);
}

/**
 * The base Design System resolves against: a UI base unchanged, or the stored preset whose ID,
 * version and digest all match, with its own payload and fonts (a caller-submitted payload is
 * ignored). Fails with `invalid-input` at `preset` ("The exact base theme is unavailable") when
 * no stored theme matches.
 */
function selectedBase(
  input: ThemeInput['base'],
  available: readonly ThemePreset[],
): TemplatesResult<unknown> {
  if (input.kind === 'ui') return success(input);
  const found = available.find(
    (item) =>
      item.id === input.pin.id &&
      item.version === input.pin.version &&
      item.digest === input.pin.digest,
  );
  if (!found) return rejected('The exact base theme is unavailable');
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

/**
 * The theme payload with Templates brands on font digests, the sorted unique font set and the
 * base pin; token values are unchanged. Never fails; throws when an identity does not match its
 * Templates schema.
 */
function checkedThemePayload(resolved: PortableTheme): TemplatesResult<ThemePayload> {
  return success({
    ...resolved,
    tokens: Object.fromEntries(
      Object.entries(resolved.tokens).map(([id, entry]) => [id, token(entry)]),
    ),
    fonts: [...new Set(resolved.fonts.map((font) => presetDigest.parse(font)))].toSorted(),
    base: basePin(resolved.base),
  });
}

/** A font token with its digest branded; other tokens unchanged. Throws on a malformed digest. */
function token(entry: PortableToken): ThemePayload['tokens'][string] {
  if (entry.type !== 'font') return entry;
  return { ...entry, digest: presetDigest.parse(entry.digest) };
}

/**
 * The exact base pin with Templates brands, or `null` for no base. Throws on a malformed
 * identity.
 */
function basePin(base: PortableTheme['base']): ThemePayload['base'] {
  if (base === null) return null;
  return brandedThemePin(base);
}
