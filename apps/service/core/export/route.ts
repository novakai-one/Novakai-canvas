/*
 * The workspace export route: a read-only projection over one current Authoring snapshot. A
 * checked request reads the workspace, selects the collection at its exact revision (a stale one
 * is refused), leases its resources, renders it and hands Export an immutable snapshot; DSL and
 * Markdown are printed from that snapshot. The route guards rendering and the lease: every
 * returned outcome releases the lease once, and a release failure never hides the primary one.
 * A print or format throw escapes unreleased; the HTTP server's `receive` answers it `unavailable`
 * at `request`. Pure over the owners compose injects; the caller owns retry.
 */
import { failure, type Result } from '../../contract/errors.js';
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import type {
  Assets,
  Authoring,
  PresentationBindings,
  Snapshot,
} from '../../contract/records/capabilities.js';
import type { ExportRules } from '../../contract/ports/capabilities.js';
import type { CollectionRenderer } from '../../contract/ports/collection-renderer.js';
import type { PngRuntime } from '../../contract/ports/export.js';
import type { ResourceSelector } from '../../contract/records/planning/planning.js';
import type { WorkspaceReader } from '../../contract/records/workspace/contents.js';
import type {
  AssetResult,
  ExportHandler,
  ExportRequest,
  ExportResult,
  ExportSnapshot,
  ReadLease,
  SelectedCollection,
  SnapshotLease,
  StoredBlob,
} from '../../contract/records/export/export.js';
import { readExportRequest } from './request.js';
import {
  cancelledExport,
  exportRejection,
  exportRouteFailure,
  releaseOutcome,
  settledFailure,
} from './faults.js';
import {
  exportSnapshot,
  renderedDocument,
  selectedCollection,
  workspaceSnapshot,
} from './snapshot.js';
import { resourceInspector } from './resources.js';
import { artifactOutcome, dslFile, markdownFile } from './files.js';
import { exportDocuments, markdownText, type DocumentOwners } from './documents.js';

/** Everything one export reads through, each narrowed to the members export calls. */
export interface ExportRouteOwners extends DocumentOwners {
  readonly workspace: string;
  readonly export: Pick<ExportRules, 'compose' | 'formatMarkdown'>;
  readonly presentation: PresentationBindings;
  readonly assets: Pick<Assets, 'acquire'>;
  readonly views: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
  readonly renderer: CollectionRenderer;
  readonly png: PngRuntime;
  readonly authoring: (signal: AbortSignal) => Pick<Authoring, 'read'>;
}

/**
 * The export route of one workspace; starts no I/O. `invoke` answers one file, or fails with
 * `invalid-input` for a refused request (see `readExportRequest`) or a DSL scope other than the
 * whole collection (at `scope`), `unavailable` at `export.png` when the PNG runtime cannot start,
 * and otherwise as `exportRouteFailure`: an Export refusal is `cancelled` or `invalid-input`,
 * with Export's diagnostic kept as source. Every export only reads; the caller owns the retry.
 */
export function createExportRoute(owners: ExportRouteOwners): ExportHandler {
  return { invoke: (input, signal) => invokeExport(input, signal, owners) };
}

/** A checked request is dispatched by format; a refused one never reaches an owner. */
async function invokeExport(
  input: unknown,
  signal: AbortSignal,
  owners: ExportRouteOwners,
): Promise<RouteOutcome> {
  const request = readExportRequest(input);
  if (!request.ok) return request;
  return dispatchExport(request.value, owners, signal);
}

/** DSL and Markdown are printed here; SVG and PNG are encoded by Export. */
async function dispatchExport(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  switch (request.format) {
    case 'dsl':
      return dsl(request, owners, signal);
    case 'markdown':
      return markdown(request, owners, signal);
    default:
      return nativeExport(request, owners, signal);
  }
}

/** PNG first needs its runtime; an unavailable runtime refuses before any owner is read. */
async function nativeExport(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const prepared = await prepareFormat(request.format, owners);
  if (!prepared.ok) return prepared;
  return encodeNative(request, owners, signal);
}

/** The PNG runtime for PNG; every other format needs nothing. */
async function prepareFormat(
  format: ExportRequest['format'],
  owners: ExportRouteOwners,
): Promise<Result<void>> {
  return format === 'png' ? owners.png.prepare() : { ok: true, value: undefined };
}

/** Export encodes the artifact from a snapshot it acquires through this route. */
async function encodeNative(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const exporter = owners.export.compose({
    presentation: owners.presentation,
    readerCss: '',
    snapshots: { acquire: (identity) => acquireSnapshot(identity, owners, signal) },
    documents: exportDocuments(owners),
    resources: resourceInspector(),
  });
  return artifactOutcome(await exporter.service.exportArtifact(request, signal));
}

