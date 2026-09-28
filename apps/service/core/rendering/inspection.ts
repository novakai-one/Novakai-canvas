/*
 * Why this file exists
 *
 * An agent that writes a diagram wants to know if it came out well, without looking at it. For
 * example, `pnpm canvas inspect my-diagram` answers that the layout is valid with 2 wire
 * crossings, or that it could not be laid out, and why.
 *
 * This file draws the saved collection and turns the drawing into that quality report. A diagram
 * that can't be laid out gets a report, not a mistake. A missing collection, or a workspace or
 * worker that can't answer, is still a mistake. It only reads.
 */
import type { InspectionReport } from '../../contract/records/rendering/inspection.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { SceneWarning } from '../../contract/records/capability-types.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import type { CollectionId } from '../../contract/brands.js';
import { renderCollection, type WorkspaceRenderDependencies } from './collection.js';

/**
 * Draws the saved collection with this ID and reports how well it came out.
 * A drawing refused as `invalid-input` becomes an invalid report (`valid: false`) that says why.
 * Other mistakes pass through: `not-found`, `unavailable`, and the renderer's own.
 */
export async function inspectCollection(
  id: CollectionId,
  signal: AbortSignal,
  dependencies: WorkspaceRenderDependencies,
): Promise<Result<InspectionReport>> {
  const rendered = await renderCollection(id, signal, dependencies);
  if (!rendered.ok) return refusedRender(rendered.error);
  return success(validReport(rendered.value));
}

/**
 * The answer for a refused render: the invalid report for `invalid-input`, otherwise the same
 * failure (code, path, message and source), because a missing collection or an infrastructure
 * failure is a routing error, not a quality verdict.
 */
function refusedRender(refusal: Diagnostic): Result<InspectionReport> {
  if (refusal.code !== 'invalid-input')
    return failure(refusal.code, refusal.path, refusal.message, refusal.source);
  return success(invalidReport(refusal));
}

/** The invalid report: the refusal as its one diagnostic (source kept typed), every count 0. */
function invalidReport(refusal: Diagnostic): InspectionReport {
  return {
    valid: false,
    diagnostics: [refusal],
    warnings: [],
    crossings: 0,
    relaxed: 0,
    sections: 0,
    engineVersions: [],
  };
}

/**
 * The valid report: the scene passed the independent inspector during derivation, so the report
 * is its own warning record, the crossing and relaxed-constraint counts, the section count and the
 * engine versions.
 */
function validReport(document: RenderDocument): InspectionReport {
  const scene = document.scene;
  return {
    valid: true,
    diagnostics: [],
    warnings: scene.warnings,
    crossings: countWarnings(scene.warnings, 'wire-crossing'),
    relaxed: countWarnings(scene.warnings, 'constraint-relaxed'),
    sections: scene.sections.length,
    engineVersions: scene.engineVersions,
  };
}

/** How many scene warnings carry `code`, one of Layout's warning codes. */
function countWarnings(
  warnings: readonly SceneWarning[],
  code: SceneWarning['code'],
): number {
  const matching = warnings.filter((warning) => warning.code === code);
  return matching.length;
}
