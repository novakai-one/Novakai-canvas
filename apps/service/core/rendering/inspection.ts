/*
 * Inspects one committed collection: render it and report its quality. Pure over the injected
 * reads. Missing collections and infrastructure failures stay routing errors, not verdicts.
 */
import type { InspectionReport } from '../../contract/records/rendering/inspection.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { renderCollection, type CollectionReads } from './collection.js';
/**
 * Renders one committed collection and reports its quality. A render refused as `invalid-input` is
 * the invalid verdict (`valid: false`), not a failure. Every other render failure passes through:
 * `not-found` for a missing collection, `unavailable` when the workspace cannot be read, and the
 * renderer's own failures.
 */
export async function inspectCollection(
  id: string,
  signal: AbortSignal,
  reads: CollectionReads,
): Promise<Result<InspectionReport>> {
  const outcome = await renderCollection(id, signal, reads);
  if (!outcome.ok) return rejected(outcome.error);
  return { ok: true, value: report(outcome.value) };
}
/** Missing collections and infrastructure failures are routing errors, not diagram quality verdicts. */
function rejected(error: Diagnostic): Result<InspectionReport> {
  if (error.code !== 'invalid-input')
    return failure(error.code, error.path, error.message, error.source);
  return invalid(error);
}
/** A derivation rejection is the honest invalid verdict; the named source stays typed, never flattened to prose. */
function invalid(error: Diagnostic): Result<InspectionReport> {
  return {
    ok: true,
    value: {
      valid: false,
      diagnostics: [error],
      warnings: [],
      crossings: 0,
      relaxed: 0,
      sections: 0,
      engineVersions: [],
    },
  };
}
/** Arranged scenes passed the independent inspector during derivation; the report surfaces their own warning record. */
function report(document: RenderDocument): InspectionReport {
  const warnings = document.scene.warnings;
  return {
    valid: true,
    diagnostics: [],
    warnings,
    crossings: warnings.filter((warning) => warning.code === 'wire-crossing').length,
    relaxed: warnings.filter((warning) => warning.code === 'constraint-relaxed').length,
    sections: document.scene.sections.length,
    engineVersions: document.scene.engineVersions,
  };
}
