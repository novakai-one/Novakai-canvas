/*
 * The status line and the mutation flag. Unapplied source, or an unapplied editor form in the
 * open collection, reads "Draft not applied"; a request still in the journal reads "Edit awaiting
 * confirmation"; otherwise "Saved". A resting status follows those changes, while progress and
 * failure messages stay until something replaces them. The scene accepts edits only when no
 * movement review or undo/redo holds them and it shows the view's generation. Pure; the session
 * reads the editors and publishes.
 */
import type { Diagnostic } from '../../contract/errors.js';
import type { WorkspaceView } from '../../contract/records/workspace.js';
import type { ActiveDiagram } from '../../contract/records/active-diagram.js';
import type { ReadGeneration } from '../../contract/records/read-generation.js';
import type { CollectionId } from '../../contract/brands.js';
import { atGeneration } from './read-generation.js';

/** An editor draft as the status reads it: only its collection matters. */
export interface CollectionDraft {
  readonly collection: { readonly id: CollectionId };
}

/** What holds edits back: a movement review, and undo/redo or a request in the journal. */
export interface EditHolds {
  readonly movement: boolean;
  readonly history: boolean;
}

/** The status after an edit, a receipt or a render. */
export function editingStatus(
  view: Pick<WorkspaceView, 'sourceDirty' | 'pending'>,
  openDrafts: number,
): string {
  if (view.sourceDirty || openDrafts > 0) return 'Draft not applied';
  return journalStatus(view.pending);
}

/** The editor drafts that belong to the open collection. */
export function openDraftCount(
  active: ActiveDiagram | null,
  drafts: readonly CollectionDraft[],
): number {
  const open = active?.document.collection.id;
  return drafts.filter((draft) => draft.collection.id === open).length;
}

/** The status a resting line moves to; null keeps progress, failure and unchanged messages. */
export function restingStatus(
  current: string,
  next: string,
): string | null {
  if (!restingStatuses.has(current) || next === current) return null;
  return next;
}

/** Whether the scene may be edited now: nothing holds edits and the view is read in the scene's generation. */
export function mutationAvailable(
  active: ActiveDiagram,
  generation: ReadGeneration,
  holds: EditHolds,
): boolean {
  return !holds.movement && !holds.history && atGeneration(generation, active.generation);
}

/** "Could not be confirmed" once no request remains uncertain; null while one does, or for any other problem. */
export function staleUncertainty(
  view: Pick<WorkspaceView, 'problem' | 'pending'>,
): Diagnostic | null {
  if (view.problem?.code !== 'connection-uncertain') return null;
  return view.pending.some((item) => item.state === 'uncertain') ? null : view.problem;
}

/** The statuses that follow draft and journal changes. */
const restingStatuses: ReadonlySet<string> = new Set([
  'Ready',
  'Saved',
  'Draft not applied',
  'Edit awaiting confirmation',
]);

/** A request not yet refused is awaiting confirmation; an empty journal is saved. */
function journalStatus(pending: WorkspaceView['pending']): string {
  return pending.some((item) => item.state !== 'rejected') ? 'Edit awaiting confirmation' : 'Saved';
}
