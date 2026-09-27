/*
 * Renders one committed collection: read the workspace, check it, find the collection, render it.
 * Pure over the injected reads. The caller keeps its navigation and draft on any failure.
 */
import type { Authoring } from '../../contract/records/capabilities.js';
import type {
  WorkspaceContents,
  WorkspaceReader,
} from '../../contract/records/workspace/contents.js';
import type { CollectionRenderer } from '../../contract/ports/collection-renderer.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** The reads rendering needs; the session facade passes its owners, which satisfy this bag. */
export interface CollectionReads {
  readonly workspace: string;
  readonly views: Pick<WorkspaceReader, 'read'>;
  readonly renderer: CollectionRenderer;
  authoring(signal: AbortSignal): Pick<Authoring, 'read'>;
}
/** Read one consistent committed workspace; no render result or cache can mutate its canonical diagram. */
export async function renderCollection(
  id: string,
  signal: AbortSignal,
  dependencies: CollectionReads,
): Promise<Result<RenderDocument>> {
  const snapshot = await dependencies.authoring(signal).read(dependencies.workspace);
  if (!snapshot.ok)
    return failure('unavailable', snapshot.error.path, snapshot.error.message, snapshot.error);
  const view = dependencies.views.read(snapshot.value);
  if (!view.ok) return failure('unavailable', view.error.path, view.error.message, view.error);
  return renderSelected(id, signal, view.value, dependencies);
}
/** Missing collection is distinct from an empty collection; the caller retains its current navigation/draft. */
function renderSelected(
  id: string,
  signal: AbortSignal,
  view: WorkspaceContents,
  dependencies: CollectionReads,
): Promise<Result<RenderDocument>> {
  const collection = view.collections.find((item) => item.id === id);
  if (!collection) return Promise.resolve(failure('not-found', id, 'Collection does not exist'));
  return dependencies.renderer.render(collection, view, signal);
}
