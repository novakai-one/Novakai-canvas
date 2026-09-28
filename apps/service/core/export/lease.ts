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
import type { LeaseRead } from '../../contract/ports/export.js';
import type {
  SelectedCollection,
  SnapshotIdentity,
} from '../../contract/records/export/snapshot.js';
import type { WorkspaceId } from '../../contract/brands.js';
import { success } from '../../contract/errors.js';
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
  const workspaceSnapshot = await readWorkspace(dependencies, signal);
  if (!workspaceSnapshot.ok) {
    return workspaceSnapshot;
  }
  const contents = dependencies.reader.read(workspaceSnapshot.value);
  const selected = selectCollection(contents, identity);
  if (!selected.ok) {
    return selected;
  }
  return holdCollectionFiles(selected.value, dependencies, signal);
}

/** Reads the workspace through Authoring, unless the export was already stopped. */
async function readWorkspace(
  dependencies: LeaseDependencies,
  signal: AbortSignal,
): Promise<ExportResult<Snapshot>> {
  if (signal.aborted) {
    return cancelledFailure();
  }
  const authoring = dependencies.authoring(signal);
  const workspaceRead = await authoring.read(dependencies.workspace);
  return checkWorkspaceRead(workspaceRead, signal);
}

/** Holds every stored file the collection uses, then renders the collection. */
async function holdCollectionFiles(
  selected: SelectedCollection,
  dependencies: LeaseDependencies,
  signal: AbortSignal,
): Promise<ExportResult<SnapshotLease>> {
  const digests = dependencies.resources.digestsForCollection(
    selected.collection,
    selected.contents,
  );
  if (!digests.ok) {
    return filesNotHeldFailure(digests.error.message);
  }
  const lease = dependencies.assets.acquire(digests.value);
  if (!lease.ok) {
    return filesNotHeldFailure(lease.error.message);
  }
  return renderWhileHeld(selected, dependencies, signal, lease.value);
}

/** Renders the held collection into the snapshot, letting go of its files at once on a mistake. */
async function renderWhileHeld(
  selected: SelectedCollection,
  dependencies: LeaseDependencies,
  signal: AbortSignal,
  lease: ReadLease,
): Promise<ExportResult<SnapshotLease>> {
  if (signal.aborted) {
    return releaseAfterFailure(cancelledFailure(), lease);
  }
  const prepared = await prepareSnapshot(selected, dependencies, lease, signal);
  if (!prepared.ok) {
    return releaseAfterFailure(prepared, lease);
  }
  const snapshotLease = heldSnapshot(prepared.value, lease);
  return success(snapshotLease);
}

/** Renders the collection and builds the snapshot, turning any throw into one mistake. */
async function prepareSnapshot(
  selected: SelectedCollection,
  dependencies: LeaseDependencies,
  lease: ReadLease,
  signal: AbortSignal,
): Promise<ExportResult<ExportSnapshot>> {
  try {
    // `await` keeps a rejected render inside this try, so it becomes one mistake.
    return await renderSnapshot(selected, dependencies, lease, signal);
  } catch {
    return unpreparedSnapshotFailure();
  }
}

/** Renders the collection, then builds the snapshot from the drawing and the held files. */
async function renderSnapshot(
  selected: SelectedCollection,
  dependencies: LeaseDependencies,
  lease: ReadLease,
  signal: AbortSignal,
): Promise<ExportResult<ExportSnapshot>> {
  const rendered = await dependencies.renderer.render(
    selected.collection,
    selected.contents,
    signal,
  );
  const document = checkRenderedDocument(rendered);
  if (!document.ok) {
    return document;
  }
  const readHeldFile: LeaseRead = (digest, path) => readLeasedFile(lease, digest, path);
  return buildExportSnapshot(selected, document.value, readHeldFile, signal);
}

/** Pairs the snapshot with the `release` that lets go of its held files. */
function heldSnapshot(
  snapshot: ExportSnapshot,
  lease: ReadLease,
): SnapshotLease {
  return { snapshot, release: async () => releaseLease(lease) };
}

/** Lets go of the held files, and answers the mistake with any mistake from letting go attached. */
function releaseAfterFailure(
  failed: ExportResult<never>,
  lease: ReadLease,
): ExportResult<never> {
  const released = releaseLease(lease);
  return combineWithCleanup(failed, released);
}

/** Reads one held file, turning a throw into Assets' `storage-unavailable` at `path`. */
function readLeasedFile(
  lease: ReadLease,
  digest: unknown,
  path: string,
): AssetResult<StoredBlob> {
  try {
    return lease.read(digest);
  } catch {
    return heldFileThrewFailure(path);
  }
}

/** Lets go of the held files, turning a refusal or a throw into `cleanup-failed`. */
function releaseLease(lease: ReadLease): ExportResult<void> {
  try {
    const released = lease.release();
    return translateRelease(released);
  } catch {
    return releaseThrewFailure();
  }
}

/** Makes the mistake for files that couldn't be listed or held: `resource-rejected`. */
function filesNotHeldFailure(message: string): ExportResult<never> {
  return exportFailure('resource-rejected', 'resources', message);
}

/** Makes the mistake for a render or snapshot build that threw: `encoding-failed` at `snapshot`. */
function unpreparedSnapshotFailure(): ExportResult<never> {
  return exportFailure(
    'encoding-failed',
    'snapshot',
    'The retained export snapshot could not be prepared',
  );
}

/** Makes Assets' mistake for a held file whose read threw: `storage-unavailable` at `path`. */
function heldFileThrewFailure(path: string): AssetResult<never> {
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

/** Makes the mistake for letting go of held files that threw: `cleanup-failed`. */
function releaseThrewFailure(): ExportResult<never> {
  return exportFailure(
    'cleanup-failed',
    'export.release',
    'The export resource lease could not be released',
  );
}
