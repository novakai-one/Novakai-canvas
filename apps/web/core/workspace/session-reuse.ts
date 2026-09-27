/*
 * Deciding whether a fresh document reuses the live diagram session: same workspace and
 * collection, a monotonic revision, and the camera carried over on restore. Pure reads over the
 * contract records; Authoring owns commit and recovery.
 */
import type { RenderDocument, SessionStore } from '../../contract/records/owners.js';
import type { WorkspaceView } from '../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';

/** Same-workspace monotonic revisions can update the existing session without losing its camera or selection. */
export function reusableSession(
  active: ActiveDiagram | null,
  document: RenderDocument,
  base: NonNullable<WorkspaceView['snapshot']>,
): boolean {
  if (active === null) return false;
  return (
    sameCollection(active, document, base) &&
    document.collection.revision >= active.document.collection.revision
  );
}

/** A restore may lower revision; a fresh Canvas session can retain the viewing position, but never old edit preconditions. */
export function retainCamera(
  active: ActiveDiagram | null,
  session: SessionStore,
  document: RenderDocument,
  base: NonNullable<WorkspaceView['snapshot']>,
): void {
  if (active === null) return;
  if (sameCollection(active, document, base))
    session.dispatch({ kind: 'viewport', camera: active.session.getSnapshot().camera });
}

/** Transport generation is part of the render input even when the collection revision is unchanged. */
export function renderChanged(
  active: ActiveDiagram,
  revision: number,
  generation: string,
): boolean {
  return revision !== active.document.collection.revision || active.generation !== generation;
}

/** Collection IDs are meaningful only within their workspace. */
function sameCollection(
  active: ActiveDiagram,
  document: RenderDocument,
  base: NonNullable<WorkspaceView['snapshot']>,
): boolean {
  return (
    active.base.workspace === base.workspace &&
    active.document.collection.id === document.collection.id
  );
}
