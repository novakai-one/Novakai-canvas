/*
 * The installation's built-in presets: the Paper and Ink themes and one recipe per shipped
 * starter, admitted through Templates into one catalog. Nothing is written here. Pure over the
 * injected owners; startup submits the catalog through Authoring, which owns commit and recovery.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type {
  Catalog,
  DesignSystem,
  FontSource,
  LoweredIntent,
  RecipePayload,
  ResolvedResources,
  Templates,
} from '../../contract/records/capabilities.js';
import type {
  BuiltinFonts,
  BuiltinSources,
  BuiltinResources,
} from '../../contract/records/presets/builtins.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { EMPTY_RESOURCES } from '../../contract/ports/capabilities.js';
import { themeBinding, type BindingModel } from './theme-binding.js';

/** The slice of ServiceCapabilities builtin preparation uses: theme binding, UI token resolution and preset admission. */
export interface BuiltinPresetOwners {
  readonly model: BindingModel;
  readonly system: Pick<DesignSystem, 'resolve'>;
  templates(resources: ResolvedResources): Pick<Templates<LoweredIntent>, 'planAdmission'>;
}

/**
 * Prepares the complete installation preset set.
 *
 * Steps:
 * 1. Name the shipped fonts by role (see `fontRoles`).
 * 2. Admit Paper (light) and Ink (dark) with those fonts.
 * 3. Admit each shipped recipe against those two themes.
 *
 * Returns the sources, unchanged, with the admitted catalog. Fails with `invalid-input` at
 * `builtins` when a shipped font is missing or an owner rejects a shipped input (the owner's
 * failure kept as source), and with `unavailable` at `builtins` when a provider throws anything
 * else.
 */
export function prepareBuiltinPresets(
  sources: BuiltinSources,
  owners: BuiltinPresetOwners,
): Result<BuiltinResources> {
  const fonts = fontRoles(sources.fonts);
  if (!fonts.ok) return fonts;
  const themeSources: ThemeSources = { tokens: sources.tokens, fonts: fonts.value };
  try {
    const themes = (['light', 'dark'] as const).reduce<Catalog>(
      (catalog, scheme) => addTheme(catalog, scheme, themeSources, owners),
      [],
    );
    const presets = sources.recipes.reduce(
      (catalog, recipe) => addRecipe(catalog, recipe, owners),
      themes,
    );
    return success({ ...sources, presets });
  } catch (error) {
    return preparationFailure(error);
  }
}

/** What each bundled theme is built from: the Design System token sources and the fonts by role. */
interface ThemeSources {
  readonly tokens: BuiltinSources['tokens'];
  readonly fonts: BuiltinFonts;
}

/**
 * Names the shipped fonts by role, in their wire order: body, mono, strong. Fails with
 * `invalid-input` at `builtins` ("All shipped fonts are required") when fewer than three fonts are
 * shipped; a missing font never falls back to the OS.
 */
function fontRoles(fonts: BuiltinSources['fonts']): Result<BuiltinFonts> {
  const [body, mono, strong] = fonts;
  if (!body || !mono || !strong)
    return failure('invalid-input', 'builtins', 'All shipped fonts are required');
  return success({ body, mono, strong });
}

/** A colour scheme with one bundled theme. */
type Scheme = 'light' | 'dark';

/**
 * The bundled theme for each scheme: Paper for light, Ink for dark. Every scheme has a theme
 * (checked by the type).
 */
const bundledThemes: Readonly<Record<Scheme, { readonly id: string; readonly title: string }>> =
  Object.freeze({ light: { id: 'paper', title: 'Paper' }, dark: { id: 'ink', title: 'Ink' } });

/**
 * Admits the scheme's bundled theme (see `bundledThemes`) at version 1.1.0; Templates computes
 * its content hash. Returns the candidate catalog. Throws `PresetFault` when Design System or
 * Templates rejects the input.
 */
