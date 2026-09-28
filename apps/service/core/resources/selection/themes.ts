/*
 * Why this file exists
 *
 * DSL can name a theme two ways: loosely, like `theme=paper`, or exactly, like
 * `paper@1.1.0#sha256:…`. The loose name means the latest stored `paper`; the exact one means that
 * version only. A frozen change (see commands/freeze.ts) must keep the exact versions it was
 * frozen to, even after a newer `paper` is saved.
 *
 * This file lists every theme a change could name, in both forms, and applies a frozen change's
 * exact versions. Model checks each theme. It only reads.
 */
import type {
  AuthoringResult,
  Catalog,
  LoweredIntent,
  Preset,
  ResolvedResources,
  Templates,
  ThemePreset,
} from '../../../contract/records/capability-types.js';
import { addDigestPrefix } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import { themeBinding, type BindingModel, type ThemeBinding } from '../../presets/theme-binding.js';
import { formatThemePin, type ThemePinText } from '../../presets/theme-pin.js';
import type { Intent } from './intent.js';
import { fromCapability, missingAssetFailure } from './refusal.js';

/** What listing themes needs. */
export interface ThemeDependencies {
  /** Model's check of each theme binding. */
  readonly model: BindingModel;
  /** Templates, which finds each theme's latest version. */
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}

/**
 * The themes a change can use, keyed by the name it uses: a theme ID such as `paper`, or exact pin
 * text such as `paper@1.1.0#sha256:…` (grammar in core/presets/theme-pin.ts).
 */
export type Themes = ResolvedResources['themes'];

/**
 * Lists every stored theme version under its exact pin text, and each theme ID under its latest
 * version. Fails with `missing-asset` at `resources` when Templates or Model refuses a theme (its
 * failure kept as `source`), or when Templates' latest version is not a theme.
 */
export function listAvailableThemes(
  catalog: Catalog,
  dependencies: ThemeDependencies,
): AuthoringResult<Themes> {
  const records = listThemePresets(catalog);
  const exact = collect(records, (preset) => exactEntry(preset, dependencies));
  if (!exact.ok) return exact;
  const ids = [...new Set(records.map((item) => item.id))];
  const aliases = collect(ids, (id) => aliasEntry(catalog, id, dependencies));
  return andThen(aliases, (latest) => success(Object.fromEntries([...exact.value, ...latest])));
}

/**
 * Points each theme name a frozen DSL change uses at the exact version it was frozen to. Any other
 * change gets `available` as it is. Fails with `missing-asset` at `resources` when a frozen version
 * is no longer stored.
 */
export function applyFrozenThemes(
  intent: Intent,
  available: Themes,
): AuthoringResult<Themes> {
  if (intent.planner !== 'dsl') return success(available);
  const pins = collect(Object.entries(intent.command.themePins ?? {}), ([alias, exact]) =>
    retainedEntry(available, alias, exact),
  );
  return andThen(pins, (retained) => success({ ...available, ...Object.fromEntries(retained) }));
}

/** Lists the stored theme presets, in catalog order. Never fails. */
export function listThemePresets(catalog: Catalog): readonly ThemePreset[] {
  return catalog.filter((item) => item.kind === 'theme');
}

/** One theme binding under its alias or exact pin text. */
type ThemeEntry = readonly [string, ThemeBinding];

/**
 * A stored theme version under its exact pin. Fails with `missing-asset` at `resources` when Model
 * refuses the binding.
 */
function exactEntry(
  preset: ThemePreset,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemeEntry> {
  const binding = fromCapability(themeBinding(preset, dependencies.model));
  return andThen(binding, (bound) => success([presetPin(preset), bound] as const));
}

/**
 * A theme id under its latest version's binding. Fails as `latestBinding` fails.
 */
function aliasEntry(
  catalog: Catalog,
  id: string,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemeEntry> {
  const binding = latestBinding(catalog, id, dependencies);
  return andThen(binding, (bound) => success([id, bound] as const));
}

/** A stored theme version's exact pin text, its digest in Model's pinned form. Never fails. */
function presetPin(preset: ThemePreset): ThemePinText {
  return formatThemePin({
    id: preset.id,
    version: preset.version,
    digest: addDigestPrefix(preset.digest),
  });
}

/**
 * The binding for a theme id's latest version; Templates decides which version is latest. Fails
 * with `missing-asset` at `resources` when Templates or Model refuses (its failure kept in
 * `source`), or when Templates returns a preset that is not a theme.
 */
function latestBinding(
  catalog: Catalog,
  id: string,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemeBinding> {
  const read = fromCapability(dependencies.templates.read(catalog, { kind: 'theme', id }));
  const latest = andThen(read, selectedTheme);
  return andThen(latest, (preset) => fromCapability(themeBinding(preset, dependencies.model)));
}

/**
 * The preset Templates selected, which must be a theme. Fails with `missing-asset` at
 * `resources` ("Selected preset is not a theme") when it is not.
 */
function selectedTheme(preset: Preset): AuthoringResult<ThemePreset> {
  if (preset.kind !== 'theme') return missingAssetFailure('Selected preset is not a theme');
  return success(preset);
}

/**
 * A retained pin under its alias; the pin must still be in the current catalog. Fails with
 * `missing-asset` at `resources` ("Retained theme pin unavailable: <pin>") when it is not.
 */
function retainedEntry(
  available: Themes,
  alias: string,
  exact: string,
): AuthoringResult<ThemeEntry> {
  const pin = available[exact];
  if (!pin) return missingAssetFailure(`Retained theme pin unavailable: ${exact}`);
  return success([alias, pin] as const);
}
