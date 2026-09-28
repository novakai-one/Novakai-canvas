/*
 * The recipe codec Templates admits recipes with. Language lowers the source in create mode and
 * prints it canonically; the dependency pins come from the lowered collection; Templates brands
 * are minted after Language has checked the source. Pure over the injected context. Every failure
 * is Templates' `invalid-input` at `preset` (codec-refusal.ts): the caller keeps the source,
 * corrects it and prepares again; Authoring owns commit.
 */
import { removeDigestPrefix } from '../../contract/brands.js';
import type {
  Language,
  LanguageResult,
  LoweredIntent,
  RecipePayload,
  ResolvedResources,
  TemplatesResult,
} from '../../contract/records/capability-types.js';
import type { PresetCodecs } from '../../contract/records/presets/codecs.js';
import { andThen, collect, success } from '../../contract/errors.js';
import { rejected } from './codec-refusal.js';
import { brandedDigest, brandedThemePin } from './branded-pin.js';

/** What the recipe codec reads: Language to lower, print and expand, and the bound resources. */
export interface RecipeCodecContext {
  readonly language: Pick<Language, 'lower' | 'print' | 'expand'>;
  /** The theme and asset bindings a recipe's aliases resolve to; fixed for this binding. */
  readonly resources: ResolvedResources;
}

/**
 * Binds the recipe codec to one context. `inspect` and `expand` fail with `invalid-input` at
 * `preset` when Language rejects the source (Language's failure kept as source); `inspect` also
 * fails with `invalid-input` at `preset` ("Preset provider returned invalid identity or token
 * data") when a pinned identity is not a Templates brand. Neither throws.
 */
export function createRecipeCodec(context: RecipeCodecContext): PresetCodecs['recipe'] {
  return {
    inspect: (source, family) => inspected(source, family, context),
    expand: (source, namespace) =>
      translated(context.language.expand({ source, namespace, resources: context.resources })),
  };
}

/**
 * The recipe payload for one source: lowered in create mode, then printed canonically; the
 * dependency pins come from the lowered collection. Fails with `invalid-input` at `preset` when
 * Language rejects the source or its printing (Language's failure kept as source), or as
 * `recipePayload` fails.
 */
function inspected(
  source: string,
  family: RecipePayload['family'],
  context: RecipeCodecContext,
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
 * The recipe payload from a lowered collection (language version 1): its asset digests and its
 * one theme pin, each with the `sha256:` prefix removed and Templates' brand minted. Templates
 * later checks dependency closure. Fails with `invalid-input` at `preset` ("Preset provider
 * returned invalid identity or token data") when a pinned identity does not match its Templates
 * schema.
 */
function recipePayload(
  intent: LoweredIntent,
  source: string,
  family: RecipePayload['family'],
): TemplatesResult<RecipePayload> {
  const collection = intent.collection;
  const assets = collect(collection.assets, (binding) =>
    brandedDigest(removeDigestPrefix(binding.digest)),
  );
  if (!assets.ok) return assets;
  const theme = brandedThemePin({
    id: collection.theme.id,
    version: collection.theme.version,
    digest: removeDigestPrefix(collection.theme.digest),
  });
  return andThen(theme, (pin) =>
    success({ languageVersion: 1, source, family, assets: assets.value, themes: [pin] }),
  );
}
