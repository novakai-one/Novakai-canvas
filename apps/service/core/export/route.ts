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
import { success, type Result } from '../../contract/errors.js';
import type { SentFile } from '../../contract/records/transport/server.js';
import type { PresentationBindings } from '../../contract/records/capability-types.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type { Exporter, PngEncoder } from '../../contract/ports/export.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import { readExportRequest } from './request.js';
import { createPassThroughResources } from './resources.js';
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
  return { exportFile: (body, signal) => exportOneFile(body, signal, dependencies) };
}

/** Checks the request as sent, then makes the file in the format it asks for. */
async function exportOneFile(
  body: unknown,
  signal: AbortSignal,
  dependencies: ExporterDependencies,
): Promise<Result<SentFile>> {
  const request = readExportRequest(body);
  if (!request.ok) {
    return request;
  }
  return exportByFormat(request.value, dependencies, signal);
}

/** Sends DSL and Markdown to the text exports, and SVG and PNG to Export. */
async function exportByFormat(
  request: ExportRequest,
  dependencies: ExporterDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  switch (request.format) {
    case 'dsl':
      return exportDsl(request, dependencies, signal);
    case 'markdown':
      return exportMarkdown(request, dependencies, signal);
    default:
      return exportPicture(request, dependencies, signal);
  }
}

/** Starts the PNG encoder for a PNG, then has Export draw the SVG or PNG file. */
async function exportPicture(
  request: ExportRequest,
  dependencies: ExporterDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  const encoder = await startEncoderFor(request.format, dependencies);
  if (!encoder.ok) {
    return encoder;
  }
  return drawWithExport(request, dependencies, signal);
}

/** Starts the PNG encoder when the format is PNG; any other format needs nothing started. */
async function startEncoderFor(
  format: ExportRequest['format'],
  dependencies: ExporterDependencies,
): Promise<Result<void>> {
  if (format === 'png') {
    return dependencies.pngEncoder.prepare();
  }
  return success(undefined);
}

/** Builds Export for this request, has it draw the file, and wraps the file as the download. */
async function drawWithExport(
  request: ExportRequest,
  dependencies: ExporterDependencies,
  signal: AbortSignal,
): Promise<Result<SentFile>> {
  const exporter = dependencies.export.compose({
    presentation: dependencies.presentation,
    readerCss: '',
    snapshots: { acquire: (identity) => acquireSnapshot(identity, dependencies, signal) },
    documents: createDocumentsForExport(dependencies),
    resources: createPassThroughResources(),
  });
  const artifact = await exporter.service.exportArtifact(request, signal);
  return buildArtifactFile(artifact);
}
