/*
 * The render report: the written files, the collection's theme, the service's inspection of the
 * rendered document and the admitted theme digests. Pure assembly; the service judges the
 * document, nothing is recounted here. Nothing can fail.
 */
import type { Catalog, Collection, InspectionReport } from '../../contract/records/foreign.js';
import type { RenderReport } from '../../contract/records/render.js';

/** The report of one completed render, with the service's `inspection` as it gave it. */
export function renderReport(
  files: RenderReport['files'],
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
