/*
 * Export failure vocabulary: every refusal the export route builds is an Export diagnostic with
 * one recovery text. Owner failures are translated by code, never by message; a cleanup failure
 * never hides the primary outcome; and the route turns the final diagnostic into the service
 * outcome, keeping the diagnostic as structured source evidence. Pure; the caller corrects its
 * request, or retries once the failed dependency is restored.
 */
import { failure, type ErrorCode, type Result } from '../../contract/errors.js';
import type { OperationSource } from '../../contract/records/transport/failure-source.js';
import type {
  AssetResult,
  AuthoringErrorCode,
  ExportDiagnostic,
  ExportErrorCode,
  ExportResult,
} from '../../contract/records/capabilities.js';
import type { ExportFailure } from '../../contract/records/export/snapshot.js';

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

/** An Authoring read or service render failure; the codes `ownerRejection` translates. */
type OwnerFailure = { readonly code: AuthoringErrorCode | ErrorCode; readonly message: string };

/** An owner failure at `path`: cancellation stays cancellation, anything else failed encoding. */
export function ownerRejection(
  error: OwnerFailure,
  path: string,
): ExportResult<never> {
  if (error.code === 'cancelled') return exportRejection('cancelled', path, error.message);
  return exportRejection('encoding-failed', path, error.message);
}

/** A lease release in Export's vocabulary; a refused release is a cleanup failure. */
export function releaseOutcome(release: AssetResult<void>): ExportResult<void> {
  if (release.ok) return release;
  return exportRejection('cleanup-failed', 'export.release', release.error.message);
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

/**
 * The service failure of an export: its code mapped by `ROUTE_CODE`, with Export's diagnostic
 * kept as source. `cancelled` stays `cancelled`, an input refusal is `invalid-input`, and
 * `encoding-failed`, `cleanup-failed` or `resource-rejected` is `unavailable`.
 */
export function exportRouteFailure(refusal: ExportFailure): Result<never> {
  const { code, path, message } = refusal.error;
  return failure(ROUTE_CODE[code], path, message, exportSource(refusal.error));
}

/** The service codes an Export refusal becomes. */
type RouteCode = Extract<ErrorCode, 'invalid-input' | 'cancelled' | 'unavailable'>;

/**
 * The service code of each Export code. An input refusal is `invalid-input` (422): the caller
 * corrects the request. A storage, lease, render or stored-data fault is `unavailable` (503):
 * the caller cannot correct it, so the dependency is restored and the export retried.
 * `cancelled` stays `cancelled` (409).
 */
const ROUTE_CODE: Readonly<Record<ExportErrorCode, RouteCode>> = Object.freeze({
  'invalid-input': 'invalid-input',
  'snapshot-mismatch': 'invalid-input',
  'missing-section': 'invalid-input',
  'limit-exceeded': 'invalid-input',
  'invalid-bundle': 'invalid-input',
  'invalid-import': 'invalid-input',
  cancelled: 'cancelled',
  'encoding-failed': 'unavailable',
  'cleanup-failed': 'unavailable',
  'resource-rejected': 'unavailable',
});

/** The diagnostic as source evidence; an absent cleanup stays an explicit undefined key. */
function exportSource(diagnostic: ExportDiagnostic): OperationSource {
  return {
    code: diagnostic.code,
    path: diagnostic.path,
    message: diagnostic.message,
    recovery: diagnostic.recovery,
    cleanup: cleanupSource(diagnostic.cleanup),
  };
}

/** A nested cleanup failure as source evidence; undefined when the cleanup succeeded. */
function cleanupSource(cleanup: ExportDiagnostic | undefined): OperationSource | undefined {
  if (cleanup === undefined) return undefined;
  return exportSource(cleanup);
}
