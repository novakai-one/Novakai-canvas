import type { DesignSystem } from '@novakai/canvas-design-system';
import type { Language, ResolvedResources, LoweredIntent } from '@novakai/canvas-language';
import type { RecipePort, ThemePort } from '@novakai/canvas-templates';
/** A codec snapshot is immutable; newly admitted pins require a new binding rather than hidden mutable resource lookup. */
export interface PresetContext {
  readonly system: Pick<DesignSystem, 'resolveTheme' | 'resolve'>;
  /** Raw source envelope is revalidated by every Design System operation. */
  readonly sources: unknown;
  readonly language: Language;
  readonly resources: ResolvedResources;
}
export interface PresetCodecs {
  readonly recipe: RecipePort<LoweredIntent>;
  readonly theme: ThemePort;
}
