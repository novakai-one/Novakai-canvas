/*
 * The recipe and theme codecs Templates admits presets with. Recipes are lowered and printed by
 * Language; themes are resolved by Design System against an exact base; Templates brands are
 * minted after the owner has checked the data. Pure over the injected context. Every failure is
 * Templates' `invalid-input` at `preset`: the caller keeps the source, corrects it and prepares
 * again; Authoring owns commit.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import { presetId, presetVersion, presetDigest } from '../../contract/schemas.js';
import type {
  LanguageResult,
  LoweredIntent,
  PortableTheme,
  PortableToken,
  RecipePayload,
  TemplatesResult,
  ThemePayload,
  ThemePreset,
} from '../../contract/records/capabilities.js';
import type { PresetCodecs, PresetContext } from '../../contract/records/presets/codecs.js';
import { themeInput, type ThemeInput } from '../../contract/records/presets/theme-input.js';

/**
 * Binds the recipe and theme codecs to one preset context. `recipe.inspect` and `theme.resolve`
 * never throw: a throw inside them becomes `invalid-input` at `preset` ("Preset provider returned
 * invalid identity or token data"). `recipe.expand` fails with `invalid-input` at `preset` when
 * Language rejects the source (Language's failure kept as source).
 */
export function createPresetCodecs(context: PresetContext): PresetCodecs {
  return {
    recipe: {
      inspect: (source, family) => guarded(() => inspected(source, family, context)),
      expand: (source, namespace) =>
        translated(context.language.expand({ source, namespace, resources: context.resources })),
    },
    theme: { resolve: (raw, available) => guarded(() => theme(raw, available, context)) },
  };
}

/**
 * The recipe payload for one source: lowered in create mode, then printed canonically; the
 * dependency pins come from the lowered collection. Fails with `invalid-input` at `preset` when
 * Language rejects the source or its printing (Language's failure kept as source). Throws when a
 * pinned identity is not a Templates brand.
 */
function inspected(
  source: string,
  family: RecipePayload['family'],
  context: PresetContext,
): TemplatesResult<RecipePayload> {
  const lowered = translated(
    context.language.lower({
      source,
      mode: 'create',
      snapshot: null,
      resources: context.resources,
    }),
  );
  if (!lowered.ok) return lowered;
  const printed = translated(
    context.language.print({ collection: lowered.value.collection, scope: { kind: 'all' } }),
  );
  if (!printed.ok) return printed;
  return recipePayload(lowered.value, printed.value.source, family);
}

/**
 * Language's value unchanged, or `invalid-input` at `preset` ("Language rejected the preset
 * source") with Language's failure kept as source.
 */
function translated<T>(result: LanguageResult<T>): TemplatesResult<T> {
  if (result.ok) return result;
  return rejected('Language rejected the preset source', result.error);
}

/**
 * The recipe payload from a lowered collection: its asset digests and its one theme pin, each
 * with the `sha256:` prefix removed. Templates later checks digest syntax and dependency closure.
 * Never fails; throws when a pinned identity is not a Templates brand.
 */
function recipePayload(
  intent: LoweredIntent,
  source: string,
  family: RecipePayload['family'],
): TemplatesResult<RecipePayload> {
  const theme = intent.collection.theme;
  const payload = {
    languageVersion: 1,
    source,
    family,
    assets: intent.collection.assets.map((item) => item.digest.slice(7)),
    themes: [
      { kind: 'theme', id: theme.id, version: theme.version, digest: theme.digest.slice(7) },
    ],
  };
  return checkedPayload(payload);
}

/**
 * Mints the Templates brands for the payload's asset digests and theme pins (language version
 * 1). Never fails; throws when an identity does not match its Templates schema.
 */
function checkedPayload(input: {
  readonly languageVersion: number;
  readonly source: string;
  readonly family: RecipePayload['family'];
  readonly assets: readonly string[];
  readonly themes: readonly {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  }[];
}): TemplatesResult<RecipePayload> {
  return {
    ok: true,
    value: {
      languageVersion: 1,
      source: input.source,
      family: input.family,
      assets: input.assets.map((value) => presetDigest.parse(value)),
      themes: input.themes.map((pin) => ({
        kind: 'theme',
        id: presetId.parse(pin.id),
        version: presetVersion.parse(pin.version),
        digest: presetDigest.parse(pin.digest),
      })),
    },
  };
}

/**
 * The theme payload for one raw admission (see `resolvedTheme`). Fails with `invalid-input` at
 * `preset` ("Theme admission requires a base, fonts and overrides") when the input is not a
 * theme selection envelope.
 */
function theme(
  raw: unknown,
  available: readonly ThemePreset[],
  context: PresetContext,
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
  context: PresetContext,
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
  if (input.kind === 'ui') return { ok: true, value: input };
  const found = available.find(
    (item) =>
      item.id === input.pin.id &&
      item.version === input.pin.version &&
      item.digest === input.pin.digest,
  );
  if (!found) return rejected('The exact base theme is unavailable');
  return {
    ok: true,
    value: { kind: 'preset', pin: input.pin, payload: found.payload, fonts: baseFonts(found) },
  };
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
function checkedThemePayload(value: PortableTheme): TemplatesResult<ThemePayload> {
  return {
    ok: true,
    value: {
      ...value,
      tokens: Object.fromEntries(
        Object.entries(value.tokens).map(([id, value]) => [id, token(value)]),
      ),
      fonts: [...new Set(value.fonts.map((value) => presetDigest.parse(value)))].toSorted(),
      base: basePin(value.base),
    },
  };
}

/** A font token with its digest branded; other tokens unchanged. Throws on a malformed digest. */
function token(value: PortableToken): ThemePayload['tokens'][string] {
  if (value.type !== 'font') return value;
  return { ...value, digest: presetDigest.parse(value.digest) };
}

/** The exact base pin with Templates brands, or `null` for no base. Throws on a malformed identity. */
function basePin(base: PortableTheme['base']): ThemePayload['base'] {
  if (base === null) return null;
  return {
    kind: 'theme',
    id: presetId.parse(base.id),
    version: presetVersion.parse(base.version),
    digest: presetDigest.parse(base.digest),
  };
}

/**
 * The operation's result, or `invalid-input` at `preset` ("Preset provider returned invalid
 * identity or token data") when it throws.
 */
function guarded<T>(operation: () => TemplatesResult<T>): TemplatesResult<T> {
  try {
    return operation();
  } catch {
    return rejected('Preset provider returned invalid identity or token data');
  }
}

/** The codec failure: `invalid-input` at `preset` with this message and the owner's failure, if any. */
function rejected<T>(
  message: string,
  source?: FailureSource,
): TemplatesResult<T> {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      source,
      path: 'preset',
      message,
      recovery: 'Retain the source; correct the named preset input and prepare again.',
    },
  };
}
