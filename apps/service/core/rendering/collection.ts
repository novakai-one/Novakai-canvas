/*
 * Renders one committed collection: read the workspace, check it, find the collection, render it.
 * Pure over the injected reads. The caller keeps its navigation and draft on any failure.
 */
import type { Authoring } from '../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { CollectionId, WorkspaceId } from '../../contract/brands.js';
/** The reads rendering needs; the session facade passes its owners, which satisfy this bag. */
export interface CollectionReads {
  readonly workspace: WorkspaceId;
  readonly views: Pick<WorkspaceReader, 'read'>;
  readonly renderer: CollectionRenderer;
  authoring(signal: AbortSignal): Pick<Authoring, 'read'>;
}
/**
 * Reads one consistent committed workspace and renders the named collection from it. A failed
 * workspace read or view check is `unavailable` (source kept); a missing collection is
 * `not-found` at the requested ID (`missingCollection`); the renderer's own failures pass through.
 */
export async function renderCollection(
  id: CollectionId,
  signal: AbortSignal,
  reads: CollectionReads,
): Promise<Result<RenderDocument>> {
  const snapshot = await reads.authoring(signal).read(reads.workspace);
  if (!snapshot.ok)
    return failure('unavailable', snapshot.error.path, snapshot.error.message, snapshot.error);
  const view = reads.views.read(snapshot.value);
  if (!view.ok) return failure('unavailable', view.error.path, view.error.message, view.error);
  return renderSelected(id, signal, view.value, reads);
}
/**
 * `not-found` at the requested text itself: no committed collection has this ID. The session
 * routes answer text that is not a Model collection ID the same way.
 */
export function missingCollection(text: string): Result<never> {
  return failure('not-found', text, 'Collection does not exist');
}
/**
 * Renders the collection with this ID from the checked view. A missing collection (distinct from
 * an empty one) is `not-found` at the requested ID; the renderer's own failures pass through.
 */
function renderSelected(
  id: CollectionId,
  signal: AbortSignal,
  view: WorkspaceContents,
  reads: CollectionReads,
): Promise<Result<RenderDocument>> {
  const collection = view.collections.find((item) => item.id === id);
  if (!collection) return Promise.resolve(missingCollection(id));
  return reads.renderer.render(collection, view, signal);
}
