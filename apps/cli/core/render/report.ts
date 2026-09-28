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
import type { Catalog, Collection, InspectionReport } from '../../contract/records/foreign.js';
import type { RenderReport } from '../../contract/records/render.js';

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
  return { files, theme: collection.theme, inspection, digests: themeDigests(catalog) };
}

/** The admitted theme IDs and digests, in catalog order. */
function themeDigests(catalog: Catalog): RenderReport['digests'] {
  return catalog
    .filter((preset) => preset.kind === 'theme')
    .map((preset) => ({ id: preset.id, digest: preset.digest }));
}
