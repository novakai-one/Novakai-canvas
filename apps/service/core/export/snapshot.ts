/*
 * Export snapshot decisions: a workspace read settles into a snapshot or a refusal; the requested
 * collection must exist at its exact revision; a rendered document is kept or its failure
 * translated; and the export snapshot pins identity, scene, paint and every retained resource.
 * Cancellation is checked after each owner await. Pure; the adapter calls the owners.
 */
import type { Result } from '../../contract/errors.js';
import type {
  AuthoringResult,
  Collection,
  ExportResult,
  ExportSnapshot,
  Snapshot,
} from '../../contract/records/capabilities.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { LeaseRead } from '../../contract/ports/export.js';
import type {
  SelectedCollection,
  SnapshotIdentity,
} from '../../contract/records/export/snapshot.js';
import { cancelledExport, exportRejection, ownerRejection } from './faults.js';
import { retainedResources } from './resources.js';

/** The workspace read: an owner failure is translated at `workspace`; a late abort cancels. */
export function workspaceSnapshot(
  current: AuthoringResult<Snapshot>,
  signal: AbortSignal,
): ExportResult<Snapshot> {
  if (!current.ok) return ownerRejection(current.error, 'workspace');
  return signal.aborted ? cancelledExport() : current;
}

/** The requested collection from the workspace view; refused when missing or at another revision. */
export function selectedCollection(
  view: AuthoringResult<WorkspaceContents>,
  identity: SnapshotIdentity,
): ExportResult<SelectedCollection> {
  if (!view.ok) return exportRejection('encoding-failed', 'workspace', view.error.message);
  const collection = view.value.collections.find((item) => item.id === identity.collectionId);
  if (collection === undefined)
    return exportRejection('invalid-input', 'identity.collectionId', 'Collection does not exist');
  return matchingRevision(collection, identity.revision, view.value);
}

/** The rendered document, or its owner failure translated at `render`. */
export function renderedDocument(document: Result<RenderDocument>): ExportResult<RenderDocument> {
  return document.ok ? document : ownerRejection(document.error, 'render');
}

/** The immutable export snapshot, unless the request aborted or a resource was not retained. */
export function exportSnapshot(
  selected: SelectedCollection,
  document: RenderDocument,
  read: LeaseRead,
  signal: AbortSignal,
): ExportResult<ExportSnapshot> {
  if (signal.aborted) return cancelledExport();
  const resources = retainedResources(read, selected.collection, document, selected.view.presets);
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
    return exportRejection(
      'snapshot-mismatch',
      'identity.revision',
      'Requested revision is no longer available',
    );
  return { ok: true, value: { collection, view } };
}
