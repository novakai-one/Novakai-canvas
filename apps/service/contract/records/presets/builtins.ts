import type { FontSet } from '@novakai/canvas-presentation';
import type { Catalog, RecipePayload } from '@novakai/canvas-templates';
/** Repository-owned source inputs are prepared for Authoring admission; reading/staging alone creates no canonical bindings. */
export interface BuiltinSources {
  readonly fonts: FontSet;
  readonly tokens: unknown;
  readonly recipes: readonly {
    readonly family: RecipePayload['family'];
    readonly source: string;
  }[];
}
export interface BuiltinResources extends BuiltinSources {
  readonly presets: Catalog;
}
