/*
 * The installation's built-in presets: the Paper and Ink themes and one recipe per shipped
 * starter, admitted through Templates into one catalog. Nothing is written here. Pure over the
 * injected owners; startup submits the catalog through Authoring, which owns commit and recovery.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type {
  Catalog,
  DesignSystem,
  LoweredIntent,
  Preset,
  RecipePayload,
  ResolvedResources,
  Templates,
} from '../../contract/records/capabilities.js';
import type { BuiltinSources, BuiltinResources } from '../../contract/records/presets/builtins.js';
import type { ModelRules } from '../../contract/ports/capabilities.js';
import { failure, type Result } from '../../contract/errors.js';
import { EMPTY_RESOURCES } from '../../contract/ports/capabilities.js';

/** The slice of ServiceCapabilities builtin preparation uses: theme binding, UI token resolution and preset admission. */
export interface BuiltinPresetOwners {
  readonly model: Pick<ModelRules, 'validate'>;
  readonly system: Pick<DesignSystem, 'resolve'>;
  templates(resources: ResolvedResources): Pick<Templates<LoweredIntent>, 'planAdmission'>;
}

/**
 * Prepares the complete installation preset set: Paper (light) and Ink (dark) first, then each
 * shipped recipe against those two themes. Returns the sources with the admitted catalog.
 * Fails with `invalid-input` at `builtins` when an owner rejects a shipped input (the owner's
 * failure kept as source) or a shipped font is missing, and with `unavailable` at `builtins`
 * when a provider throws anything else.
 */
export function prepareBuiltinPresets(
  sources: BuiltinSources,
  owners: BuiltinPresetOwners,
): Result<BuiltinResources> {
  try {
    const themes = (['light', 'dark'] as const).reduce<Catalog>(
      (catalog, scheme) => addTheme(catalog, scheme, sources, owners),
      [],
    );
    const presets = sources.recipes.reduce(
      (catalog, recipe) => addRecipe(catalog, recipe, owners),
      themes,
    );
    return { ok: true, value: { ...sources, presets } };
  } catch (error) {
    return preparationFailure(error);
  }
}

/**
 * Admits one bundled theme (`paper` for light, `ink` for dark) at version 1.1.0; Templates
 * computes its content hash. Returns the candidate catalog. Throws `PresetFault` when Design
 * System or Templates rejects the input, or a shipped font is missing.
 */
function addTheme(
  catalog: Catalog,
  scheme: 'light' | 'dark',
  sources: BuiltinSources,
  owners: BuiltinPresetOwners,
): Catalog {
  const id = scheme === 'light' ? 'paper' : 'ink';
  const templates = owners.templates(EMPTY_RESOURCES);
  return accepted(
    templates.planAdmission(catalog, {
      schemaVersion: 1,
      kind: 'theme',
      id,
      version: '1.1.0',
      title: id === 'paper' ? 'Paper' : 'Ink',
      description: 'Bundled diagram theme with pinned fonts.',
      raw: themeInput(sources, scheme, owners),
    }),
  ).candidate;
}

/**
 * The theme's raw input: the Design System UI pin resolved for this scheme under default system
 * preferences (personal preferences never become diagram dependencies), the three shipped fonts
 * and no overrides. Throws `PresetFault` when Design System rejects the token sources or a
 * shipped font is missing.
 */
function themeInput(
  sources: BuiltinSources,
  scheme: 'light' | 'dark',
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
  return { base: { kind: 'ui', pin: ui.provenance.ui }, fonts: fontPins(sources), overrides: {} };
}

/**
 * The body, mono and strong font pins, in that order from the shipped fonts, each with the
 * family Assets verified; a missing font never falls back to the OS. Throws `PresetFault`
 * ("All shipped fonts are required") when fewer than three fonts are shipped.
 */
function fontPins(sources: BuiltinSources): unknown {
  const [body, mono, strong] = sources.fonts;
  if (!body || !mono || !strong) throw new PresetFault('All shipped fonts are required');
  return {
    body: { family: body.family, digest: body.digest, approved: true },
    mono: { family: mono.family, digest: mono.digest, approved: true },
    strong: { family: strong.family, digest: strong.digest, approved: true },
  };
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
        .map((item) => [item.id, themeBinding(item, owners)]),
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
 * The diagram theme binding Model mints for a checked theme preset, read from a one-off grid
 * collection pinned to it. Throws `PresetFault` when the preset is not a theme or Model rejects
 * the pin.
 */
function themeBinding(
  preset: Preset,
  owners: BuiltinPresetOwners,
): ResolvedResources['themes'][string] {
  if (preset.kind !== 'theme') throw new PresetFault('Recipe is not a theme');
  return accepted(
    owners.model.validate({
      schemaVersion: 1,
      id: 'resource-binding',
      revision: 0,
      title: 'Resource binding',
      theme: {
        id: preset.id,
        version: preset.version,
        digest: `sha256:${preset.digest}`,
        roles: preset.payload.roles,
      },
      arrangement: { algorithm: 'grid' },
    }),
  ).theme;
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
