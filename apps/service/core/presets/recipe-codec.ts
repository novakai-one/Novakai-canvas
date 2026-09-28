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
import type { PresetDigest } from '../../contract/brands.js';
import type {
  Language,
  LanguageError,
  LanguageResult,
  LoweredIntent,
  PresetPin,
  RecipePayload,
  ResolvedResources,
  TemplatesResult,
} from '../../contract/records/capability-types.js';
import type { PresetCodecs } from '../../contract/records/presets/codecs.js';
import { collect, success } from '../../contract/errors.js';
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
    inspect: (source, family) => inspectRecipe(source, family, context),
    expand: (source, namespace) => expandRecipe(source, namespace, context),
  };
}

/** The preset ID a used recipe's names are placed under; Templates checked it. */
type RecipeNamespace = Parameters<PresetCodecs['recipe']['expand']>[1];

/** A diagram as Language read it from a recipe's DSL. */
type RecipeDiagram = LoweredIntent['collection'];

/** One image a recipe's diagram shows, with its digest as Model writes it (`sha256:` first). */
type ImageBinding = RecipeDiagram['assets'][number];

/** The DSL version Language reads recipes as. */
const RECIPE_LANGUAGE_VERSION = 1;

/** Has Language read and print the recipe's DSL, then lists the theme and images it uses. */
function inspectRecipe(
  source: string,
  family: RecipePayload['family'],
  context: RecipeCodecContext,
): TemplatesResult<RecipePayload> {
  const lowered = lowerRecipe(source, context);
  if (!lowered.ok) {
    return lowered;
  }
  const printed = printRecipe(lowered.value.collection, context);
  if (!printed.ok) {
    return printed;
  }
  return buildRecipePayload(lowered.value.collection, printed.value, family);
}

/** Has Language expand a saved recipe into diagram content under `namespace`. */
function expandRecipe(
  source: string,
  namespace: RecipeNamespace,
  context: RecipeCodecContext,
): TemplatesResult<LoweredIntent> {
  const expanded = context.language.expand({ source, namespace, resources: context.resources });
  return checkLanguageAnswer(expanded);
}

/** Has Language read the recipe's DSL as a new diagram. */
function lowerRecipe(
  source: string,
  context: RecipeCodecContext,
): TemplatesResult<LoweredIntent> {
  const lowered = context.language.lower({
    source,
    mode: 'create',
    snapshot: null,
    resources: context.resources,
  });
  return checkLanguageAnswer(lowered);
}

/** Has Language print the recipe's diagram as standard DSL. */
function printRecipe(
  diagram: RecipeDiagram,
  context: RecipeCodecContext,
): TemplatesResult<string> {
  const printed = context.language.print({ collection: diagram, scope: { kind: 'all' } });
  if (!printed.ok) {
    return languageRefusedFailure(printed.error);
  }
  return success(printed.value.source);
}

/** Gives back Language's answer, or turns its refusal into the codec's mistake. */
function checkLanguageAnswer<Answer>(answer: LanguageResult<Answer>): TemplatesResult<Answer> {
  if (!answer.ok) {
    return languageRefusedFailure(answer.error);
  }
  return answer;
}

/**
 * Checks the image digests and the theme pin with Templates, then builds what Templates saves for
 * a recipe: the printed DSL, its images and its one theme.
 */
function buildRecipePayload(
  diagram: RecipeDiagram,
  source: string,
  family: RecipePayload['family'],
): TemplatesResult<RecipePayload> {
  const assets = collect(diagram.assets, checkImageDigest);
  if (!assets.ok) {
    return assets;
  }
  const theme = checkRecipeTheme(diagram.theme);
  if (!theme.ok) {
    return theme;
  }
  const payload: RecipePayload = {
    languageVersion: RECIPE_LANGUAGE_VERSION,
    source,
    family,
    assets: assets.value,
    themes: [theme.value],
  };
  return success(payload);
}

/** Checks one image's digest with Templates, after removing Model's `sha256:`. */
function checkImageDigest(image: ImageBinding): TemplatesResult<PresetDigest> {
  const digest = removeDigestPrefix(image.digest);
  return checkPresetDigest(digest);
}

/** Checks the recipe's theme pin with Templates, after removing Model's `sha256:`. */
function checkRecipeTheme(theme: RecipeDiagram['theme']): TemplatesResult<PresetPin> {
  const digest = removeDigestPrefix(theme.digest);
  return checkThemePin({ id: theme.id, version: theme.version, digest });
}

/** Makes the mistake for DSL Language refused: `invalid-input` at `preset`, Language's kept. */
function languageRefusedFailure(source: LanguageError): TemplatesResult<never> {
  return codecFailure('Language rejected the preset source', source);
}
