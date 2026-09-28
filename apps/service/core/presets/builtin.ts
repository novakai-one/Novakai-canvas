/*
 * Why this file exists
 *
 * Every new workspace starts with the same presets: the Paper (light) and Ink (dark) themes, and
 * one recipe per shipped starter, such as `er`. They are made from the fonts, design tokens and
 * recipe DSL shipped in `resources/`, and must pass the same checks as a preset a user saves.
 *
 * This file makes that catalog through Design System, Model and Templates, as a `Result`
 * (contract/errors.ts). It saves nothing: start-up saves the catalog through Authoring.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type {
  Catalog,
  DesignSystem,
  FontSource,
  LoweredIntent,
  ResolvedResources,
  Templates,
  ThemePreset,
} from '../../contract/records/capability-types.js';
import type {
  BuiltinFonts,
  BuiltinSources,
  PreparedBuiltins,
} from '../../contract/records/presets/builtins.js';
import { collect, failure, success, type Result } from '../../contract/errors.js';
import { EMPTY_RESOURCES } from '../../contract/ports/capabilities.js';
import { checkThemeBinding, type BindingModel } from './theme-binding.js';

/** What making the built-in presets uses. The service's capabilities fit it. */
export interface BuiltinPresetDependencies {
  /** Model's check of a theme binding, so the recipes can use the new themes. */
  readonly model: BindingModel;
  /** Design System, which works out the UI tokens each built-in theme starts from. */
  readonly system: Pick<DesignSystem, 'resolve'>;
  /** Makes Templates for a set of themes and files; only its `planAdmission` is used. */
  templates(resources: ResolvedResources): Pick<Templates<LoweredIntent>, 'planAdmission'>;
}

/**
 * Makes the built-in preset catalog.
 * Returns the shipped sources plus the new catalog under `presets`.
 * 1. Names the shipped fonts by role: body, mono, strong.
 * 2. Adds Paper (light) and Ink (dark) with those fonts.
 * 3. Adds each shipped recipe, which may use those two themes.
 * Fails with `invalid-input` at `builtins` when a shipped font is missing or a capability refuses
 * a shipped input (its failure kept as the source).
 */
export function prepareBuiltinPresets(
  sources: BuiltinSources,
  dependencies: BuiltinPresetDependencies,
): Result<PreparedBuiltins> {
  const fonts = nameFontRoles(sources.fonts);
  if (!fonts.ok) {
    return fonts;
  }
  const themeSources: ThemeSources = { tokens: sources.tokens, fonts: fonts.value };
  const themes = addThemes(themeSources, dependencies);
  if (!themes.ok) {
    return themes;
  }
  return addShippedRecipes(sources, themes.value, dependencies);
}

/** What each bundled theme is built from: the Design System token sources and the fonts by role. */
interface ThemeSources {
  readonly tokens: BuiltinSources['tokens'];
  readonly fonts: BuiltinFonts;
}

/** Names the shipped fonts by role, in their shipped order: body, mono, strong. */
function nameFontRoles(fonts: BuiltinSources['fonts']): Result<BuiltinFonts> {
  const [body, mono, strong] = fonts;
  if (body === undefined || mono === undefined || strong === undefined) {
    return missingFontFailure();
  }
  const roles: BuiltinFonts = { body, mono, strong };
  return success(roles);
}

/** A colour scheme with one bundled theme. */
type Scheme = 'light' | 'dark';

/**
 * The bundled theme for each scheme: Paper for light, Ink for dark. Every scheme has a theme
 * (checked by the type).
 */
const bundledThemes: Readonly<Record<Scheme, { readonly id: string; readonly title: string }>> =
  Object.freeze({ light: { id: 'paper', title: 'Paper' }, dark: { id: 'ink', title: 'Ink' } });

/** Adds Paper, then Ink, to an empty catalog. */
function addThemes(
  sources: ThemeSources,
  dependencies: BuiltinPresetDependencies,
): Result<Catalog> {
  const withPaper = addTheme([], 'light', sources, dependencies);
  if (!withPaper.ok) {
    return withPaper;
  }
  return addTheme(withPaper.value, 'dark', sources, dependencies);
}

/** Has Templates add the scheme's bundled theme at version 1.1.0; Templates works out its hash. */
function addTheme(
  catalog: Catalog,
  scheme: Scheme,
  sources: ThemeSources,
  dependencies: BuiltinPresetDependencies,
): Result<Catalog> {
  const raw = themeRaw(sources, scheme, dependencies);
  if (!raw.ok) {
    return raw;
  }
  const theme = bundledThemes[scheme];
  const templates = dependencies.templates(EMPTY_RESOURCES);
  const planned = templates.planAdmission(catalog, {
    schemaVersion: 1,
    kind: 'theme',
    id: theme.id,
    version: '1.1.0',
    title: theme.title,
    description: 'Bundled diagram theme with pinned fonts.',
    raw: raw.value,
  });
  if (!planned.ok) {
    return ownerRefusedFailure(planned.error);
  }
  return success(planned.value.candidate);
}

