import type { SessionDependencies } from '../../contract/types.js';
import type { InspectionReport } from '../../contract/records/inspection.js';
import type { RenderDocument } from '../../contract/records/rendering.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { renderCollection } from './collection.js';
/**
 * The valid report of a freshly rendered document: the scene passed the independent inspector
 * during derivation, so the report is its own warning record, the crossing and relaxed-constraint
 * counts, the section count and the engine versions. Pure; cannot fail. The headless render
 * (apps/cli) reports it too.
 */
export function validReport(document: RenderDocument): InspectionReport {
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
/** Missing collections and infrastructure failures are routing errors, not diagram quality verdicts. */
function rejected(error: Diagnostic): Result<InspectionReport> {
  if (error.code !== 'invalid-input')
    return failure(error.code, error.path, error.message, error.source);
  return invalid(error);
}
/** One consistent committed read serves both render and quality consumers; no cache can mutate it. */
export async function inspectCollection(
  id: string,
  signal: AbortSignal,
  dependencies: SessionDependencies,
): Promise<Result<InspectionReport>> {
  const outcome = await renderCollection(id, signal, dependencies);
  if (!outcome.ok) return rejected(outcome.error);
  return { ok: true, value: validReport(outcome.value) };
}
