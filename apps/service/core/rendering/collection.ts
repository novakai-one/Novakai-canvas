import type { SessionDependencies } from '../../contract/types.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** Read one consistent committed workspace; no render result or cache can mutate its canonical diagram. */
export async function renderCollection(
  id: string,
  signal: AbortSignal,
  dependencies: SessionDependencies,
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
  view: import('../../contract/records/workspace/contents.js').WorkspaceContents,
  dependencies: SessionDependencies,
): Promise<Result<RenderDocument>> {
  const collection = view.collections.find((item) => item.id === id);
  if (!collection) return Promise.resolve(failure('not-found', id, 'Collection does not exist'));
  return dependencies.renderer.render(collection, view, signal);
}
