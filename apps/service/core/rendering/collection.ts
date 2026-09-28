/*
 * Why this file exists
 *
 * The browser and agents ask to see one saved collection by its ID, for example
 * `GET /api/v1/render?id=my-diagram`. To draw it, the service must read the saved workspace, find
 * that collection in it and hand it to the renderer.
 *
 * This file does that, and makes the `not-found` mistake for an ID no saved collection has. Each
 * step answers a `Result` (see `contract/errors.ts`). It only reads; it never saves.
 */
import type { Authoring } from '../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { CollectionId, WorkspaceId } from '../../contract/brands.js';
/**
 * What drawing a saved collection by its ID reads through. The workspace session passes its own
 * parts, which include these.
 */
export interface WorkspaceRenderDependencies {
  /** The workspace to read. */
  readonly workspace: WorkspaceId;
  /** Reads the checked collections and presets out of a workspace snapshot. */
  readonly reader: Pick<WorkspaceReader, 'read'>;
  /** Draws one checked collection (renderer.ts). */
  readonly renderer: CollectionRenderer;
  /** Makes Authoring for one request; only its `read` of the workspace is used. */
  authoring(signal: AbortSignal): Pick<Authoring, 'read'>;
}
/**
 * Draws the saved collection with this ID, from one consistent read of the workspace.
 * Mistakes: `unavailable` when the workspace can't be read or checked, and `not-found` when no
 * saved collection has this ID. The renderer's own mistakes pass through.
 */
export async function renderCollection(
  id: CollectionId,
  signal: AbortSignal,
  dependencies: WorkspaceRenderDependencies,
): Promise<Result<RenderDocument>> {
  const snapshot = await dependencies.authoring(signal).read(dependencies.workspace);
  if (!snapshot.ok)
    return failure('unavailable', snapshot.error.path, snapshot.error.message, snapshot.error);
  const view = dependencies.reader.read(snapshot.value);
  if (!view.ok) return failure('unavailable', view.error.path, view.error.message, view.error);
  return renderSelected(id, signal, view.value, dependencies);
}
/**
 * The mistake for an ID no saved collection has: `not-found` at that ID.
 * `requestedId` is the text as sent. The routes answer text that isn't a valid ID the same way.
 */
export function missingCollectionFailure(requestedId: string): Result<never> {
  return failure('not-found', requestedId, 'Collection does not exist');
}
/**
 * Renders the collection with this ID from the checked view. A missing collection (distinct from
 * an empty one) is `not-found` at the requested ID; the renderer's own failures pass through.
 */
function renderSelected(
  id: CollectionId,
  signal: AbortSignal,
  view: WorkspaceContents,
  reads: WorkspaceRenderDependencies,
): Promise<Result<RenderDocument>> {
  const collection = view.collections.find((item) => item.id === id);
  if (!collection) return Promise.resolve(missingCollectionFailure(id));
  return reads.renderer.render(collection, view, signal);
}
