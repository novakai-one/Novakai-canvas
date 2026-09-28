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
import { collect, success } from '../../../contract/errors.js';
import {
  checkThemeBinding,
  type BindingModel,
  type ThemeBinding,
} from '../../presets/theme-binding.js';
import { formatThemePin, type ThemePinText } from '../../presets/theme-pin.js';
import type { DslCommand } from '../../../contract/records/planning/commands.js';
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
  const themePresets = listThemePresets(catalog);
  const exact = collect(themePresets, (preset) => exactEntry(preset, dependencies));
  if (!exact.ok) {
    return exact;
  }
  const latest = latestEntries(catalog, themePresets, dependencies);
  if (!latest.ok) {
    return latest;
  }
  const themes: Themes = Object.fromEntries([...exact.value, ...latest.value]);
  return success(themes);
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
  if (intent.planner !== 'dsl') {
    return success(available);
  }
  return pointAtFrozenVersions(intent.command, available);
}

/** Lists the stored theme presets, in catalog order. Never fails. */
export function listThemePresets(catalog: Catalog): readonly ThemePreset[] {
  return catalog.filter(isThemePreset);
}

/** One theme binding under its alias or exact pin text. */
type ThemeEntry = readonly [string, ThemeBinding];

/** Has Model check one stored theme version, and keys it by its exact pin text. */
function exactEntry(
  preset: ThemePreset,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemeEntry> {
  const binding = fromCapability(checkThemeBinding(preset, dependencies.model));
  if (!binding.ok) {
    return binding;
  }
  const entry: ThemeEntry = [presetPin(preset), binding.value];
  return success(entry);
}

/** Keys each theme ID by its latest version, once per ID, in catalog order. */
function latestEntries(
  catalog: Catalog,
  themePresets: readonly ThemePreset[],
  dependencies: ThemeDependencies,
): AuthoringResult<readonly ThemeEntry[]> {
  const themeIds = listEachIdOnce(themePresets);
  return collect(themeIds, (id) => latestEntry(catalog, id, dependencies));
}

/** Keys one theme ID by its latest version's binding. */
function latestEntry(
  catalog: Catalog,
  id: string,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemeEntry> {
  const binding = latestBinding(catalog, id, dependencies);
  if (!binding.ok) {
    return binding;
  }
  const entry: ThemeEntry = [id, binding.value];
  return success(entry);
}

/** Has Model check the latest version of one theme ID, as Templates decides which is latest. */
function latestBinding(
  catalog: Catalog,
  id: string,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemeBinding> {
  const latest = readLatestTheme(catalog, id, dependencies);
  if (!latest.ok) {
    return latest;
  }
  return fromCapability(checkThemeBinding(latest.value, dependencies.model));
}

/** Asks Templates for the latest version of one theme ID; it must be a theme. */
function readLatestTheme(
  catalog: Catalog,
  id: string,
  dependencies: ThemeDependencies,
): AuthoringResult<ThemePreset> {
  const latestPin = { kind: 'theme', id };
  const preset = fromCapability(dependencies.templates.read(catalog, latestPin));
  if (!preset.ok) {
    return preset;
  }
  if (preset.value.kind !== 'theme') {
    return notAThemeFailure();
  }
  return success(preset.value);
}

/** Points each name in the DSL change's `themePins` at the exact version it was frozen to. */
function pointAtFrozenVersions(
  command: DslCommand,
  available: Themes,
): AuthoringResult<Themes> {
  const frozenPins = Object.entries(command.themePins ?? {});
  const retained = collect(frozenPins, ([alias, exact]) => retainedEntry(available, alias, exact));
  if (!retained.ok) {
    return retained;
  }
  const retainedThemes = Object.fromEntries(retained.value);
  return success({ ...available, ...retainedThemes });
}

/** Keys a frozen theme name by the exact version it names, refusing a version no longer stored. */
function retainedEntry(
  available: Themes,
  alias: string,
  exact: string,
): AuthoringResult<ThemeEntry> {
  const binding = available[exact];
  if (binding === undefined) {
    return retainedPinUnavailableFailure(exact);
  }
  const entry: ThemeEntry = [alias, binding];
  return success(entry);
}

/** Writes a stored theme version's exact pin text, with its digest in Model's `sha256:` form. */
function presetPin(preset: ThemePreset): ThemePinText {
  return formatThemePin({
    id: preset.id,
    version: preset.version,
    digest: addDigestPrefix(preset.digest),
  });
}

/** Lists the theme IDs, each once, in the order first seen. */
function listEachIdOnce(themePresets: readonly ThemePreset[]): readonly string[] {
  const ids = themePresets.map((preset) => preset.id);
  const distinctIds = new Set(ids);
  return [...distinctIds];
}

/** Whether a preset is a theme. */
function isThemePreset(preset: Preset): preset is ThemePreset {
  return preset.kind === 'theme';
}

/** Makes the mistake for a latest version that is not a theme: `missing-asset` at `resources`. */
function notAThemeFailure(): AuthoringResult<never> {
  return missingAssetFailure('Selected preset is not a theme');
}

/** Makes the mistake for a frozen version no longer stored: `missing-asset` at `resources`. */
function retainedPinUnavailableFailure(exact: string): AuthoringResult<never> {
  return missingAssetFailure(`Retained theme pin unavailable: ${exact}`);
}
