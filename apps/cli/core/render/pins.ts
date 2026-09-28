/*
 * Why this file exists
 *
 * A collection names its theme and images by ID, as in `theme=atlas` or `asset=@logo`. To check it,
 * Language and Model need to know exactly what each name stands for. Model calls that exact record
 * a pin: for a theme, its ID, version and content hash (`sha256:…`).
 *
 * This file builds that lookup from the render's theme catalog and the collection's own font and
 * image records. It only builds the lookup; Language and Model check it. Nothing here can fail.
 */
import type {
  Catalog,
  Collection,
  CollectionAsset,
  ResolvedResources,
  ThemePreset,
} from '../../contract/records/foreign.js';
import { formatPin } from '../resources/digests.js';

/**
 * Builds the lookup a collection's names are checked against: each theme in `catalog` by its ID,
 * and each of `assets` (the collection's own font and image records) by its asset ID.
 */
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
