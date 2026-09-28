/*
 * The installation's shipped sources (fonts, token sources, recipe starters), the shipped fonts
 * by role, and the resources prepared from them. Declarations only; core/presets/builtin.ts
 * prepares them and startup Authoring admission owns commit and recovery.
 */
import type { FontSet, FontSource } from '@novakai/canvas-presentation';
import type { Catalog, RecipePayload } from '@novakai/canvas-templates';

/** Repository-owned source inputs are prepared for Authoring admission; reading/staging alone creates no canonical bindings. */
export interface BuiltinSources {
  /**
   * The shipped fonts in role order: body, mono, strong. This array is the
   * `/api/v1/installation` wire; core/presets/builtin.ts names the roles (`BuiltinFonts`).
   */
  readonly fonts: FontSet;
  readonly tokens: unknown;
  readonly recipes: readonly {
    readonly family: RecipePayload['family'];
    readonly source: string;
  }[];
}

/** The shipped fonts by role: body text, monospace text and strong text. */
export interface BuiltinFonts {
  readonly body: FontSource;
  readonly mono: FontSource;
  readonly strong: FontSource;
}

/** The shipped sources with the preset catalog prepared from them. */
export interface BuiltinResources extends BuiltinSources {
  readonly presets: Catalog;
}