/**
 * Builds a theme's settings: the scheme's interface tokens from Design System, the three shipped
 * fonts and no overrides.
 */
function themeRaw(
  sources: ThemeSources,
  scheme: Scheme,
  dependencies: BuiltinPresetDependencies,
): Result<unknown> {
  // Default preferences, so a person's own settings never become part of a saved theme.
  const resolved = dependencies.system.resolve({
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
  });
  if (!resolved.ok) {
    return ownerRefusedFailure(resolved.error);
  }
  const base = { kind: 'ui', pin: resolved.value.provenance.ui };
  const raw = { base, fonts: fontPins(sources.fonts), overrides: {} };
  return success(raw);
}

/** One theme font pin: the family Assets verified and its digest, approved. */
interface FontPin {
  readonly family: string;
  readonly digest: FontSource['digest'];
  readonly approved: true;
}

/** Pins the theme's body, mono and strong fonts, in that order. */
function fontPins(fonts: BuiltinFonts): Readonly<Record<keyof BuiltinFonts, FontPin>> {
  return { body: fontPin(fonts.body), mono: fontPin(fonts.mono), strong: fontPin(fonts.strong) };
}

/** Pins one shipped font. */
function fontPin(font: FontSource): FontPin {
  return { family: font.family, digest: font.digest, approved: true };
}

/** One shipped recipe: its family and DSL source. */
type ShippedRecipe = BuiltinSources['recipes'][number];

/** One theme's binding under its ID, as Model checked it. */
type BoundTheme = readonly [string, ResolvedResources['themes'][string]];

/** Adds each shipped recipe after the themes, and answers the sources with the finished catalog. */
function addShippedRecipes(
  sources: BuiltinSources,
  themes: Catalog,
  dependencies: BuiltinPresetDependencies,
): Result<PreparedBuiltins> {
  // `addNext` passes the first failure along unchanged, so later recipes are skipped.
  const addNext = (catalog: Result<Catalog>, recipe: ShippedRecipe): Result<Catalog> =>
    addNextRecipe(catalog, recipe, dependencies);
  const presets = sources.recipes.reduce(addNext, success(themes));
  if (!presets.ok) {
    return presets;
  }
  const prepared: PreparedBuiltins = { ...sources, presets: presets.value };
  return success(prepared);
}

/** Adds the next recipe, or passes an earlier failure on unchanged. */
function addNextRecipe(
  catalog: Result<Catalog>,
  recipe: ShippedRecipe,
  dependencies: BuiltinPresetDependencies,
): Result<Catalog> {
  if (!catalog.ok) {
    return catalog;
  }
  return addRecipe(catalog.value, recipe, dependencies);
}

/**
 * Has Templates add one shipped recipe at version 1.0.0, named after its family, using the themes
 * already in the catalog and no images.
 */
function addRecipe(
  catalog: Catalog,
  recipe: ShippedRecipe,
  dependencies: BuiltinPresetDependencies,
): Result<Catalog> {
  const themes = bindCatalogThemes(catalog, dependencies);
  if (!themes.ok) {
    return themes;
  }
  const templates = dependencies.templates({ themes: themes.value, assets: {} });
  const planned = templates.planAdmission(catalog, {
    schemaVersion: 1,
    kind: 'recipe',
    id: recipe.family,
    version: '1.0.0',
    title: recipe.family,
    description: 'Editable diagram starter.',
    source: recipe.source,
    family: recipe.family,
  });
  if (!planned.ok) {
    return ownerRefusedFailure(planned.error);
  }
  return success(planned.value.candidate);
}

/** Has Model check a binding for every theme in the catalog, and keys them by theme ID. */
function bindCatalogThemes(
  catalog: Catalog,
  dependencies: BuiltinPresetDependencies,
): Result<ResolvedResources['themes']> {
  const themes = catalog.filter((preset) => preset.kind === 'theme');
  const bound = collect(themes, (theme) => bindTheme(theme, dependencies));
  if (!bound.ok) {
    return bound;
  }
  const themesById = Object.fromEntries(bound.value);
  return success(themesById);
}

/** Has Model check one theme's binding, and keeps it under the theme's ID. */
function bindTheme(
  preset: ThemePreset,
  dependencies: BuiltinPresetDependencies,
): Result<BoundTheme> {
  const binding = checkThemeBinding(preset, dependencies.model);
  if (!binding.ok) {
    return ownerRefusedFailure(binding.error);
  }
  const bound: BoundTheme = [preset.id, binding.value];
  return success(bound);
}

/** Makes the mistake for fewer than three shipped fonts: `invalid-input` at `builtins`. */
function missingFontFailure(): Result<never> {
  return failure('invalid-input', 'builtins', 'All shipped fonts are required');
}

/** Makes the mistake for a capability that refused a shipped input, keeping its own mistake. */
function ownerRefusedFailure(source: FailureSource): Result<never> {
  return failure('invalid-input', 'builtins', 'The owning capability rejected this input', source);
}
