import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { Catalog, Preset, RecipePayload } from '@novakai/canvas-templates';
import type { ResolvedResources } from '@novakai/canvas-language';
import type {
  BuiltinSources,
  BuiltinResources,
  BuiltinPresetOwners,
} from '../../contract/records/presets/builtins.js';
import { failure, type Result } from '../../contract/errors.js';
import { EMPTY_RESOURCES } from '../../contract/ports/capabilities.js';
/** Boot admission stops at an owner rejection; service retains the original workspace. */
class PresetFault extends Error {
  /** Private native/input failures have no invented source; checked owner failures retain theirs. */
  constructor(
    message: string,
    readonly source?: FailureSource,
  ) {
    super(message);
  }
}
/** Immutable owner output is required before selecting the next built-in admission. */
function accepted<T>(result: Result<T, FailureSource>): T {
  if (!result.ok) throw new PresetFault('The owning capability rejected this input', result.error);
  return result.value;
}
/** Admission uses the actual font families verified by Assets; missing shipped fonts cannot fall back to the OS. */
function fontPins(sources: BuiltinSources): unknown {
  const [body, mono, strong] = sources.fonts;
  if (!body || !mono || !strong) throw new PresetFault('All shipped fonts are required');
  return {
    body: { family: body.family, digest: body.digest, approved: true },
    mono: { family: mono.family, digest: mono.digest, approved: true },
    strong: { family: strong.family, digest: strong.digest, approved: true },
  };
}
/** System theme selection yields exact release pins; personal preferences do not become diagram dependencies. */
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
/** Shipped theme headers are stable identities; Templates computes the complete immutable content hash. */
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
/** Model mints the diagram theme binding from the checked preset; the host owns alias selection only. */
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
/** Recipe inspection uses the exact just-admitted themes and no invented asset defaults. */
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
/** Prepare the complete installation preset set without writing it; startup Authoring admission owns commit/recovery. */
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

/** Known owner rejection explains correction; unexpected provider faults do not leak native exception details. */
function preparationFailure(error: unknown): Result<never> {
  if (error instanceof PresetFault)
    return failure('invalid-input', 'builtins', error.message, error.source);
  return failure('unavailable', 'builtins', 'Built-in preparation provider failed');
}
