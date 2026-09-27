/*
 * The headless render report: written files, the collection's theme, scene inspection counts
 * and the admitted theme digests. Pure assembly from the document the owners produced.
 */
import type { Catalog, Collection, RenderDocument } from '../../contract/records/foreign.js';
import type { HeadlessReport } from '../../contract/records/headless.js';

/** The report of one completed render. */
export function renderReport(
  files: HeadlessReport['files'],
  collection: Collection,
  document: RenderDocument,
  catalog: Catalog,
): HeadlessReport {
  return {
    files,
    theme: collection.theme,
    inspection: sceneInspection(document),
    digests: themeDigests(catalog),
  };
}

/** Validity is asserted by the producing owners; warnings are counted by code. */
function sceneInspection(document: RenderDocument): HeadlessReport['inspection'] {
  return {
    valid: true,
    diagnostics: [],
    warnings: document.scene.warnings,
    crossings: document.scene.warnings.filter((warning) => warning.code === 'wire-crossing').length,
    relaxed: document.scene.warnings.filter((warning) => warning.code === 'constraint-relaxed')
      .length,
    sections: document.scene.sections.length,
    engineVersions: document.scene.engineVersions,
  };
}

/** The admitted theme ids and digests. */
function themeDigests(catalog: Catalog): HeadlessReport['digests'] {
  return catalog
    .filter((preset) => preset.kind === 'theme')
    .map((preset) => ({ id: preset.id, digest: preset.digest }));
}
