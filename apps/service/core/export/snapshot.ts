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
import type { Result } from '../../contract/errors.js';
import type {
  AuthoringResult,
  Collection,
  ExportResult,
  ExportSnapshot,
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
  if (!current.ok) return readOrRenderFailure(current.error, 'workspace');
  return signal.aborted ? cancelledFailure() : current;
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
  if (!contents.ok) return exportFailure('encoding-failed', 'workspace', contents.error.message);
  const collection = contents.value.collections.find((item) => item.id === identity.collectionId);
  if (collection === undefined)
    return exportFailure('invalid-input', 'identity.collectionId', 'Collection does not exist');
  return matchingRevision(collection, identity.revision, contents.value);
}

/**
 * Checks the renderer's answer. Fails with `cancelled` or `encoding-failed` at `render` when
 * rendering failed.
 */
export function checkRenderedDocument(
  rendered: Result<RenderDocument>,
): ExportResult<RenderDocument> {
  return rendered.ok ? rendered : readOrRenderFailure(rendered.error, 'render');
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
  if (signal.aborted) return cancelledFailure();
  const resources = gatherExportResources(
    readHeldFile,
    selected.collection,
    document,
    selected.contents.presets,
  );
  if (!resources.ok) return resources;
  return {
    ok: true,
    value: {
      identity: {
        collectionId: selected.collection.id,
        revision: selected.collection.revision,
        inputKey: document.scene.inputKey,
        title: selected.collection.title,
      },
      collection: selected.collection,
      scene: document.scene,
      resources: resources.value,
      paint: {
        fill: document.style.surface,
        stroke: document.style.border,
        text: document.style.text,
      },
    },
  };
}

/** The selection, when the collection is still at the requested revision. */
function matchingRevision(
  collection: Collection,
  revision: number,
  view: WorkspaceContents,
): ExportResult<SelectedCollection> {
  if (collection.revision !== revision)
    return exportFailure(
      'snapshot-mismatch',
      'identity.revision',
      'Requested revision is no longer available',
    );
  return { ok: true, value: { collection, contents: view } };
}
