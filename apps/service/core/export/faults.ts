/*
 * Why this file exists
 *
 * An export can go wrong in many places: an old revision is asked for, rendering fails, or letting
 * go of the held files fails afterwards. For example, asking for `my-diagram` at revision 2 when
 * it is at revision 3 is `snapshot-mismatch` at `identity.revision`.
 *
 * This file makes those mistakes in Export's own form, and turns the final one into the service's
 * answer (`invalid-input`, `cancelled` or `unavailable`), keeping Export's mistake as the source.
 * A failure to let go never hides the export's own mistake. It never throws.
 */
import { failure, type ErrorCode, type Result } from '../../contract/errors.js';
import type { CapabilityFailure } from '../../contract/records/transport/failure-source.js';
import type {
  AssetResult,
  AuthoringErrorCode,
  ExportDiagnostic,
  ExportErrorCode,
  ExportResult,
} from '../../contract/records/capability-types.js';
import type { ExportFailure } from '../../contract/records/export/snapshot.js';

/**
 * Makes an Export mistake: `code` at `path`, with `message`. Every export mistake carries the same
 * advice: correct the input or repair the failing part, then try again.
 */
export function exportFailure(
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

/** Makes the mistake for an export that was stopped: `cancelled` at `export`. */
export function cancelledFailure(): ExportResult<never> {
  return exportFailure('cancelled', 'export', 'Export was cancelled');
}

/** A failure from reading the workspace (Authoring) or from rendering (the service). */
type ReadOrRenderError = {
  readonly code: AuthoringErrorCode | ErrorCode;
  readonly message: string;
};

/**
 * Turns a failure from reading the workspace or rendering into an Export mistake at `path`.
 * `cancelled` stays `cancelled`; any other code becomes `encoding-failed`. The message is kept.
 */
export function readOrRenderFailure(
  error: ReadOrRenderError,
  path: string,
): ExportResult<never> {
  if (error.code === 'cancelled') return exportFailure('cancelled', path, error.message);
  return exportFailure('encoding-failed', path, error.message);
}

/**
 * Turns Assets' answer to letting go of held files into Export's answer. A refusal becomes
 * `cleanup-failed` at `export.release`.
 */
export function translateRelease(release: AssetResult<void>): ExportResult<void> {
  if (release.ok) return release;
  return exportFailure('cleanup-failed', 'export.release', release.error.message);
}

/**
 * Combines the export's own answer with the answer to letting go of its held files.
 * If letting go failed, a success becomes that `cleanup-failed` mistake, and an earlier mistake
 * keeps its code and carries the clean-up mistake under `cleanup`. Otherwise `primary` is kept.
 */
export function combineWithCleanup<T>(
  primary: ExportResult<T>,
  cleanup: ExportResult<void>,
): ExportResult<T> {
  if (cleanup.ok) return primary;
  if (primary.ok) return cleanup;
  return { ok: false, error: { ...primary.error, cleanup: cleanup.error } };
}

/**
 * Turns an Export mistake into the service's failure, keeping Export's mistake as `source`.
 * `cancelled` stays `cancelled`; a mistake in the request is `invalid-input`; a storage, render or
 * clean-up fault is `unavailable`.
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
function exportSource(diagnostic: ExportDiagnostic): CapabilityFailure {
  return {
    code: diagnostic.code,
    path: diagnostic.path,
    message: diagnostic.message,
    recovery: diagnostic.recovery,
    cleanup: cleanupSource(diagnostic.cleanup),
  };
}

/** A nested cleanup failure as source evidence; undefined when the cleanup succeeded. */
function cleanupSource(cleanup: ExportDiagnostic | undefined): CapabilityFailure | undefined {
  if (cleanup === undefined) return undefined;
  return exportSource(cleanup);
}
