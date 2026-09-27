import type { FontSet } from '@novakai/canvas-presentation';
import type { DesignSystem } from '@novakai/canvas-design-system';
import type { Catalog, RecipePayload, Templates } from '@novakai/canvas-templates';
import type { LoweredIntent, ResolvedResources } from '@novakai/canvas-language';
/** Repository-owned source inputs are prepared for Authoring admission; reading/staging alone creates no canonical bindings. */
export interface BuiltinSources {
  readonly fonts: FontSet;
  readonly tokens: unknown;
  readonly recipes: readonly {
    readonly family: RecipePayload['family'];
    readonly source: string;
  }[];
}
/** The slice of ServiceCapabilities builtin preparation uses: UI token resolution and preset admission. */
export interface BuiltinPresetOwners {
  readonly system: Pick<DesignSystem, 'resolve'>;
  templates(resources: ResolvedResources): Pick<Templates<LoweredIntent>, 'planAdmission'>;
}
export interface BuiltinResources extends BuiltinSources {
  readonly presets: Catalog;
}
