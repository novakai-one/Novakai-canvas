/*
 * The theme bindings one request may use: every stored theme version under its exact pin, each
 * theme id under its latest version, and a retained DSL request's own exact pins over those. Pure
 * over Templates and Model; a refusal throws ResourceFault (select.ts turns it into
 * `missing-asset`), and Authoring owns recovery.
 */
import type {
  Catalog,
  LoweredIntent,
  Preset,
  ResolvedResources,
  Templates,
  ThemePreset,
} from '../../../contract/records/capabilities.js';
import { themeBinding, type BindingModel, type ThemeBinding } from '../../presets/theme-binding.js';
import type { Intent } from './intent.js';
import { prefixed } from './digests.js';
import { ResourceFault, accepted } from './refusal.js';

/** The owners theme binding reads: Templates picks the latest version, Model checks each binding. */
export interface ThemeOwners {
  readonly model: BindingModel;
  readonly templates: Pick<Templates<LoweredIntent>, 'read'>;
}

/** Theme bindings keyed by alias or exact `id@version#sha256:hex` pin. */
export type Themes = ResolvedResources['themes'];

/**
 * Every theme version under its exact pin, then each theme id under its latest version. Throws
 * ResourceFault with the Templates or Model failure in `source` when either refuses.
 */
export function availableThemes(
  catalog: Catalog,
  owners: ThemeOwners,
): Themes {
  const records = themePresets(catalog);
  const exact = records.map(
    (item) =>
      [
        `${item.id}@${item.version}#${prefixed(item.digest)}`,
        accepted(themeBinding(item, owners.model)),
      ] as const,
  );
  const aliases = [...new Set(records.map((item) => item.id))].map(
    (id) => [id, latestBinding(catalog, id, owners)] as const,
  );
  return Object.fromEntries([...exact, ...aliases]);
}

/**
 * A retained DSL request keeps its exact theme pins; a newer latest version never replaces those
 * bytes. Throws ResourceFault for a retained pin that is no longer in the catalog.
 */
export function pinnedThemes(
  intent: Intent,
  available: Themes,
): Themes {
  if (intent.planner !== 'dsl') return available;
  const pins = Object.entries(intent.command.themePins ?? {}).map(
    ([alias, exact]) => [alias, exactTheme(available, exact)] as const,
  );
  return { ...available, ...Object.fromEntries(pins) };
}

/** The catalog's theme presets, in catalog order. */
export function themePresets(catalog: Catalog): readonly ThemePreset[] {
  return catalog.filter((item) => item.kind === 'theme');
}

/**
 * The binding for a theme id's latest version; Templates decides which version is latest. Throws
 * ResourceFault with the Templates or Model failure in `source`, or when Templates returns a preset
 * that is not a theme.
 */
function latestBinding(
  catalog: Catalog,
  id: string,
  owners: ThemeOwners,
): ThemeBinding {
  const latest = selectedTheme(accepted(owners.templates.read(catalog, { kind: 'theme', id })));
  return accepted(themeBinding(latest, owners.model));
}

/** The preset Templates selected, which must be a theme. Throws ResourceFault when it is not. */
function selectedTheme(preset: Preset): ThemePreset {
  if (preset.kind !== 'theme') throw new ResourceFault('Selected preset is not a theme');
  return preset;
}

/** The theme a retained pin names, which must still be in the current catalog. */
function exactTheme(
  available: Themes,
  exact: string,
): ThemeBinding {
  const pin = available[exact];
  if (!pin) throw new ResourceFault(`Retained theme pin unavailable: ${exact}`);
  return pin;
}
