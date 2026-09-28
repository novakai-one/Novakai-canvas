/*
 * Why this file exists
 *
 * `POST /api/v1/export` asks for one saved collection as a file, for example `my-diagram` at
 * revision 3 as a PNG. There are four formats, and they are made in two different ways.
 *
 * This file builds the exporter behind that route. It checks the request (request.ts), then sends
 * DSL and Markdown to text.ts, and SVG and PNG to Export (the capability), which gets its snapshot
 * from lease.ts. Every answer is a `Result` (contract/errors.ts); Export's own mistakes are kept as
 * the source. An export only reads; it never changes the workspace.
 */
import type { Result } from '../../contract/errors.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type { PresentationBindings } from '../../contract/records/capability-types.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type { Exporter, PngEncoder } from '../../contract/ports/export.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import { readExportRequest } from './request.js';
import { createResourceInspector } from './resources.js';
import { buildArtifactFile } from './files.js';
import { createDocumentsForExport, type DocumentDependencies } from './documents.js';
import { acquireSnapshot } from './lease.js';
import { exportDsl, exportMarkdown, type TextExportDependencies } from './text.js';

/** What one exporter uses: all that the text exports and the documents helper need, plus these. */
export interface ExporterDependencies extends TextExportDependencies, DocumentDependencies {
  /** Export's rules: `compose` builds Export, `formatMarkdown` writes Markdown. */
  readonly export: Pick<ExportRules, 'compose' | 'formatMarkdown'>;
  /** Presentation, which Export draws the SVG and PNG with. */
  readonly presentation: PresentationBindings;
  /** Starts on the first PNG request and turns the SVG into PNG bytes. */
  readonly pngEncoder: PngEncoder;
}

/**
 * Builds the exporter of one workspace. Its `exportFile` turns one request, as sent, into one file.
 * Nothing is read until a request arrives.
 * Mistakes: `invalid-input` for a bad request, a missing collection, an old revision or a DSL
 * export of one section; `unavailable` when the PNG encoder can't start or a file can't be made;
 * and `cancelled` when the export was stopped. Export's own mistake is kept as the source.
 */
export function createExporter(dependencies: ExporterDependencies): Exporter {
  return { exportFile: (input, signal) => invokeExport(input, signal, dependencies) };
}

/**
 * A checked request is dispatched by format; a refused one never reaches an owner. Fails as
 * `readExportRequest` (`invalid-input` at `export` or `export.scale`), or as `dispatchExport`.
 */
async function invokeExport(
  input: unknown,
  signal: AbortSignal,
  owners: ExporterDependencies,
): Promise<Result<SentFile>> {
  const request = readExportRequest(input);
  if (!request.ok) return request;
  return dispatchExport(request.value, owners, signal);
}

/**
 * DSL and Markdown are printed from a leased snapshot; SVG and PNG are encoded by Export. Fails as
 * `exportDsl`, `exportMarkdown` or `nativeExport`.
 */
async function dispatchExport(
  request: ExportRequest,
  owners: ExporterDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  switch (request.format) {
    case 'dsl':
      return exportDsl(request, owners, signal);
    case 'markdown':
      return exportMarkdown(request, owners, signal);
    default:
      return nativeExport(request, owners, signal);
  }
}

/**
 * PNG first needs the PNG encoder; an unavailable encoder refuses before any owner is read.
 * Fails with `unavailable` at `export.png` (see `prepareFormat`), or as `encodeNative`.
 */
async function nativeExport(
  request: ExportRequest,
  owners: ExporterDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  const prepared = await prepareFormat(request.format, owners);
  if (!prepared.ok) return prepared;
  return encodeNative(request, owners, signal);
}

/**
 * The PNG encoder for PNG; every other format needs nothing. Fails with `unavailable` at
 * `export.png` when the PNG encoder cannot start.
 */
async function prepareFormat(
  format: ExportRequest['format'],
  owners: ExporterDependencies,
): Promise<Result<void>> {
  return format === 'png' ? owners.pngEncoder.prepare() : { ok: true, value: undefined };
}

/**
 * Export encodes the artifact from a snapshot it acquires through this route. Fails as
 * `exportRouteFailure` of Export's diagnostic (including `acquireSnapshot`'s refusals):
 * `cancelled` stays `cancelled`, an input refusal is `invalid-input`, and `encoding-failed`
 * (also a provider throw), `cleanup-failed` or `resource-rejected` is `unavailable`.
 */
async function encodeNative(
  request: ExportRequest,
  owners: ExporterDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  const exporter = owners.export.compose({
    presentation: owners.presentation,
    readerCss: '',
    snapshots: { acquire: (identity) => acquireSnapshot(identity, owners, signal) },
    documents: createDocumentsForExport(owners),
    resources: createResourceInspector(),
  });
  return buildArtifactFile(await exporter.service.exportArtifact(request, signal));
}
