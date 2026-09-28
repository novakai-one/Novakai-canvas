/*
 * The failures a movement review reports. Each keeps the draft and says how to recover it. Pure.
 */
import { diagnostic, type Diagnostic } from '../../../contract/errors.js';
import type { MoveReview } from '../../../contract/records/movement.js';

/** Model offered no plain move and no single option; Model's own reason wins. */
export function noMoveOnlyOption(review: MoveReview): Diagnostic {
  return diagnostic(
    'unsupported-edit',
    review.reason ?? 'This movement has no valid move-only option; keep the draft for review.',
    'Adjust the position or use the inspector.',
  );
}

/** The scene would not show the review's first preview. */
export function previewRefused(): Diagnostic {
  return diagnostic(
    'invalid-edit',
    'The movement preview could not be accepted.',
    'Keep the draft and try the gesture again.',
  );
}

/** A new gesture arrived while a review is held. */
export function movementActive(): Diagnostic {
  return diagnostic(
    'pending-request',
    'Review or cancel the current movement before starting another.',
    'Apply or cancel the retained movement review.',
  );
}

/** The scene would not show the chosen option's preview. */
export function optionPreviewRefused(): Diagnostic {
  return diagnostic(
    'invalid-edit',
    'The selected movement preview could not be accepted.',
    'Keep the current preview or cancel the draft.',
  );
}

/** Another request or undo/redo holds the move back. */
export function operationBusy(): Diagnostic {
  return diagnostic(
    'pending-request',
    'Wait for the current operation to finish',
    'Your movement draft is retained.',
  );
}

/** The diagram changed since the review was made. */
export function staleReview(): Diagnostic {
  return diagnostic(
    'stale-gesture',
    'This movement review is stale; the draft was retained.',
    'Reload the diagram before applying it.',
  );
}

/** The scene no longer shows the reviewed preview. */
export function previewGone(): Diagnostic {
  return diagnostic(
    'invalid-edit',
    'The inspected movement preview is no longer displayed.',
    'Restore the preview or cancel this retained draft.',
  );
}

/** Cancel was asked for while the review is not awaiting a choice. */
export function alreadySaving(): Diagnostic {
  return diagnostic(
    'pending-request',
    'This movement is already being saved; wait for confirmation before cancelling.',
    'Check the retained request for its receipt.',
  );
}
