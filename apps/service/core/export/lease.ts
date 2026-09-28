/*
 * Why this file exists
 *
 * Every export starts from one collection at one revision, for example `my-diagram` at revision 3.
 * While the file is made, the diagram's theme, images and fonts must stay stored: clean-up must not
 * remove them halfway.
 *
 * This file finds that collection, refuses a revision that is no longer current, holds its stored
 * files (a "lease"), renders it and hands back the snapshot with a `release` to let go. After any
 * mistake it lets go at once. Each step answers an Export `Result` (mistakes made in faults.ts).
 * It only reads; it never changes the workspace.
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
} from '../../contract/records/capability-types.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { ResourceSelector, WorkspaceReader } from '../../contract/ports/workspace.js';
import type {
  SelectedCollection,
  SnapshotIdentity,
} from '../../contract/records/export/snapshot.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { cancelledFailure, exportFailure, translateRelease, combineWithCleanup } from './faults.js';
import {
  buildExportSnapshot,
  checkRenderedDocument,
  selectCollection,
  checkWorkspaceRead,
} from './snapshot.js';

/** What one export reads, holds and renders through. */
export interface LeaseDependencies {
  /** The workspace to read. */
  readonly workspace: WorkspaceId;
  /** Assets, which holds stored files until they are let go. */
  readonly assets: Pick<Assets, 'acquire'>;
  /** Reads the checked collections and presets out of a workspace snapshot. */
  readonly reader: Pick<WorkspaceReader, 'read'>;
  /** Lists the digests of the stored files a collection uses. */
  readonly resources: Pick<ResourceSelector, 'digestsForCollection'>;
  /** Renders the collection. */
  readonly renderer: CollectionRenderer;
  /** Makes Authoring for one request; only its `read` of the workspace is used. */
  readonly authoring: (signal: AbortSignal) => Pick<Authoring, 'read'>;
}

/**
 * Finds the collection `identity` names at that exact revision, holds its files and renders it.
 * The files stay held until the answer's `release` is called.
 * Mistakes: `cancelled`; `invalid-input` for a missing collection; `snapshot-mismatch` for an old
 * revision; `resource-rejected` when the theme or a file can't be found, held or read;
 * `encoding-failed` when reading the workspace or rendering fails.
 */
export async function acquireSnapshot(
  identity: SnapshotIdentity,
  dependencies: LeaseDependencies,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const current = await readWorkspace(dependencies, signal);
  if (!current.ok) return current;
  const selected = selectCollection(dependencies.reader.read(current.value), identity);
  if (!selected.ok) return selected;
  return retainSnapshot(selected.value, dependencies, signal);
}

/**
 * The current Authoring snapshot; an aborted request is never read. Fails with `cancelled` at
 * `export` when the request aborted, and `cancelled` or `encoding-failed` at `workspace` when
 * Authoring's read fails.
 */
async function readWorkspace(
  owners: LeaseDependencies,
  signal: AbortSignal,
): Promise<ExportResult<Snapshot>> {
  if (signal.aborted) return cancelledFailure();
  return checkWorkspaceRead(await owners.authoring(signal).read(owners.workspace), signal);
}

/**
 * Lease every digest the collection needs. Fails with `resource-rejected` at `resources` when
 * selection or the lease is refused, and otherwise as `finishLease`.
 */
async function retainSnapshot(
  selected: SelectedCollection,
  owners: LeaseDependencies,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const digests = owners.resources.digestsForCollection(selected.collection, selected.contents);
  if (!digests.ok) return exportFailure('resource-rejected', 'resources', digests.error.message);
  const lease = owners.assets.acquire(digests.value);
  if (!lease.ok) return exportFailure('resource-rejected', 'resources', lease.error.message);
  return finishLease(selected, owners, signal, lease.value);
}

/**
 * The prepared snapshot holds the lease until released; any failure releases it at once. Fails
 * with `cancelled` at `export` when the request aborted, and otherwise as `prepareSnapshot`; a
 * failed release nests `cleanup-failed` at `export.release` under `cleanup`.
 */
async function finishLease(
  selected: SelectedCollection,
  owners: LeaseDependencies,
  signal: AbortSignal,
  lease: ReadLease,
): Promise<ExportResult<SnapshotLease>> {
  if (signal.aborted) return combineWithCleanup(cancelledFailure(), releaseLease(lease));
  const prepared = await prepareSnapshot(selected, owners, lease, signal);
  if (!prepared.ok) return combineWithCleanup(prepared, releaseLease(lease));
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
  owners: LeaseDependencies,
  lease: ReadLease,
  signal: AbortSignal,
): Promise<ExportResult<ExportSnapshot>> {
  try {
    const document = checkRenderedDocument(
      await owners.renderer.render(selected.collection, selected.contents, signal),
    );
    if (!document.ok) return document;
    return buildExportSnapshot(
      selected,
      document.value,
      (digest, path) => readLease(lease, digest, path),
      signal,
    );
  } catch {
    return exportFailure(
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
    return translateRelease(lease.release());
  } catch {
    return exportFailure(
      'cleanup-failed',
      'export.release',
      'The export resource lease could not be released',
    );
  }
}
