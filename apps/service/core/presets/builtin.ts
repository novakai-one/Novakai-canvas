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
  ResolvedResources,
  Templates,
  ThemePreset,
} from '../../contract/records/capabilities.js';
import type {
  BuiltinFonts,
  BuiltinSources,
  BuiltinResources,
} from '../../contract/records/presets/builtins.js';
import { andThen, collect, failure, success, type Result } from '../../contract/errors.js';
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
 * Steps; the first failure stops the preparation:
 * 1. Name the shipped fonts by role (see `fontRoles`).
 * 2. Admit Paper (light) and Ink (dark) with those fonts (see `addThemes`).
 * 3. Admit each shipped recipe against those two themes (see `addRecipes`).
 *
 * Returns the sources, unchanged, with the admitted catalog. Fails with `invalid-input` at
 * `builtins` when a shipped font is missing or an owner rejects a shipped input (the owner's
 * failure kept as source).
 */
export function prepareBuiltinPresets(
  sources: BuiltinSources,
  owners: BuiltinPresetOwners,
): Result<BuiltinResources> {
  const fonts = fontRoles(sources.fonts);
  if (!fonts.ok) return fonts;
  const themes = addThemes({ tokens: sources.tokens, fonts: fonts.value }, owners);
  if (!themes.ok) return themes;
  const presets = addRecipes(themes.value, sources.recipes, owners);
  return andThen(presets, (catalog) => success({ ...sources, presets: catalog }));
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

/** Admits Paper, then Ink, into an empty catalog. Fails as `addTheme` fails. */
function addThemes(
  sources: ThemeSources,
  owners: BuiltinPresetOwners,
): Result<Catalog> {
  const light = addTheme([], 'light', sources, owners);
  return andThen(light, (catalog) => addTheme(catalog, 'dark', sources, owners));
}

/**
 * Admits the scheme's bundled theme (see `bundledThemes`) at version 1.1.0; Templates computes
 * its content hash. Returns the candidate catalog. Fails with `invalid-input` at `builtins` when
 * Design System or Templates rejects the input (its failure kept as source).
 */
function addTheme(
  catalog: Catalog,
  scheme: Scheme,
  sources: ThemeSources,
  owners: BuiltinPresetOwners,
): Result<Catalog> {
  const raw = themeInput(sources, scheme, owners);
  if (!raw.ok) return raw;
  const theme = bundledThemes[scheme];
  const templates = owners.templates(EMPTY_RESOURCES);
  const planned = fromOwner(
    templates.planAdmission(catalog, {
      schemaVersion: 1,
      kind: 'theme',
      id: theme.id,
      version: '1.1.0',
      title: theme.title,
      description: 'Bundled diagram theme with pinned fonts.',
      raw: raw.value,
    }),
  );
  return andThen(planned, (plan) => success(plan.candidate));
}

/**
 * The theme's raw input: the Design System UI pin resolved for this scheme under default system
 * preferences (personal preferences never become diagram dependencies), the three shipped fonts
 * and no overrides. Fails with `invalid-input` at `builtins` when Design System rejects the token
 * sources (its failure kept as source).
 */
function themeInput(
  sources: ThemeSources,
  scheme: Scheme,
  owners: BuiltinPresetOwners,
): Result<unknown> {
  const ui = fromOwner(
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
  return andThen(ui, (resolved) =>
    success({
      base: { kind: 'ui', pin: resolved.provenance.ui },
      fonts: fontPins(sources.fonts),
      overrides: {},
    }),
  );
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

/** One shipped recipe: its family and DSL source. */
type ShippedRecipe = BuiltinSources['recipes'][number];

/**
 * Admits each shipped recipe in order, after the themes. Fails with the first recipe's failure
 * (see `addRecipe`); later recipes are skipped.
 */
function addRecipes(
  themes: Catalog,
  recipes: readonly ShippedRecipe[],
  owners: BuiltinPresetOwners,
): Result<Catalog> {
  // `addNext` passes the first failure along unchanged, so later recipes are skipped.
  const addNext = (catalog: Result<Catalog>, recipe: ShippedRecipe): Result<Catalog> =>
    andThen(catalog, (current) => addRecipe(current, recipe, owners));
  return recipes.reduce(addNext, success(themes));
}

/**
 * Admits one shipped recipe (ID and title are its family) at version 1.0.0, inspected against
 * the exact themes already in the catalog and no assets. Returns the candidate catalog. Fails
 * with `invalid-input` at `builtins` when Model or Templates rejects the input (its failure kept
 * as source).
 */
function addRecipe(
  catalog: Catalog,
  recipe: ShippedRecipe,
  owners: BuiltinPresetOwners,
): Result<Catalog> {
  const themes = catalogThemes(catalog, owners);
  if (!themes.ok) return themes;
  const templates = owners.templates({ themes: themes.value, assets: {} });
  const planned = fromOwner(
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
  );
  return andThen(planned, (plan) => success(plan.candidate));
}

/**
 * Every theme already in the catalog, bound under its ID as Model checks it. Fails with
 * `invalid-input` at `builtins` when Model rejects a binding (its failure kept as source).
 */
function catalogThemes(
  catalog: Catalog,
  owners: BuiltinPresetOwners,
): Result<ResolvedResources['themes']> {
  const themes = catalog.filter((item) => item.kind === 'theme');
  const bound = collect(themes.map((item) => boundTheme(item, owners)));
  return andThen(bound, (entries) => success(Object.fromEntries(entries)));
}

/** One theme under its ID, bound as Model checks it. Fails as `catalogThemes` names. */
function boundTheme(
  preset: ThemePreset,
  owners: BuiltinPresetOwners,
): Result<readonly [string, ResolvedResources['themes'][string]]> {
  const binding = fromOwner(themeBinding(preset, owners.model));
  return andThen(binding, (bound) => success([preset.id, bound] as const));
}

/**
 * The owner's result as a preparation result. Fails with `invalid-input` at `builtins` ("The
 * owning capability rejected this input", the owner's failure kept as source) when the owner
 * refused.
 */
function fromOwner<T>(result: Result<T, FailureSource>): Result<T> {
  if (!result.ok)
    return failure(
      'invalid-input',
      'builtins',
      'The owning capability rejected this input',
      result.error,
    );
  return result;
}
