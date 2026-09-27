/*
 * Text exports: canonical DSL and Markdown, printed from a leased snapshot. Each export acquires
 * the lease, prints, releases the lease once, then answers with the file or the failure; a
 * release failure never hides the primary one. A print or format throw escapes unreleased; the
 * HTTP server's `receive` answers it `unavailable` at `request`. Pure over the owners compose
 * injects; the caller owns retry.
 */
import { failure } from '../../contract/errors.js';
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type {
  ExportRequest,
  ExportResult,
  SnapshotLease,
} from '../../contract/records/export/export.js';
import { cancelledExport, exportRouteFailure, settledFailure } from './faults.js';
import { dslFile, markdownFile } from './files.js';
import { exportDocuments, markdownText, type DocumentOwners } from './documents.js';
import { acquireSnapshot, type LeaseOwners } from './lease.js';

/** The owners text exports lease, print and format through. */
export interface TextOwners extends DocumentOwners, LeaseOwners {
  readonly export: Pick<ExportRules, 'formatMarkdown'>;
}

/**
 * Canonical DSL covers the whole collection only. Fails with `invalid-input` at `scope` for any
 * other scope. Every other refusal is an Export diagnostic, answered as `exportRouteFailure`
 * (`cancelled` stays `cancelled`, the rest is `invalid-input`): `acquireSnapshot`'s refusals,
 * `cancelled` at `export` when the request aborted, `invalid-input` at `source` when Language
 * cannot print, and `cleanup-failed` at `export.release` when the release fails.
 */
export async function exportDsl(
  request: ExportRequest,
  owners: TextOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  if (request.scope.kind !== 'all')
    return failure('invalid-input', 'scope', 'Canonical DSL export requires the whole collection');
  const acquired = await acquireSnapshot(request.identity, owners, signal);
  if (!acquired.ok) return exportRouteFailure(acquired);
  return settleDsl(request, owners, signal, acquired.value);
}

/** Print the leased collection, release the lease, then answer with the file or the failure. */
async function settleDsl(
  request: ExportRequest,
  owners: TextOwners,
  signal: AbortSignal,
  lease: SnapshotLease,
): Promise<RouteOutcome> {
  const primary: ExportResult<string> = signal.aborted
    ? cancelledExport()
    : exportDocuments(owners).print(lease.snapshot.collection);
  const settled = settledFailure(primary, await lease.release());
  return settled.ok ? dslFile(request.identity, settled.value) : exportRouteFailure(settled);
}

/**
 * Markdown of the requested scope from the leased collection. Every refusal is an Export
 * diagnostic, answered as `exportRouteFailure`: `acquireSnapshot`'s refusals, `cancelled` at
 * `export` when the request aborted, `invalid-input` at `scope` for a missing section, and
 * `cleanup-failed` at `export.release` when the release fails.
 */
export async function exportMarkdown(
  request: ExportRequest,
  owners: TextOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const acquired = await acquireSnapshot(request.identity, owners, signal);
  if (!acquired.ok) return exportRouteFailure(acquired);
  return settleMarkdown(request, owners, signal, acquired.value);
}

/** Format the leased collection, release the lease, then answer with the file or the failure. */
async function settleMarkdown(
  request: ExportRequest,
  owners: TextOwners,
  signal: AbortSignal,
  lease: SnapshotLease,
): Promise<RouteOutcome> {
  const primary = markdownText(signal, lease.snapshot.collection, request.scope, owners.export);
  const settled = settledFailure(primary, await lease.release());
  return settled.ok ? markdownFile(request, settled.value) : exportRouteFailure(settled);
}
