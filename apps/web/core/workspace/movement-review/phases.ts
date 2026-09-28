/*
 * Where a held movement review is and what may happen next. It awaits a choice while its phase is
 * review or refused; another option may be shown then, and cancelling is allowed only then. Only
 * the option on display may be applied, only in review, and only while no request or undo/redo
 * holds edits and the review still matches the diagram, workspace and scene. Applying makes it
 * sending. A send that may still land makes it uncertain; a refused send, or a preview the scene
 * could not restore, makes it refused; otherwise it returns to review. Pure; the session dispatches
 * to the scene, sends requests and publishes `shown`.
 */
import type { Result } from '../../../contract/errors.js';
import type { MoveOption } from '../../../contract/records/movement.js';
import type { SceneStamp } from '../../../contract/records/owners.js';
import type { Submission } from '../../../contract/records/submission.js';
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import type { HistorySlot } from '../history/gate.js';
import { editsHeld } from '../history/journal.js';
import { diagramCurrent } from '../render/navigation.js';
import { staleReview } from './failures.js';
import { inWorkspace } from '../workspace-scope.js';
import { atGeneration } from '../read-generation.js';
import type { MovementCapture, MovementHeld, MovementPhase, MovementSlot } from './types.js';

/** The parts of the view a chosen option is checked against. */
export type ChoiceView = Pick<WorkspaceView, 'active' | 'generation' | 'collections' | 'snapshot'>;

/** A new review showing its first choice. */
export function heldMovement(
  capture: MovementCapture,
  optionId: string,
): MovementHeld {
  return {
    capture,
    shown: { review: capture.review, optionId, phase: 'review', document: capture.active.document },
  };
}

/** The held review when it belongs to this gesture; null otherwise. */
export function heldFor(
  slot: MovementSlot,
  gesture: string | null,
): MovementHeld | null {
  return slot?.capture.intent.id === gesture ? slot : null;
}

/** The held review while it awaits a choice; null when there is none or it is being applied. */
export function awaitingChoice(slot: MovementSlot): MovementHeld | null {
  if (slot === null) return null;
  return awaitsChoice(slot.shown.phase) ? slot : null;
}

/** The option the review offers under this ID; null when it offers none. */
export function offeredOption(
  held: MovementHeld,
  optionId: string,
): MoveOption | null {
  return held.capture.review.options.find((item) => item.id === optionId) ?? null;
}

/** The held review when this option is on display and awaiting a choice; null otherwise. */
export function applicable(
  slot: MovementSlot,
  optionId: string,
): MovementHeld | null {
  return slot?.shown.phase === 'review' && slot.shown.optionId === optionId ? slot : null;
}

/** A request not yet refused, undo/redo, or a history read holds the move back. */
export function moveSubmissionBlocked(
  view: Pick<WorkspaceView, 'pending' | 'history'>,
  gate: HistorySlot,
): boolean {
  return (
    view.pending.some((item) => item.state !== 'rejected') ||
    editsHeld(gate, view.pending) ||
    view.history?.busy === true
  );
}

/** The chosen option, or its failure; a review made on another diagram, workspace or scene is stale. */
export function currentChoice(
  capture: MovementCapture,
  chosen: Result<MoveOption>,
  view: ChoiceView,
  stamp: SceneStamp,
): Result<MoveOption> {
  if (!chosen.ok) return chosen;
  return reviewCurrent(capture, view, stamp) ? chosen : { ok: false, error: staleReview() };
}

/** The review showing another option. */
export function withOption(
  held: MovementHeld,
  optionId: string,
): MovementHeld {
  return { capture: held.capture, shown: { ...held.shown, optionId } };
}

/** The review sending this option; the send gets its own request ID, apart from the gesture's. */
export function sendingMove(
  held: MovementHeld,
  optionId: string,
): MovementHeld {
  const { capture } = held;
  return {
    capture,
    shown: {
      review: capture.review,
      optionId,
      phase: 'sending',
      document: capture.active.document,
    },
  };
}

/** The review in another phase. */
export function inPhase(
  held: MovementHeld,
  phase: MovementPhase,
): MovementHeld {
  return { capture: held.capture, shown: { ...held.shown, phase } };
}

/** The request may still land: it is sending, or its outcome is unknown. */
export function savingRequest(item: Submission | undefined): boolean {
  return item?.state === 'uncertain' || item?.state === 'sending';
}

/** After a failed send: refused when the request was refused or the preview is gone, else review. */
export function failedPhase(
  rejected: boolean,
  previewShown: boolean,
): 'rejected' | 'review' {
  return rejected || !previewShown ? 'rejected' : 'review';
}

/** The phase the journal moves a held review to; null leaves it where it is. */
export function recoveryPhase(item: Submission | undefined): 'rejected' | 'uncertain' | null {
  if (item?.state === 'rejected') return 'rejected';
  return savingRequest(item) ? 'uncertain' : null;
}

/** A choice may be made in review or after a refusal. */
function awaitsChoice(phase: MovementPhase): boolean {
  return phase === 'review' || phase === 'rejected';
}

/** The review was made on the diagram, generation, workspace and scene shown now. */
function reviewCurrent(
  capture: MovementCapture,
  view: ChoiceView,
  stamp: SceneStamp,
): boolean {
  return sameDiagram(capture, view) && sameScene(capture.review.stamp, stamp);
}

/** The same open diagram, at its listed revision, in the same generation and workspace. */
function sameDiagram(
  capture: MovementCapture,
  view: ChoiceView,
): boolean {
  return (
    capture.active === view.active &&
    atGeneration(view.generation, capture.active.generation) &&
    diagramCurrent(view.collections, capture.active) &&
    inWorkspace(capture.workspace, view.snapshot?.workspace)
  );
}

/** The scene's revision, input and generation are unchanged. */
function sameScene(
  reviewed: SceneStamp,
  current: SceneStamp,
): boolean {
  return (
    current.revision === reviewed.revision &&
    current.inputKey === reviewed.inputKey &&
    current.generation === reviewed.generation
  );
}
