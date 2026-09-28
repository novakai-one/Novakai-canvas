/*
 * Why this file exists
 *
 * Not every export is a picture. An agent can ask for `my-diagram` at revision 3 as DSL (the
 * `.canvas` text it could edit) or as Markdown. The service writes that text itself, not Export.
 *
 * This file does both: it holds the collection's files (lease.ts), writes the text, lets go, and
 * answers the file. It lets go exactly once, even when writing throws, and a failure to let go
 * never hides the export's own mistake. Mistakes come from faults.ts, as `Result`s
 * (contract/errors.ts). It never changes the workspace.
 */
import { failure, success, type Result } from '../../contract/errors.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type {
  Collection,
  ExportResult,
  Language,
  SnapshotLease,
} from '../../contract/records/capability-types.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import {
  cancelledFailure,
  exportFailure,
  exportRouteFailure,
  combineWithCleanup,
} from './faults.js';
import { buildDslFile, buildMarkdownFile } from './files.js';
import { formatCollectionMarkdown, printCollectionDsl } from './documents.js';
import { acquireSnapshot, type LeaseDependencies } from './lease.js';

/** What the DSL and Markdown exports use, besides what holding the collection needs. */
export interface TextExportDependencies extends LeaseDependencies {
  /** Language, which writes a collection as DSL text. */
  readonly language: Pick<Language, 'print'>;
  /** Export's rules; only its Markdown formatter is used here. */
  readonly export: Pick<ExportRules, 'formatMarkdown'>;
}

/**
 * Exports the whole collection as a DSL (`.canvas`) file.
 * Fails with `invalid-input` at `scope` when one section is asked for, or at `source` when
 * Language can't print the collection; `unavailable` when printing throws or letting go fails;
 * otherwise as `acquireSnapshot` fails, in the service's codes (see `exportRouteFailure`).
 */
export async function exportDsl(
  request: ExportRequest,
  dependencies: TextExportDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  if (request.scope.kind !== 'all')
    return failure('invalid-input', 'scope', 'Canonical DSL export requires the whole collection');
  return exportText(request.identity, dependencies, signal, {
    name: 'dsl',
    produce: (collection) => printedDsl(collection, dependencies.language, signal),
    file: (source) => buildDslFile(request.identity, source),
  });
}

/**
 * Exports the collection, or one section of it, as a Markdown (`.md`) file.
 * Fails with `invalid-input` at `scope` for a missing section; `unavailable` when formatting
 * throws or letting go fails; otherwise as `acquireSnapshot` fails, in the service's codes (see
 * `exportRouteFailure`).
 */
export async function exportMarkdown(
  request: ExportRequest,
  dependencies: TextExportDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  return exportText(request.identity, dependencies, signal, {
    name: 'markdown',
    produce: (collection) =>
      formatCollectionMarkdown(signal, collection, request.scope, dependencies.export),
    file: (source) => buildMarkdownFile(request, source),
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
  readonly file: (text: string) => SentFile;
}

/**
 * Lease the snapshot, produce the text, release the lease, then answer with the file. Fails as
 * `exportRouteFailure` of `acquireSnapshot`'s refusal, or of `settleText`'s.
 */
async function exportText(
  identity: ExportRequest['identity'],
  owners: LeaseDependencies,
  signal: AbortSignal,
  format: TextFormat,
): Promise<Result<SentFile>> {
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
  return combineWithCleanup(produced, released);
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
    return exportFailure('encoding-failed', fault.path, fault.message);
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
  if (signal.aborted) return cancelledFailure();
  return printCollectionDsl(language, collection);
}
