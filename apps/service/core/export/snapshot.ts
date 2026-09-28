/*
 * Why this file exists
 *
 * Before an export holds any files, it must know the collection is really there at the asked-for
 * revision. For example, asking for `my-diagram` at revision 2 after it was saved as revision 3
 * must be refused, not quietly answered with revision 3.
 *
 * This file checks each answer on the way (the workspace read, the collection found, the render)
 * and builds the final export snapshot. It never reads the workspace or renders: lease.ts does
 * both, and hands in the one file reader this file uses (`readHeldFile`).
 */
import { success, type Result } from '../../contract/errors.js';
import type {
  AuthoringResult,
  Collection,
  ExportResult,
  ExportSnapshot,
  Resource,
  Snapshot,
} from '../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { LeaseRead } from '../../contract/ports/export.js';
import type {
  SelectedCollection,
  SnapshotIdentity,
} from '../../contract/records/export/snapshot.js';
import { cancelledFailure, exportFailure, readOrRenderFailure } from './faults.js';
import { gatherExportResources } from './resources.js';

/**
 * Checks Authoring's answer to reading the workspace. Fails with `cancelled` or `encoding-failed`
 * at `workspace` when the read failed, and `cancelled` at `export` when the export was stopped
 * meanwhile.
 */
export function checkWorkspaceRead(
  current: AuthoringResult<Snapshot>,
  signal: AbortSignal,
): ExportResult<Snapshot> {
  if (!current.ok) {
    return readOrRenderFailure(current.error, 'workspace');
  }
  if (signal.aborted) {
    return cancelledFailure();
  }
  return current;
}

/**
 * Finds the collection `identity` names in the workspace's checked contents, at exactly that
 * revision. Fails with `encoding-failed` at `workspace` when the contents couldn't be read,
 * `invalid-input` at `identity.collectionId` when there is no such collection, and
 * `snapshot-mismatch` at `identity.revision` when the collection is at another revision.
 */
export function selectCollection(
  contents: AuthoringResult<WorkspaceContents>,
  identity: SnapshotIdentity,
): ExportResult<SelectedCollection> {
  if (!contents.ok) {
    return unreadableContentsFailure(contents.error.message);
  }
  const collection = findCollection(contents.value, identity);
  if (collection === undefined) {
    return missingCollectionFailure();
  }
  return checkRevision(collection, identity.revision, contents.value);
}

/**
 * Checks the renderer's answer. Fails with `cancelled` or `encoding-failed` at `render` when
 * rendering failed.
 */
export function checkRenderedDocument(
  rendered: Result<RenderDocument>,
): ExportResult<RenderDocument> {
  if (!rendered.ok) {
    return readOrRenderFailure(rendered.error, 'render');
  }
  return rendered;
}

/**
 * Builds the snapshot Export makes its file from: the collection, its drawn scene, its colours,
 * and its theme, images and fonts, each read with `readHeldFile`. Fails with `cancelled` at
 * `export` when the export was stopped, or when a file can't be read (`gatherExportResources`).
 */
export function buildExportSnapshot(
  selected: SelectedCollection,
  document: RenderDocument,
  readHeldFile: LeaseRead,
  signal: AbortSignal,
): ExportResult<ExportSnapshot> {
  if (signal.aborted) {
    return cancelledFailure();
  }
  const resources = gatherExportResources(
    readHeldFile,
    selected.collection,
    document,
    selected.contents.presets,
  );
  if (!resources.ok) {
    return resources;
  }
  const snapshot = exportSnapshot(selected.collection, document, resources.value);
  return success(snapshot);
}

/** Finds the collection with the asked-for ID, or nothing when there is none. */
function findCollection(
  contents: WorkspaceContents,
  identity: SnapshotIdentity,
): Collection | undefined {
  return contents.collections.find((collection) => collection.id === identity.collectionId);
}

/** Checks the collection is at the asked-for revision, and pairs it with the workspace contents. */
function checkRevision(
  collection: Collection,
  revision: number,
  contents: WorkspaceContents,
): ExportResult<SelectedCollection> {
  if (collection.revision !== revision) {
    return revisionMismatchFailure();
  }
  const selected: SelectedCollection = { collection, contents };
  return success(selected);
}

/** Puts the collection, its drawing, its held files and its colours together for Export. */
function exportSnapshot(
  collection: Collection,
  document: RenderDocument,
  resources: readonly Resource[],
): ExportSnapshot {
  const identity = {
    collectionId: collection.id,
    revision: collection.revision,
    inputKey: document.scene.inputKey,
    title: collection.title,
  };
  const paint = {
    fill: document.style.surface,
    stroke: document.style.border,
    text: document.style.text,
  };
  return { identity, collection, scene: document.scene, resources, paint };
}

/** Makes the mistake for workspace contents that couldn't be read: `encoding-failed`. */
function unreadableContentsFailure(message: string): ExportResult<never> {
  return exportFailure('encoding-failed', 'workspace', message);
}

/** Makes the mistake for a collection that doesn't exist: `invalid-input` at its ID. */
function missingCollectionFailure(): ExportResult<never> {
  return exportFailure('invalid-input', 'identity.collectionId', 'Collection does not exist');
}

/** Makes the mistake for an old revision: `snapshot-mismatch` at `identity.revision`. */
function revisionMismatchFailure(): ExportResult<never> {
  return exportFailure(
    'snapshot-mismatch',
    'identity.revision',
    'Requested revision is no longer available',
  );
}
