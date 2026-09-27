/*
 * Text exports: canonical DSL and Markdown, produced from a leased snapshot. Both formats share
 * one settle step: acquire the lease, produce the text, release the lease exactly once, then
 * answer with the file or the failure; a release failure never hides the primary one. A print or
 * format throw releases the lease first, then continues to the HTTP server's `receive`, which
 * answers it `unavailable` at `request`. Pure over the owners compose injects; the caller owns
 * retry. A lease still held when the process dies stops protecting its bytes: Assets' collection
 * ignores leases whose owner process is gone.
 */
import { failure } from '../../contract/errors.js';
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { Collection, Language } from '../../contract/records/capabilities.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type {
  ExportRequest,
  ExportResult,
  SnapshotLease,
} from '../../contract/records/export/request.js';
import { cancelledExport, exportRouteFailure, settledFailure } from './faults.js';
import { dslFile, markdownFile } from './files.js';
import { markdownText, printedSource } from './documents.js';
import { acquireSnapshot, type LeaseOwners } from './lease.js';

/** The owners text exports lease, print and format through. */
export interface TextOwners extends LeaseOwners {
  readonly language: Pick<Language, 'print'>;
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
  return exportText(request.identity, owners, signal, {
    produce: (collection) => printedDsl(collection, owners.language, signal),
    file: (source) => dslFile(request.identity, source),
  });
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
  return exportText(request.identity, owners, signal, {
    produce: (collection) => markdownText(signal, collection, request.scope, owners.export),
    file: (source) => markdownFile(request, source),
  });
}

/** One text format: how the leased collection becomes text, and how that text becomes a file. */
interface TextFormat {
  readonly produce: (collection: Collection) => ExportResult<string>;
  readonly file: (text: string) => RouteOutcome;
}

/**
 * Lease the snapshot, produce the text, release the lease, then answer with the file. Fails as
 * `exportRouteFailure` of `acquireSnapshot`'s refusal, or of `settleText`'s.
 */
async function exportText(
  identity: ExportRequest['identity'],
  owners: LeaseOwners,
  signal: AbortSignal,
  format: TextFormat,
): Promise<RouteOutcome> {
  const acquired = await acquireSnapshot(identity, owners, signal);
  if (!acquired.ok) return exportRouteFailure(acquired);
  const settled = await settleText(format, acquired.value);
  if (!settled.ok) return exportRouteFailure(settled);
  return format.file(settled.value);
}

/**
 * The format's text, with the lease released once afterwards. Fails with the format's own
 * refusal, or `cleanup-failed` at `export.release` when the release fails (nested under `cleanup`
 * after a refusal).
 */
async function settleText(
  format: TextFormat,
  lease: SnapshotLease,
): Promise<ExportResult<string>> {
  const primary = await producedText(format, lease);
  return settledFailure(primary, await lease.release());
}

/**
 * The format's text from the leased collection. Fails with the format's own refusal. A throw
 * releases the lease first, then continues unchanged; that release outcome is not reported, so it
 * never hides the throw.
 */
async function producedText(
  format: TextFormat,
  lease: SnapshotLease,
): Promise<ExportResult<string>> {
  try {
    return format.produce(lease.snapshot.collection);
  } catch (error: unknown) {
    await lease.release();
    throw error;
  }
}

/**
 * The canonical DSL of the collection. Fails with `cancelled` at `export` when the request
 * aborted, and `invalid-input` at `source` when Language cannot print.
 */
function printedDsl(
  collection: Collection,
  language: Pick<Language, 'print'>,
  signal: AbortSignal,
): ExportResult<string> {
  if (signal.aborted) return cancelledExport();
  return printedSource(language, collection);
}
