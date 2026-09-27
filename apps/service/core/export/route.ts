/*
 * The workspace export route: a read-only projection over one current Authoring snapshot. A
 * checked request is dispatched by format: DSL and Markdown are printed from a leased snapshot
 * (text.ts); SVG and PNG are encoded by Export, which acquires its snapshot through the route's
 * lease (lease.ts). Every path releases its lease once, also when a DSL print or Markdown
 * format throws (text.ts). Pure over the owners compose injects; the caller owns retry.
 */
import type { Result } from '../../contract/errors.js';
import type { StaticFile } from '../../contract/records/transport/server.js';
import type { PresentationBindings } from '../../contract/records/capabilities.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type { ExportHandler, Rasterizer } from '../../contract/ports/export.js';
import type { ExportRequest } from '../../contract/records/export/request.js';
import { readExportRequest } from './request.js';
import { resourceInspector } from './resources.js';
import { artifactOutcome } from './files.js';
import { exportDocuments, type DocumentOwners } from './documents.js';
import { acquireSnapshot } from './lease.js';
import { exportDsl, exportMarkdown, type TextOwners } from './text.js';

/** Everything one export reads through: the text and lease owners, plus Export's documents port. */
export interface ExportRouteOwners extends TextOwners, DocumentOwners {
  readonly export: Pick<ExportRules, 'compose' | 'formatMarkdown'>;
  readonly presentation: PresentationBindings;
  readonly rasterizer: Rasterizer;
}

/**
 * The export route of one workspace; starts no I/O. `invoke` answers one file, or fails with
 * `invalid-input` for a refused request (see `readExportRequest`) or a DSL scope other than the
 * whole collection (at `scope`), `unavailable` at `export.png` when the rasterizer cannot start,
 * and otherwise as `exportRouteFailure`: an Export refusal is `cancelled` or `invalid-input`,
 * with Export's diagnostic kept as source. Every export only reads; the caller owns the retry.
 */
export function createExportRoute(owners: ExportRouteOwners): ExportHandler {
  return { invoke: (input, signal) => invokeExport(input, signal, owners) };
}

/**
 * A checked request is dispatched by format; a refused one never reaches an owner. Fails as
 * `readExportRequest` (`invalid-input` at `export` or `export.scale`), or as `dispatchExport`.
 */
async function invokeExport(
  input: unknown,
  signal: AbortSignal,
  owners: ExportRouteOwners,
): Promise<Result<StaticFile>> {
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
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<Result<StaticFile>> {
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
 * PNG first needs the rasterizer; an unavailable rasterizer refuses before any owner is read.
 * Fails with `unavailable` at `export.png` (see `prepareFormat`), or as `encodeNative`.
 */
async function nativeExport(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<Result<StaticFile>> {
  const prepared = await prepareFormat(request.format, owners);
  if (!prepared.ok) return prepared;
  return encodeNative(request, owners, signal);
}

/**
 * The rasterizer for PNG; every other format needs nothing. Fails with `unavailable` at
 * `export.png` when the rasterizer cannot start.
 */
async function prepareFormat(
  format: ExportRequest['format'],
  owners: ExportRouteOwners,
): Promise<Result<void>> {
  return format === 'png' ? owners.rasterizer.prepare() : { ok: true, value: undefined };
}

/**
 * Export encodes the artifact from a snapshot it acquires through this route. Fails as
 * `exportRouteFailure` of Export's diagnostic: `cancelled` stays `cancelled`, the rest (including
 * `acquireSnapshot`'s refusals and a provider throw as `encoding-failed`) is `invalid-input`.
 */
async function encodeNative(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<Result<StaticFile>> {
  const exporter = owners.export.compose({
    presentation: owners.presentation,
    readerCss: '',
    snapshots: { acquire: (identity) => acquireSnapshot(identity, owners, signal) },
    documents: exportDocuments(owners),
    resources: resourceInspector(),
  });
  return artifactOutcome(await exporter.service.exportArtifact(request, signal));
}
