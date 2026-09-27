/*
 * The installation's shipped sources (fonts, token sources, recipe starters) and the resources
 * prepared from them. Declarations only; core/presets/builtin.ts prepares them and startup
 * Authoring admission owns commit and recovery.
 */
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
