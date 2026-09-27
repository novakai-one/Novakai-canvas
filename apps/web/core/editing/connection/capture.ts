/*
 * A connection draft's request as the panel shows it. While its request is in the journal the
 * draft follows the request's state; a dismissed request returns the draft to editing without a
 * problem. A failure is shown on the draft the panel displays. Pure; the session holds the capture
 * and publishes.
 */
import type { Diagnostic } from '../../../contract/errors.js';
import type { ConnectionDraft } from '../../../contract/records/connection.js';
import type { Request } from '../../../contract/records/owners.js';
import type { Submission } from '../../../contract/records/submission.js';
import type { ConnectionCapture } from './draft.js';

/** The capture following its request's journal state; null when it has no request in the journal. */
export function withRequestState(
  capture: ConnectionCapture | null,
  pending: readonly Submission[],
): ConnectionCapture | null {
  if (capture === null || capture.request === null) return null;
  return followRequest(capture, capture.request, pending);
}

/** The capture back in editing once its request is dismissed; null when it did not send it. */
export function releasedConnection(
  capture: ConnectionCapture | null,
  requestId: string,
): ConnectionCapture | null {
  if (capture === null || capture.request?.request !== requestId) return null;
  return { draft: { ...capture.draft, problem: null, requestState: 'draft' }, request: null };
}

/** The draft the panel shows, or this one, with the failure as its problem. */
export function connectionProblem(
  shown: ConnectionDraft | null,
  draft: ConnectionDraft,
  error: Diagnostic,
): ConnectionDraft {
  const current = shown?.id === draft.id ? shown : draft;
  return { ...current, problem: error.message };
}

/** The draft takes the state of its request's journal entry. */
function followRequest(
  capture: ConnectionCapture,
  request: Request,
  pending: readonly Submission[],
): ConnectionCapture | null {
  const item = pending.find((entry) => entry.request.request === request.request);
  if (item === undefined) return null;
  return { ...capture, draft: { ...capture.draft, requestState: item.state } };
}
