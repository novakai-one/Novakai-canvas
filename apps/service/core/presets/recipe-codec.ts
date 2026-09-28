/*
 * Why this file exists
 *
 * Templates saves recipes (diagram starters, such as `er`) but can't read DSL. So when a recipe
 * is saved, Language must check its DSL, print it in standard form, and list its theme and images.
 * When a recipe is used, for example by `pnpm canvas recipe instantiate`, Language expands it.
 *
 * This file is that recipe codec. Every mistake is `invalid-input` at `preset` (codec-refusal.ts),
 * with Language's own failure kept as the source. It never saves; Authoring does.
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
import { codecFailure } from './codec-refusal.js';
import { checkPresetDigest, checkThemePin } from './branded-pin.js';

/** What the recipe codec uses. */
export interface RecipeCodecContext {
  /** Language, to read (`lower`), print and expand a recipe's DSL. */
  readonly language: Pick<Language, 'lower' | 'print' | 'expand'>;
  /** The themes and images a recipe's names refer to; fixed for this codec. */
  readonly resources: ResolvedResources;
}

/**
 * Builds the recipe codec Templates uses. `inspect` checks a recipe's DSL and answers what
 * Templates saves: the printed DSL, its theme and its images. `expand` turns a saved recipe into
 * diagram content under `namespace`. Mistakes: `invalid-input` at `preset` when Language refuses
 * the DSL, or the theme pin or an image digest fails Templates' check. Neither throws.
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
  return codecFailure('Language rejected the preset source', result.error);
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
    checkPresetDigest(removeDigestPrefix(binding.digest)),
  );
  if (!assets.ok) return assets;
  const theme = checkThemePin({
    id: collection.theme.id,
    version: collection.theme.version,
    digest: removeDigestPrefix(collection.theme.digest),
  });
  return andThen(theme, (pin) =>
    success({ languageVersion: 1, source, family, assets: assets.value, themes: [pin] }),
  );
}
