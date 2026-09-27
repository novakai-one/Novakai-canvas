import type { FontSet } from '@novakai/canvas-presentation';
import type { Catalog, RecipePayload, Templates } from '@novakai/canvas-templates';
import type { LoweredIntent } from '@novakai/canvas-language';
import type { PresetContext } from './codecs.js';
/** Repository-owned source inputs are prepared for Authoring admission; reading/staging alone creates no canonical bindings. */
export interface BuiltinSources {
  readonly fonts: FontSet;
  readonly tokens: unknown;
  readonly recipes: readonly {
    readonly family: RecipePayload['family'];
    readonly source: string;
  }[];
}
export interface BuiltinPresetOwners {
  readonly context: PresetContext;
  templates(context: PresetContext): Templates<LoweredIntent>;
}
export interface BuiltinResources extends BuiltinSources {
  readonly presets: Catalog;
}
