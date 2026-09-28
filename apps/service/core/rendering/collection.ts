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
import type {
  Authoring,
  AuthoringDiagnostic,
  Collection,
} from '../../contract/records/capability-types.js';
import type { WorkspaceContents } from '../../contract/records/workspace/contents.js';
import type { WorkspaceReader } from '../../contract/ports/workspace.js';
import type { CollectionRenderer } from '../../contract/ports/rendering.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import type { CollectionId, WorkspaceId } from '../../contract/brands.js';
/**
 * What `renderCollection` needs: the workspace to read, a way to read collections out of it, and
 * the renderer. The workspace session (core/session) passes these.
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
  const contents = await readWorkspaceContents(signal, dependencies);
  if (!contents.ok) {
    return contents;
  }
  const collection = findCollection(id, contents.value);
  if (!collection.ok) {
    return collection;
  }
  return dependencies.renderer.render(collection.value, contents.value, signal);
}
/**
 * The mistake for an ID no saved collection has: `not-found` at that ID.
 * `requestedId` is the text as sent. The routes answer text that isn't a valid ID the same way.
 */
export function missingCollectionFailure(requestedId: string): Result<never> {
  return failure('not-found', requestedId, 'Collection does not exist');
}

/** Reads the saved workspace once, then reads its checked collections and presets out of it. */
async function readWorkspaceContents(
  signal: AbortSignal,
  dependencies: WorkspaceRenderDependencies,
): Promise<Result<WorkspaceContents>> {
  const authoring = dependencies.authoring(signal);
  const snapshot = await authoring.read(dependencies.workspace);
  if (!snapshot.ok) {
    return workspaceUnavailableFailure(snapshot.error);
  }
  const contents = dependencies.reader.read(snapshot.value);
  if (!contents.ok) {
    return workspaceUnavailableFailure(contents.error);
  }
  return success(contents.value);
}

/** Finds the saved collection with this ID, or makes the `not-found` mistake when none has it. */
function findCollection(
  id: CollectionId,
  contents: WorkspaceContents,
): Result<Collection> {
  const collection = contents.collections.find((saved) => saved.id === id);
  if (collection === undefined) {
    return missingCollectionFailure(id);
  }
  return success(collection);
}

/**
 * Makes the `unavailable` mistake for a workspace that can't be read or checked, keeping the
 * refusal as its source.
 */
function workspaceUnavailableFailure(refusal: AuthoringDiagnostic): Result<never> {
  return failure('unavailable', refusal.path, refusal.message, refusal);
}
