/*
 * Why this file exists
 *
 * When a render finishes, render:png prints one JSON report so the agent can see what happened:
 * the full path of each file it wrote (such as `…/out/intro.png`), the theme it drew with, the
 * service's inspection of the drawing, and a content hash for every theme the render knew.
 *
 * This file puts that report together from what the earlier steps gave back. It judges nothing
 * itself and cannot fail.
 */
import type { FilePath } from '../../contract/brands.js';
import type {
  Catalog,
  Collection,
  InspectionReport,
  ThemePreset,
} from '../../contract/records/foreign.js';
import type { RenderReport, ThemeDigest } from '../../contract/records/render.js';

/**
 * Puts together the report a finished render prints. `inspection` is passed on exactly as the
 * service gave it; each theme in `catalog` adds its ID and content hash.
 */
export function buildRenderReport(
  files: readonly FilePath[],
  collection: Collection,
  inspection: InspectionReport,
  catalog: Catalog,
): RenderReport {
  const digests = themeDigests(catalog);
  return { files, theme: collection.theme, inspection, digests };
}

/** Lists each admitted theme's ID and content hash, in catalog order. */
function themeDigests(catalog: Catalog): readonly ThemeDigest[] {
  const themes = catalog.filter(isTheme);
  return themes.map(themeDigest);
}

/** Whether a preset is a theme. */
function isTheme(preset: Catalog[number]): preset is ThemePreset {
  return preset.kind === 'theme';
}

/** Gives a theme's ID and content hash, as the report lists them. */
function themeDigest(theme: ThemePreset): ThemeDigest {
  return { id: theme.id, digest: theme.digest };
}
