/*
 * The theme bindings one request may use: every stored theme version under its exact pin, each
 * theme id under its latest version, and a retained DSL request's own exact pins over those. Pure
 * over Templates and Model; every refusal is `missing-asset` at `resources` (refusal.ts), and
 * Authoring owns recovery.
 */
import type {
  AuthoringResult,
  Catalog,
  LoweredIntent,
  Preset,
  ResolvedResources,
  Templates,
  ThemePreset,
} from '../../../contract/records/capabilities.js';
import { pinnedDigest } from '../../../contract/brands.js';
import { andThen, collect, success } from '../../../contract/errors.js';
import { themeBinding, type BindingModel, type ThemeBinding } from '../../presets/theme-binding.js';
import { formatThemePin, type ThemePinText } from '../../presets/theme-pin.js';
import type { Intent } from './intent.js';
import { fromOwner, resourceRefused } from './refusal.js';

/** The owners theme binding reads: Templates picks the latest version, Model checks each binding. */
export interface ThemeOwners {
  readonly model: BindingModel;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}

/** Theme bindings keyed by alias or exact pin text (grammar in theme-pin.ts). */
export type Themes = ResolvedResources['themes'];

/**
 * Every theme version under its exact pin, then each theme id under its latest version. Fails with
 * `missing-asset` at `resources` when Templates or Model refuses (its failure kept in `source`), or
 * when Templates selects a preset that is not a theme.
 */
export function availableThemes(
  catalog: Catalog,
  owners: ThemeOwners,
): AuthoringResult<Themes> {
  const records = themePresets(catalog);
  const exact = collect(records.map((item) => exactEntry(item, owners)));
  if (!exact.ok) return exact;
  const ids = [...new Set(records.map((item) => item.id))];
  const aliases = collect(ids.map((id) => aliasEntry(catalog, id, owners)));
  return andThen(aliases, (latest) => success(Object.fromEntries([...exact.value, ...latest])));
}

/**
 * A retained DSL request keeps its exact theme pins; a newer latest version never replaces those
 * bytes. Fails with `missing-asset` at `resources` for a retained pin that is no longer in the
 * catalog.
 */
export function pinnedThemes(
  intent: Intent,
  available: Themes,
): AuthoringResult<Themes> {
  if (intent.planner !== 'dsl') return success(available);
  const pins = collect(
    Object.entries(intent.command.themePins ?? {}).map(([alias, exact]) =>
      retainedEntry(available, alias, exact),
    ),
  );
  return andThen(pins, (retained) => success({ ...available, ...Object.fromEntries(retained) }));
}

/** The catalog's theme presets, in catalog order. */
export function themePresets(catalog: Catalog): readonly ThemePreset[] {
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
  owners: ThemeOwners,
): AuthoringResult<ThemeEntry> {
  const binding = fromOwner(themeBinding(preset, owners.model));
  return andThen(binding, (bound) => success([presetPin(preset), bound] as const));
}

/**
 * A theme id under its latest version's binding. Fails as `latestBinding` fails.
 */
function aliasEntry(
  catalog: Catalog,
  id: string,
  owners: ThemeOwners,
): AuthoringResult<ThemeEntry> {
  const binding = latestBinding(catalog, id, owners);
  return andThen(binding, (bound) => success([id, bound] as const));
}

/** A stored theme version's exact pin text, its digest in Model's pinned form. Never fails. */
function presetPin(preset: ThemePreset): ThemePinText {
  return formatThemePin({
    id: preset.id,
    version: preset.version,
    digest: pinnedDigest(preset.digest),
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
  owners: ThemeOwners,
): AuthoringResult<ThemeBinding> {
  const read = fromOwner(owners.templates.read(catalog, { kind: 'theme', id }));
  const latest = andThen(read, selectedTheme);
  return andThen(latest, (preset) => fromOwner(themeBinding(preset, owners.model)));
}

/**
 * The preset Templates selected, which must be a theme. Fails with `missing-asset` at
 * `resources` ("Selected preset is not a theme") when it is not.
 */
function selectedTheme(preset: Preset): AuthoringResult<ThemePreset> {
  if (preset.kind !== 'theme') return resourceRefused('Selected preset is not a theme');
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
  if (!pin) return resourceRefused(`Retained theme pin unavailable: ${exact}`);
  return success([alias, pin] as const);
}
