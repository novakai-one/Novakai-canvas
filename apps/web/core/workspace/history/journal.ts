/*
 * How undo/redo and the request journal hold edits back. Undo or redo may start only when the gate
 * is idle, the journal holds nothing unrefused, no canvas gesture is unfinished and the history
 * status is known. While the gate is held, edits are refused; while an inverse request is still
 * unresolved, every request is refused. An inverse that leaves the journal unrefused holds the
 * gate (gate.ts). Pure; the session reports refusals and reconciles inverses.
 */
import { diagnostic, type Result } from '../../../contract/errors.js';
import type { Request } from '../../../contract/records/owners.js';
import type { Submission } from '../../../contract/records/submission.js';
import { gateHeld, type GateView, type HistorySlot, type HistoryStatus } from './gate.js';

/** Undo/redo holds edits: the gate is held, or a request is still in the journal. */
export function editsHeld(
  slot: HistorySlot,
  pending: readonly Submission[],
): boolean {
  return gateHeld(slot) || pending.some((item) => item.state !== 'rejected');
}

/** The status undo or redo navigates from; null while edits are held, a canvas gesture is unfinished or the status is unknown. */
export function navigableStatus(
  slot: HistorySlot,
  view: GateView,
  canvasDraft: boolean,
): HistoryStatus | null {
  if (editsHeld(slot, view.pending) || canvasDraft) return null;
  return view.history?.status ?? null;
}

/** A held gate refuses edits; an unresolved inverse refuses every request. */
export function submissionAllowed(
  slot: HistorySlot,
  pending: readonly Submission[],
  request: Request,
): Result<void> {
  if (blockedByHistory(slot, pending, request))
    return {
      ok: false,
      error: diagnostic(
        'pending-request',
        'Wait for undo or redo to finish',
        'Your draft is retained.',
      ),
    };
  return { ok: true, value: undefined };
}

/** An inverse left the journal unrefused between `before` and `after`. */
export function finishedInverse(
  before: readonly Submission[],
  after: readonly Submission[],
): boolean {
  return before.some((item) => unresolvedInverse(item) && !listed(after, item));
}

/** The inverse requests still waiting in the journal. */
export function unresolvedInverses(pending: readonly Submission[]): readonly Submission[] {
  return pending.filter(unresolvedInverse);
}

/** A held gate blocks edits; an unresolved inverse blocks any request. */
function blockedByHistory(
  slot: HistorySlot,
  pending: readonly Submission[],
  request: Request,
): boolean {
  if (gateHeld(slot) && request.intent.kind === 'change') return true;
  return pending.some(unresolvedInverse);
}

/** An undo or redo request not yet refused. */
function unresolvedInverse(item: Submission): boolean {
  return item.state !== 'rejected' && item.request.intent.kind !== 'change';
}

/** The journal still holds `item`'s request. */
function listed(
  pending: readonly Submission[],
  item: Submission,
): boolean {
  return pending.some((other) => other.request.request === item.request.request);
}
