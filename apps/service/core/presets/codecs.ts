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
/** Codec failures leave immutable preset admission uncommitted; Authoring callers correct the source or selected base. */
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
/** Compiler diagnostics remain typed through preset admission; display adapters choose how to present them. */
function translated<T>(result: LanguageResult<T>): TemplatesResult<T> {
  if (result.ok) return result;
  return rejected('Language rejected the preset source', result.error);
}
/** Canonical printing supplies recipe source; dependency pins come from the actual lowered collection. */
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
/** Templates validates returned digest syntax and dependency closure before admitting this ordinary editable recipe. */
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
/** Owner public validation is supplied by Templates after inspection; branded identities are minted at the declared schema seam. */
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
/** Use the authoritative base payload; caller-submitted copies cannot impersonate a different pinned base. */
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
/** Resolve complete tokens through Design System; malformed selectors return no partially normalized theme. */
function theme(
  raw: unknown,
  available: readonly ThemePreset[],
  context: PresetContext,
): TemplatesResult<ThemePayload> {
  const input = themeInput.safeParse(raw);
  if (!input.success) return rejected('Theme admission requires a base, fonts and overrides');
  return resolvedTheme(input.data, available, context);
}
/** Design System owns contrast, dependency formulas and font admission; Templates subsequently owns immutable identity. */
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
/** Stable snapshot codecs keep recipe parsing/remapping and theme semantics at their public owners. */
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

/** Public owner data carries string digests; Templates brands are minted without copying or altering token semantics. */
function token(value: PortableToken): ThemePayload['tokens'][string] {
  if (value.type !== 'font') return value;
  return { ...value, digest: presetDigest.parse(value.digest) };
}
/** Portable base pins are exact owner identities, never aliases resolved against a changing latest version. */
function basePin(base: PortableTheme['base']): ThemePayload['base'] {
  if (base === null) return null;
  return {
    kind: 'theme',
    id: presetId.parse(base.id),
    version: presetVersion.parse(base.version),
    digest: presetDigest.parse(base.digest),
  };
}
/** Translate identity brands after Design System validation; no second token rule is introduced in the bridge. */
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
/** Invalid owner/provider output rejects admission; caller keeps the source and repairs the named resource. */
function guarded<T>(operation: () => TemplatesResult<T>): TemplatesResult<T> {
  try {
    return operation();
  } catch {
    return rejected('Preset provider returned invalid identity or token data');
  }
}

/** Exact catalog payloads have already passed owner admission; retain their original font evidence while choosing replacements. */
function baseFonts(
  theme: ThemePreset,
): readonly { readonly family: string; readonly digest: string; readonly approved: boolean }[] {
  return Object.values(theme.payload.tokens)
    .filter((value) => value.type === 'font')
    .map((value) => ({ family: value.family, digest: value.digest, approved: true }));
}