/** Read the workspace, select the exact revision, then lease and prepare its snapshot. */
async function acquireSnapshot(
  identity: ExportRequest['identity'],
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const current = await readWorkspace(owners, signal);
  if (!current.ok) return current;
  const selected = selectedCollection(owners.views.read(current.value), identity);
  if (!selected.ok) return selected;
  return retainSnapshot(selected.value, owners, signal);
}

/** The current Authoring snapshot; an aborted request is never read. */
async function readWorkspace(
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<ExportResult<Snapshot>> {
  if (signal.aborted) return cancelledExport();
  return workspaceSnapshot(await owners.authoring(signal).read(owners.workspace), signal);
}

/** Lease every digest the collection needs; a refused selection or lease is rejected. */
async function retainSnapshot(
  selected: SelectedCollection,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const digests = owners.resources.forCollection(selected.collection, selected.view);
  if (!digests.ok) return exportRejection('resource-rejected', 'resources', digests.error.message);
  const lease = owners.assets.acquire(digests.value);
  if (!lease.ok) return exportRejection('resource-rejected', 'resources', lease.error.message);
  return finishLease(selected, owners, signal, lease.value);
}

/** The prepared snapshot holds the lease until released; any failure releases it at once. */
async function finishLease(
  selected: SelectedCollection,
  owners: ExportRouteOwners,
  signal: AbortSignal,
  lease: ReadLease,
): Promise<ExportResult<SnapshotLease>> {
  if (signal.aborted) return settledFailure(cancelledExport(), releaseLease(lease));
  const prepared = await prepareSnapshot(selected, owners, lease, signal);
  if (!prepared.ok) return settledFailure(prepared, releaseLease(lease));
  return {
    ok: true,
    value: { snapshot: prepared.value, release: async () => releaseLease(lease) },
  };
}

/** Render, then retain; a throw anywhere in preparation is one encoding failure. */
async function prepareSnapshot(
  selected: SelectedCollection,
  owners: ExportRouteOwners,
  lease: ReadLease,
  signal: AbortSignal,
): Promise<ExportResult<ExportSnapshot>> {
  try {
    const document = renderedDocument(
      await owners.renderer.render(selected.collection, selected.view, signal),
    );
    return document.ok
      ? exportSnapshot(
          selected,
          document.value,
          (digest, path) => readLease(lease, digest, path),
          signal,
        )
      : document;
  } catch {
    return exportRejection(
      'encoding-failed',
      'snapshot',
      'The retained export snapshot could not be prepared',
    );
  }
}

/** One leased blob; a throwing lease reads as unavailable storage at `path`. */
function readLease(
  lease: ReadLease,
  digest: unknown,
  path: string,
): AssetResult<StoredBlob> {
  try {
    return lease.read(digest);
  } catch {
    return {
      ok: false,
      error: {
        code: 'storage-unavailable',
        path,
        message: 'The retained export resource could not be read',
        recovery: 'Re-read blob and lease state before retry; Assets owns orphan cleanup.',
      },
    };
  }
}

/** Release the lease; a refused or throwing release is a cleanup failure. */
function releaseLease(lease: ReadLease): ExportResult<void> {
  try {
    return releaseOutcome(lease.release());
  } catch {
    return exportRejection(
      'cleanup-failed',
      'export.release',
      'The export resource lease could not be released',
    );
  }
}

/** Canonical DSL covers the whole collection only. */
async function dsl(
  request: ExportRequest,
  owners: ExportRouteOwners,
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
  owners: ExportRouteOwners,
  signal: AbortSignal,
  lease: SnapshotLease,
): Promise<RouteOutcome> {
  const primary: ExportResult<string> = signal.aborted
    ? cancelledExport()
    : exportDocuments(owners).print(lease.snapshot.collection);
  const settled = settledFailure(primary, await lease.release());
  return settled.ok ? dslFile(request.identity, settled.value) : exportRouteFailure(settled);
}

/** Markdown of the requested scope from the leased collection. */
async function markdown(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const acquired = await acquireSnapshot(request.identity, owners, signal);
  if (!acquired.ok) return exportRouteFailure(acquired);
  return settleMarkdown(request, owners, signal, acquired.value);
}

/** Format the leased collection, release the lease, then answer with the file or the failure. */
async function settleMarkdown(
  request: ExportRequest,
  owners: ExportRouteOwners,
  signal: AbortSignal,
  lease: SnapshotLease,
): Promise<RouteOutcome> {
  const primary = markdownText(signal, lease.snapshot.collection, request.scope, owners.export);
  const settled = settledFailure(primary, await lease.release());
  return settled.ok ? markdownFile(request, settled.value) : exportRouteFailure(settled);
}
