/*
 * Text exports: canonical DSL and Markdown, produced from a leased snapshot. Both formats share
 * one settle step: acquire the lease, produce the text, release the lease exactly once on every
 * path, then answer with the file or the failure; a release failure never hides the primary one.
 * A print or format throw becomes an Export `encoding-failed` refusal at the format's path
 * (`export.dsl`, `export.markdown`). Pure over the owners compose injects; the caller owns retry.
 * A lease still held when the process dies stops protecting its bytes: Assets' collection ignores
 * leases whose owner process is gone.
 */
import { failure, success, type Result } from '../../contract/errors.js';
import type { StaticFile } from '../../contract/records/transport/server.js';
import type {
  Collection,
  ExportResult,
  Language,
  SnapshotLease,
} from '../../contract/records/capabilities.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import { cancelledExport, exportRejection, exportRouteFailure, settledFailure } from './faults.js';
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
 * (`cancelled` stays, an input refusal is `invalid-input`, a fault is `unavailable`):
 * `acquireSnapshot`'s refusals, `cancelled` at `export` when the request aborted,
 * `invalid-input` at `source` when Language cannot print, `encoding-failed` at `export.dsl` when
 * Language throws, and `cleanup-failed` at `export.release` when the release fails.
 */
export async function exportDsl(
  request: ExportRequest,
  owners: TextOwners,
  signal: AbortSignal,
): Promise<Result<StaticFile>> {
  if (request.scope.kind !== 'all')
    return failure('invalid-input', 'scope', 'Canonical DSL export requires the whole collection');
  return exportText(request.identity, owners, signal, {
    name: 'dsl',
    produce: (collection) => printedDsl(collection, owners.language, signal),
    file: (source) => dslFile(request.identity, source),
  });
}

/**
 * Markdown of the requested scope from the leased collection. Every refusal is an Export
 * diagnostic, answered as `exportRouteFailure`: `acquireSnapshot`'s refusals, `cancelled` at
 * `export` when the request aborted, `invalid-input` at `scope` for a missing section,
 * `encoding-failed` at `export.markdown` when the formatter throws, and `cleanup-failed` at
 * `export.release` when the release fails.
 */
export async function exportMarkdown(
  request: ExportRequest,
  owners: TextOwners,
  signal: AbortSignal,
): Promise<Result<StaticFile>> {
  return exportText(request.identity, owners, signal, {
    name: 'markdown',
    produce: (collection) => markdownText(signal, collection, request.scope, owners.export),
    file: (source) => markdownFile(request, source),
  });
}

/** The text formats this file exports. */
type TextFormatName = 'dsl' | 'markdown';

/**
 * One text format: its name, how the leased collection becomes text, and how that text becomes a
 * file.
 */
interface TextFormat {
  readonly name: TextFormatName;
  readonly produce: (collection: Collection) => ExportResult<string>;
  readonly file: (text: string) => StaticFile;
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
): Promise<Result<StaticFile>> {
  const acquired = await acquireSnapshot(identity, owners, signal);
  if (!acquired.ok) return exportRouteFailure(acquired);
  const settled = await settleText(format, acquired.value);
  if (!settled.ok) return exportRouteFailure(settled);
  return success(format.file(settled.value));
}

/**
 * The format's text, with the lease released exactly once afterwards on every path: producing
 * never throws. Fails as `producedText`, or with `cleanup-failed` at `export.release` when the
 * release fails (nested under `cleanup` after a refusal).
 */
async function settleText(
  format: TextFormat,
  lease: SnapshotLease,
): Promise<ExportResult<string>> {
  const produced = producedText(format, lease.snapshot.collection);
  const released = await lease.release();
  return settledFailure(produced, released);
}

/**
 * The format's text from the leased collection; a throw becomes a refusal, so the caller always
 * reaches the release. Fails with the format's own refusal, or `encoding-failed` at `export.dsl`
 * or `export.markdown` when printing or formatting throws.
 */
function producedText(
  format: TextFormat,
  collection: Collection,
): ExportResult<string> {
  try {
    return format.produce(collection);
  } catch {
    const fault = PRODUCTION_FAULT[format.name];
    return exportRejection('encoding-failed', fault.path, fault.message);
  }
}

/** Where a throw while producing a format's text is reported, and what the refusal says. */
interface ProductionFault {
  readonly path: string;
  readonly message: string;
}

/** Each format's production fault. Frozen. */
const PRODUCTION_FAULT: Readonly<Record<TextFormatName, ProductionFault>> = Object.freeze({
  dsl: { path: 'export.dsl', message: 'The collection could not be printed as DSL' },
  markdown: {
    path: 'export.markdown',
    message: 'The collection could not be formatted as Markdown',
  },
});

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
