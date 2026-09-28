/*
 * Finding the journal entry a Canvas gesture sent. Each send has its own request ID, apart from
 * the gesture's ID (I2), so the journal is searched by the gesture each entry keeps. Pure; the
 * session sends, and the journal owns recovery.
 */
import type { Submission } from '../../contract/records/submission.js';
import type { GestureId } from '../../contract/brands.js';

/**
 * The newest journal entry sent for `gesture`; undefined when the journal keeps none. The newest
 * wins, so an older entry of the same gesture never decides what the gesture shows.
 */
export function requestForGesture(
  pending: readonly Submission[],
  gesture: GestureId,
): Submission | undefined {
  return pending.findLast((item) => item.gesture === gesture);
}