function addTheme(
  catalog: Catalog,
  scheme: Scheme,
  sources: ThemeSources,
  owners: BuiltinPresetOwners,
): Catalog {
  const theme = bundledThemes[scheme];
  const templates = owners.templates(EMPTY_RESOURCES);
  return accepted(
    templates.planAdmission(catalog, {
      schemaVersion: 1,
      kind: 'theme',
      id: theme.id,
      version: '1.1.0',
      title: theme.title,
      description: 'Bundled diagram theme with pinned fonts.',
      raw: themeInput(sources, scheme, owners),
    }),
  ).candidate;
}

/**
 * The theme's raw input: the Design System UI pin resolved for this scheme under default system
 * preferences (personal preferences never become diagram dependencies), the three shipped fonts
 * and no overrides. Throws `PresetFault` when Design System rejects the token sources.
 */
function themeInput(
  sources: ThemeSources,
  scheme: Scheme,
  owners: BuiltinPresetOwners,
): unknown {
  const ui = accepted(
    owners.system.resolve({
      scope: 'ui',
      sources: sources.tokens,
      preferences: {
        schemaVersion: 1,
        theme: { mode: 'system' },
        textSize: 14,
        density: 'comfortable',
        motion: 'system',
      },
      environment: { scheme, pointer: 'fine', reducedMotion: false, forcedColors: false },
    }),
  );
  return {
    base: { kind: 'ui', pin: ui.provenance.ui },
    fonts: fontPins(sources.fonts),
    overrides: {},
  };
}

/** One theme font pin: the family Assets verified and its digest, approved. */
interface FontPin {
  readonly family: string;
  readonly digest: FontSource['digest'];
  readonly approved: true;
}

/** The theme's body, mono and strong font pins, in that order. */
function fontPins(fonts: BuiltinFonts): Readonly<Record<keyof BuiltinFonts, FontPin>> {
  return { body: fontPin(fonts.body), mono: fontPin(fonts.mono), strong: fontPin(fonts.strong) };
}

/** The pin of one shipped font. */
function fontPin(font: FontSource): FontPin {
  return { family: font.family, digest: font.digest, approved: true };
}

/**
 * Admits one shipped recipe (ID and title are its family) at version 1.0.0, inspected against
 * the exact themes already in the catalog and no assets. Returns the candidate catalog. Throws
 * `PresetFault` when Model or Templates rejects the input.
 */
function addRecipe(
  catalog: Catalog,
  recipe: { readonly family: RecipePayload['family']; readonly source: string },
  owners: BuiltinPresetOwners,
): Catalog {
  const resources = {
    themes: Object.fromEntries(
      catalog
        .filter((item) => item.kind === 'theme')
        .map((item) => [item.id, accepted(themeBinding(item, owners.model))]),
    ),
    assets: {},
  };
  const templates = owners.templates(resources);
  return accepted(
    templates.planAdmission(catalog, {
      schemaVersion: 1,
      kind: 'recipe',
      id: recipe.family,
      version: '1.0.0',
      title: recipe.family,
      description: 'Editable diagram starter.',
      source: recipe.source,
      family: recipe.family,
    }),
  ).candidate;
}

/**
 * The owner's value. Throws `PresetFault` ("The owning capability rejected this input", the
 * owner's failure kept as source) when the owner refused.
 */
function accepted<T>(result: Result<T, FailureSource>): T {
  if (!result.ok) throw new PresetFault('The owning capability rejected this input', result.error);
  return result.value;
}

/** A shipped input the owners refused; the owner's failure is kept when there is one. */
class PresetFault extends Error {
  /** Private native/input failures have no invented source; checked owner failures retain theirs. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}

/**
 * The failure for a throw during preparation: `invalid-input` at `builtins` for a `PresetFault`
 * (its message and source kept), otherwise `unavailable` at `builtins` without the native
 * exception text.
 */
function preparationFailure(error: unknown): Result<never> {
  if (error instanceof PresetFault)
    return failure('invalid-input', 'builtins', error.message, error.source);
  return failure('unavailable', 'builtins', 'Built-in preparation provider failed');
}
