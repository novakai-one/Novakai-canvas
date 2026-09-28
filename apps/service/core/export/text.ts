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
  if (request.scope.kind !== 'all') {
    return sectionDslFailure();
  }
  const dsl: TextFormat = {
    name: 'dsl',
    write: (collection) => printDslUnlessStopped(collection, dependencies.language, signal),
    buildFile: (text) => buildDslFile(request.identity, text),
  };
  return exportText(request.identity, dependencies, signal, dsl);
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
  const markdown: TextFormat = {
    name: 'markdown',
    write: (collection) =>
      formatCollectionMarkdown(signal, collection, request.scope, dependencies.export),
    buildFile: (text) => buildMarkdownFile(request, text),
  };
  return exportText(request.identity, dependencies, signal, markdown);
}

/** The text formats this file exports. */
type TextFormatName = 'dsl' | 'markdown';

/** One text format: its name, how a collection is written as text, and how text becomes a file. */
interface TextFormat {
  readonly name: TextFormatName;
  readonly write: (collection: Collection) => ExportResult<string>;
  readonly buildFile: (text: string) => SentFile;
}

/** Holds the collection's files, writes the text, lets go, then answers the file. */
async function exportText(
  identity: ExportRequest['identity'],
  dependencies: LeaseDependencies,
  signal: AbortSignal,
  format: TextFormat,
): Promise<Result<SentFile>> {
  const held = await acquireSnapshot(identity, dependencies, signal);
  if (!held.ok) {
    return exportRouteFailure(held);
  }
  const text = await writeThenRelease(format, held.value);
  if (!text.ok) {
    return exportRouteFailure(text);
  }
  const file = format.buildFile(text.value);
  return success(file);
}

/** Writes the text, then lets go of the held files exactly once, whatever the writing did. */
async function writeThenRelease(
  format: TextFormat,
  lease: SnapshotLease,
): Promise<ExportResult<string>> {
  const written = writeText(format, lease.snapshot.collection);
  const released = await lease.release();
  return combineWithCleanup(written, released);
}

/** Writes the collection as the format's text, turning a throw into a mistake. */
function writeText(
  format: TextFormat,
  collection: Collection,
): ExportResult<string> {
  try {
    return format.write(collection);
  } catch {
    return writingThrewFailure(format.name);
  }
}

/** Writes the collection as DSL, unless the export was already stopped. */
function printDslUnlessStopped(
  collection: Collection,
  language: Pick<Language, 'print'>,
  signal: AbortSignal,
): ExportResult<string> {
  if (signal.aborted) {
    return cancelledFailure();
  }
  return printCollectionDsl(language, collection);
}

/** Makes the mistake for a DSL export of one section: `invalid-input` at `scope`. */
function sectionDslFailure(): Result<never> {
  return failure('invalid-input', 'scope', 'Canonical DSL export requires the whole collection');
}

/** Makes the mistake for a format whose writing threw: `encoding-failed` at `export.<format>`. */
function writingThrewFailure(name: TextFormatName): ExportResult<never> {
  const fault = WRITING_FAULT[name];
  return exportFailure('encoding-failed', fault.path, fault.message);
}

/** Where a throw while writing a format's text is reported, and what the mistake says. */
interface WritingFault {
  readonly path: string;
  readonly message: string;
}

/** Each format's writing fault. Frozen. */
const WRITING_FAULT: Readonly<Record<TextFormatName, WritingFault>> = Object.freeze({
  dsl: { path: 'export.dsl', message: 'The collection could not be printed as DSL' },
  markdown: {
    path: 'export.markdown',
    message: 'The collection could not be formatted as Markdown',
  },
});
