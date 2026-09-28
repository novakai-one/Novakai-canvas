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
  if (!rendered.ok) {
    return reportRefusedRender(rendered.error);
  }
  const report = validReport(rendered.value);
  return success(report);
}

/**
 * Turns a refused drawing into the invalid report, or passes on a refusal that says nothing about
 * the diagram's quality.
 */
function reportRefusedRender(refusal: Diagnostic): Result<InspectionReport> {
  if (saysNothingAboutQuality(refusal)) {
    return unchangedFailure(refusal);
  }
  const report = invalidReport(refusal);
  return success(report);
}

/**
 * Whether the refusal is anything but `invalid-input`: a missing collection, or a workspace or
 * worker that can't answer, is not a verdict on the diagram.
 */
function saysNothingAboutQuality(refusal: Diagnostic): boolean {
  return refusal.code !== 'invalid-input';
}

/** The same mistake again: its code, path, message and source. */
function unchangedFailure(refusal: Diagnostic): Result<never> {
  return failure(refusal.code, refusal.path, refusal.message, refusal.source);
}

/** Builds the invalid report: the refusal is its one diagnostic, and every count is 0. */
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
 * Builds the valid report from the drawn scene: its warnings, how many wires cross, how many
 * layout rules were relaxed, how many sections it has, and the engine versions. The CLI's headless
 * render (`pnpm render:png`) reports with it too. Never fails.
 */
export function validReport(document: RenderDocument): InspectionReport {
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

/** Counts the scene warnings that carry `code`, one of Layout's warning codes. */
function countWarnings(
  warnings: readonly SceneWarning[],
  code: SceneWarning['code'],
): number {
  const matching = warnings.filter((warning) => warning.code === code);
  return matching.length;
}
