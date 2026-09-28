/*
 * Why this file exists
 *
 * Templates stores themes and recipes (together, "presets"), but it can't read DSL or resolve
 * design tokens itself. It asks two codecs: the recipe codec reads and prints a recipe's DSL text,
 * and the theme codec resolves a theme's tokens against its base theme.
 *
 * This file declares the pair (`PresetCodecs`) and what one pair is made for (`PresetContext`).
 * core/presets builds them. Declarations only.
 */
import type { DesignSystem } from '@novakai/canvas-design-system';
import type { Language, ResolvedResources, LoweredIntent } from '@novakai/canvas-language';
import type { RecipePort, ThemePort } from '@novakai/canvas-templates';
/**
 * What one pair of codecs is made for. Fixed when made: a pair only knows the themes it was given,
 * so a newly saved theme needs a new pair.
 */
export interface PresetContext {
  /** Design System, to resolve themes and tokens. */
  readonly system: Pick<DesignSystem, 'resolveTheme' | 'resolve'>;
  /** The design token sources, as read from disk. Design System checks them on every call. */
  readonly sources: unknown;
  /** Reads and prints DSL. */
  readonly language: Language;
  /** The themes and files the request uses. */
  readonly resources: ResolvedResources;
}
/** The recipe codec and the theme codec Templates is built with. */
export interface PresetCodecs {
  readonly recipe: RecipePort<LoweredIntent>;
  readonly theme: ThemePort;
}
