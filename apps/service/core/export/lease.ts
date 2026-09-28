/*
 * The export snapshot lease: read the current Authoring snapshot, select the collection at its
 * exact revision (a stale one is refused), lease its resources, render it and hand back an
 * immutable snapshot with its release. Every failure after the lease releases it once, and a
 * release failure never hides the primary one. A throw from the Authoring read, the workspace
 * view, selection or `acquire` escapes before any lease is held: Export answers it
 * `encoding-failed` (SVG, PNG); for DSL and Markdown the HTTP server's `receive` answers it
 * `unavailable` at `request`. Pure over the owners compose injects; the caller owns retry.
 */
import type {
  AssetResult,
  Assets,
  Authoring,
  ExportResult,
  ExportSnapshot,
  ReadLease,
  Snapshot,
  SnapshotLease,
  StoredBlob,
} from '../../contract/records/capabilities.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { ResourceSelector, WorkspaceReader } from '../../contract/ports/workspace.js';
import type {
  SelectedCollection,
  SnapshotIdentity,
} from '../../contract/records/export/snapshot.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { cancelledExport, exportRejection, releaseOutcome, settledFailure } from './faults.js';
import {
  exportSnapshot,
  renderedDocument,
  selectedCollection,
  workspaceSnapshot,
} from './snapshot.js';

/** The owners one snapshot lease reads, leases and renders through. */
export interface LeaseOwners {
  readonly workspace: WorkspaceId;
  readonly assets: Pick<Assets, 'acquire'>;
  readonly views: Pick<WorkspaceReader, 'read'>;
  readonly resources: Pick<ResourceSelector, 'forCollection'>;
  readonly renderer: CollectionRenderer;
  readonly authoring: (signal: AbortSignal) => Pick<Authoring, 'read'>;
}

/**
 * Read the workspace, select the exact revision, then lease and prepare its snapshot. The lease
 * is held until the returned `release`. Fails with:
 * - `cancelled` at `export` when the request aborted;
 * - `cancelled` or `encoding-failed` at `workspace` when Authoring's read fails, and
 *   `encoding-failed` at `workspace` when the workspace view is refused;
 * - `invalid-input` at `identity.collectionId` for a missing collection, and `snapshot-mismatch`
 *   at `identity.revision` for a stale revision;
 * - `resource-rejected` at `resources` when selection or the lease is refused, at
 *   `resources.theme` when the pinned theme is missing, and at the resource's path when a
 *   retained resource cannot be read;
 * - `cancelled` or `encoding-failed` at `render`, and `encoding-failed` at `snapshot` when
 *   preparation throws.
 * A failed release after a failure nests `cleanup-failed` at `export.release` under `cleanup`.
 */
export async function acquireSnapshot(
  identity: SnapshotIdentity,
  owners: LeaseOwners,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const current = await readWorkspace(owners, signal);
  if (!current.ok) return current;
  const selected = selectedCollection(owners.views.read(current.value), identity);
  if (!selected.ok) return selected;
  return retainSnapshot(selected.value, owners, signal);
}

/**
 * The current Authoring snapshot; an aborted request is never read. Fails with `cancelled` at
 * `export` when the request aborted, and `cancelled` or `encoding-failed` at `workspace` when
 * Authoring's read fails.
 */
async function readWorkspace(
  owners: LeaseOwners,
  signal: AbortSignal,
): Promise<ExportResult<Snapshot>> {
  if (signal.aborted) return cancelledExport();
  return workspaceSnapshot(await owners.authoring(signal).read(owners.workspace), signal);
}

/**
 * Lease every digest the collection needs. Fails with `resource-rejected` at `resources` when
 * selection or the lease is refused, and otherwise as `finishLease`.
 */
async function retainSnapshot(
  selected: SelectedCollection,
  owners: LeaseOwners,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const digests = owners.resources.forCollection(selected.collection, selected.view);
  if (!digests.ok) return exportRejection('resource-rejected', 'resources', digests.error.message);
  const lease = owners.assets.acquire(digests.value);
  if (!lease.ok) return exportRejection('resource-rejected', 'resources', lease.error.message);
  return finishLease(selected, owners, signal, lease.value);
}

/**
 * The prepared snapshot holds the lease until released; any failure releases it at once. Fails
 * with `cancelled` at `export` when the request aborted, and otherwise as `prepareSnapshot`; a
 * failed release nests `cleanup-failed` at `export.release` under `cleanup`.
 */
async function finishLease(
  selected: SelectedCollection,
  owners: LeaseOwners,
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

/**
 * Render, then retain; a throw anywhere in preparation is one encoding failure. Fails with
 * `cancelled` or `encoding-failed` at `render`, `cancelled` at `export` when the request aborted,
 * `resource-rejected` when a retained resource is unavailable, and `encoding-failed` at
 * `snapshot` when preparation throws.
 */
async function prepareSnapshot(
  selected: SelectedCollection,
  owners: LeaseOwners,
  lease: ReadLease,
  signal: AbortSignal,
): Promise<ExportResult<ExportSnapshot>> {
  try {
    const document = renderedDocument(
      await owners.renderer.render(selected.collection, selected.view, signal),
    );
    if (!document.ok) return document;
    return exportSnapshot(
      selected,
      document.value,
      (digest, path) => readLease(lease, digest, path),
      signal,
    );
  } catch {
    return exportRejection(
      'encoding-failed',
      'snapshot',
      'The retained export snapshot could not be prepared',
    );
  }
}

/** One leased blob; fails with Assets' `storage-unavailable` at `path` when the lease throws. */
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

/** Release the lease; fails with `cleanup-failed` at `export.release` when it refuses or throws. */
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
