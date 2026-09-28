/*
 * Why this file exists
 *
 * The service ships its own fonts, design tokens and recipe starters in `resources/`, and every new
 * workspace starts with them. For example, every workspace has the Paper and Ink themes, made from
 * the shipped tokens and fonts.
 *
 * This file declares what is read from `resources/` (`BuiltinSources`), the shipped fonts by role
 * (`BuiltinFonts`), and those sources with the preset catalog made from them (`BuiltinResources`).
 * Declarations only. Reading them saves nothing; start-up saves the catalog through Authoring.
 */
import type { FontSet, FontSource } from '@novakai/canvas-presentation';
import type { Catalog, RecipePayload } from '@novakai/canvas-templates';

/** What the service reads from `resources/` at start-up. Reading them saves nothing. */
export interface BuiltinSources {
  /**
   * The shipped fonts in role order: body, mono, strong. This array is the
   * `/api/v1/installation` wire; core/presets/builtin.ts names the roles (`BuiltinFonts`).
   */
  readonly fonts: FontSet;
  /** The design token sources, as read from disk; Design System checks them on every use. */
  readonly tokens: unknown;
  /** Each recipe starter: its family (the kind of diagram it starts) and its DSL text. */
  readonly recipes: readonly {
    readonly family: RecipePayload['family'];
    readonly source: string;
  }[];
}

/** The shipped fonts by the role they play: body text, monospace text and strong text. */
export interface BuiltinFonts {
  readonly body: FontSource;
  readonly mono: FontSource;
  readonly strong: FontSource;
}

/** The shipped sources, and the preset catalog (themes and recipes) made from them. */
export interface BuiltinResources extends BuiltinSources {
  readonly presets: Catalog;
}
