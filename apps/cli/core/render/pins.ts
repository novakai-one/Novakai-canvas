/*
 * The pins one render lowers against: every admitted theme preset as a Model theme pin keyed by its
 * ID, and the collection's own asset records keyed by asset ID. Pure; nothing can fail here.
 * Language checks each pin the source names when it lowers, and has Model check the records.
 */
import type {
  Catalog,
  Collection,
  CollectionAsset,
  ResolvedResources,
  ThemePreset,
} from '../../contract/records/foreign.js';
import { formatPin } from '../resources/digests.js';

/** Theme pins from the admitted catalog, plus `assets`, the collection's own asset records. */
export function pinResources(
  catalog: Catalog,
  assets: readonly CollectionAsset[],
): ResolvedResources {
  return { themes: themePins(catalog), assets: Object.fromEntries(assets.map(assetEntry)) };
}

/** Every admitted theme's pin, keyed by theme ID, in catalog order. */
function themePins(catalog: Catalog): ResolvedResources['themes'] {
  return Object.fromEntries(catalog.filter(isTheme).map(themeEntry));
}

/** Whether a preset is a theme. */
function isTheme(preset: Catalog[number]): preset is ThemePreset {
  return preset.kind === 'theme';
}

/** A theme preset's ID and its Model pin: ID, version, `sha256:` digest and roles. */
function themeEntry(preset: ThemePreset): readonly [string, Collection['theme']] {
  return [
    preset.id,
    {
      id: preset.id,
      version: preset.version,
      digest: formatPin(preset.digest),
      roles: preset.payload.roles,
    },
  ];
}

/** An asset record under its asset ID. */
function assetEntry(asset: CollectionAsset): readonly [string, CollectionAsset] {
  return [asset.id, asset];
}
