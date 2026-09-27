/*
 * Export failure vocabulary: every refusal the export route builds is an Export diagnostic with
 * one recovery text. Owner failures are translated by code, never by message; a cleanup failure
 * never hides the primary outcome; and the route turns the final diagnostic into the service
 * outcome, keeping the diagnostic as structured source evidence.
 */
import { failure } from '../../contract/errors.js';
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { OperationSource } from '../../contract/records/transport/failure-source.js';
import type {
  AssetResult,
  ExportDiagnostic,
  ExportErrorCode,
  ExportFailure,
  ExportResult,
} from '../../contract/records/export/request.js';

/** An Export refusal carrying the route's one recovery text. */
export function exportRejection(
  code: ExportErrorCode,
  path: string,
  message: string,
): ExportResult<never> {
  return {
    ok: false,
    error: {
      code,
      path,
      message,
      recovery: 'Correct the input or repair the provider, then retry the read.',
    },
  };
}

/** The refusal of a request whose signal aborted. */
export function cancelledExport(): ExportResult<never> {
  return exportRejection('cancelled', 'export', 'Export was cancelled');
}

/** An owner failure at `path`: cancellation stays cancellation, anything else failed encoding. */
export function ownerRejection(
  error: { readonly code: string; readonly message: string },
  path: string,
): ExportResult<never> {
  return exportRejection(
    error.code === 'cancelled' ? 'cancelled' : 'encoding-failed',
    path,
    error.message,
  );
}

/** A lease release in Export's vocabulary; a refused release is a cleanup failure. */
export function releaseOutcome(result: AssetResult<void>): ExportResult<void> {
  return result.ok
    ? result
    : exportRejection('cleanup-failed', 'export.release', result.error.message);
}

/** The primary outcome; a failed cleanup replaces a success or nests under a primary failure. */
export function settledFailure<T>(
  primary: ExportResult<T>,
  cleanup: ExportResult<void>,
): ExportResult<T> {
  if (cleanup.ok) return primary;
  if (primary.ok) return cleanup;
  return { ok: false, error: { ...primary.error, cleanup: cleanup.error } };
}

/** The service failure of an export: cancellation stays cancellation, the rest is invalid input. */
export function exportRouteFailure(result: ExportFailure): RouteOutcome {
  const code = result.error.code === 'cancelled' ? 'cancelled' : 'invalid-input';
  return failure(code, result.error.path, result.error.message, exportSource(result.error));
}

/** The diagnostic as source evidence; an absent cleanup stays an explicit undefined key. */
function exportSource(error: ExportDiagnostic): OperationSource {
  return {
    code: error.code,
    path: error.path,
    message: error.message,
    recovery: error.recovery,
    cleanup: error.cleanup === undefined ? undefined : exportSource(error.cleanup),
  };
}
