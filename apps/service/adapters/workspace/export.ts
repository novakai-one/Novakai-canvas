/*
 * The workspace export route: a read-only projection over one current Authoring snapshot. A
 * checked request reads the workspace, selects the collection at its exact revision (a stale
 * revision is refused), leases its resources, renders it and hands Export an immutable snapshot;
 * DSL and Markdown are printed from that same snapshot. Every returned outcome releases the lease
 * once, and a release failure never hides the primary outcome; a throw from printing or
 * formatting escapes unreleased. Pure rules live in core/export behind contract/api.js and
 * capability wiring in contract/export-documents.js; this adapter owns the owner sequence and
 * the throw guards around rendering and the lease.
 */
import { composeExport } from '@novakai/canvas-export';
import { createReactBindings, type ReactBindings } from '@novakai/canvas-presentation';
import { failure, type Result } from '../../contract/errors.js';
import type { RouteOutcome } from '../../contract/records/transport/protocol.js';
import type { Snapshot } from '../../contract/records/capabilities.js';
import type {
  AssetResult,
  ExportHandler,
  ExportOwners,
  ExportRequest,
  ExportResult,
  ExportSnapshot,
  ReadLease,
  SelectedCollection,
  SnapshotLease,
  StoredBlob,
} from '../../contract/records/export/export.js';
import {
  artifactOutcome,
  cancelledExport,
  dslFile,
  exportRejection,
  exportRouteFailure,
  exportSnapshot,
  markdownFile,
  readExportRequest,
  releaseOutcome,
  renderedDocument,
  resourceInspector,
  selectedCollection,
  settledFailure,
  workspaceSnapshot,
} from '../../contract/api.js';
import { exportDocuments, markdownText } from '../../contract/export-documents.js';

/**
 * The export route of one workspace. Presentation bindings are prepared once; when they cannot
 * be, no route is published and the failure is `unavailable`. Every export only reads, so a
 * failed export is safe to retry; the caller owns the retry.
 */
export async function createWorkspaceExporter(
  owners: ExportOwners,
): Promise<Result<ExportHandler>> {
  const presentation = await createReactBindings(owners.installation.fonts);
  if (!presentation.ok)
    return failure('unavailable', 'export.presentation', presentation.error.message);
  return {
    ok: true,
    value: { invoke: (input, signal) => invokeExport(input, signal, owners, presentation.value) },
  };
}

/** A checked request is dispatched by format; a refused one never reaches an owner. */
async function invokeExport(
  input: unknown,
  signal: AbortSignal,
  owners: ExportOwners,
  presentation: ReactBindings,
): Promise<RouteOutcome> {
  const request = readExportRequest(input);
  if (!request.ok) return request;
  return dispatchExport(request.value, owners, presentation, signal);
}

/** DSL and Markdown are printed here; SVG and PNG are encoded by Export. */
async function dispatchExport(
  request: ExportRequest,
  owners: ExportOwners,
  presentation: ReactBindings,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  switch (request.format) {
    case 'dsl':
      return dsl(request, owners, signal);
    case 'markdown':
      return markdown(request, owners, signal);
    default:
      return nativeExport(request, owners, presentation, signal);
  }
}

/** PNG first needs its runtime; an unavailable runtime refuses before any owner is read. */
async function nativeExport(
  request: ExportRequest,
  owners: ExportOwners,
  presentation: ReactBindings,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const prepared = await prepareFormat(request.format, owners);
  if (!prepared.ok) return prepared;
  return encodeNative(request, owners, presentation, signal);
}

/** The PNG runtime for PNG; every other format needs nothing. */
async function prepareFormat(
  format: ExportRequest['format'],
  owners: ExportOwners,
): Promise<Result<void>> {
  return format === 'png' ? owners.png.prepare() : { ok: true, value: undefined };
}

/** Export encodes the artifact from a snapshot it acquires through this route. */
async function encodeNative(
  request: ExportRequest,
  owners: ExportOwners,
  presentation: ReactBindings,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const exporter = composeExport({
    presentation,
    readerCss: '',
    snapshots: { acquire: (identity) => acquireSnapshot(identity, owners, signal) },
    documents: exportDocuments(owners.language),
    resources: resourceInspector(),
  });
  return artifactOutcome(await exporter.service.exportArtifact(request, signal));
}

/** Read the workspace, select the exact revision, then lease and prepare its snapshot. */
async function acquireSnapshot(
  identity: ExportRequest['identity'],
  owners: ExportOwners,
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
  owners: ExportOwners,
  signal: AbortSignal,
): Promise<ExportResult<Snapshot>> {
  if (signal.aborted) return cancelledExport();
  return workspaceSnapshot(await owners.authoring(signal).read(owners.workspace), signal);
}

/** Lease every digest the collection needs; a refused selection or lease is rejected. */
async function retainSnapshot(
  selected: SelectedCollection,
  owners: ExportOwners,
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
  owners: ExportOwners,
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
  owners: ExportOwners,
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
  owners: ExportOwners,
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
  owners: ExportOwners,
  signal: AbortSignal,
  lease: SnapshotLease,
): Promise<RouteOutcome> {
  const primary: ExportResult<string> = signal.aborted
    ? cancelledExport()
    : exportDocuments(owners.language).print(lease.snapshot.collection);
  const settled = settledFailure(primary, await lease.release());
  return settled.ok ? dslFile(request.identity, settled.value) : exportRouteFailure(settled);
}

/** Markdown of the requested scope from the leased collection. */
async function markdown(
  request: ExportRequest,
  owners: ExportOwners,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const acquired = await acquireSnapshot(request.identity, owners, signal);
  if (!acquired.ok) return exportRouteFailure(acquired);
  return settleMarkdown(request, signal, acquired.value);
}

/** Format the leased collection, release the lease, then answer with the file or the failure. */
async function settleMarkdown(
  request: ExportRequest,
  signal: AbortSignal,
  lease: SnapshotLease,
): Promise<RouteOutcome> {
  const primary = markdownText(signal, lease.snapshot.collection, request.scope);
  const settled = settledFailure(primary, await lease.release());
  return settled.ok ? markdownFile(request, settled.value) : exportRouteFailure(settled);
}
