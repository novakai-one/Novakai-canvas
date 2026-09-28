import type { SessionState } from '../../contract/records/state.js';
import type { GestureDraft, PlacementDraft, RouteDraft } from '../../contract/records/draft.js';
import type { EventOf } from '../../contract/events.js';
import type { GestureId } from '../../contract/brands.js';
import { box } from '../../contract/records/camera.js';
import { parse, reject } from '../validation/outcomes.js';
import { targetInfo } from '../scenes/address.js';
/** Every continuation names its active gesture; delayed callbacks cannot edit a replacement draft. */
export function activeDraft(
  state: SessionState,
  id: GestureId,
): GestureDraft {
  if (state.draft === null) return reject('invalid-gesture', id, 'No active gesture');
  if (state.draft.id !== id)
    return reject('invalid-gesture', id, 'Gesture identity does not match');
  return state.draft;
}
/** Move deltas are relative to captured originals, never accumulated pointer-frame rounding. */
export function moveDraft(
  state: SessionState,
  event: EventOf<'move'>,
): PlacementDraft {
  const draft = activeDraft(state, event.id);
  if (draft.kind !== 'move')
    return reject('invalid-gesture', event.id, 'Active gesture is not a move');
  const current = draft.original.map((entry) => ({
    ...entry,
    box: parse(box, {
      ...entry.box,
      x: entry.box.x + event.delta.x,
      y: entry.box.y + event.delta.y,
    }),
  }));
  return {
    ...draft,
    generation: draft.generation + 1,
    current,
    changed: event.delta.x !== 0 || event.delta.y !== 0,
  };
}
/** Measured dimensions are minimums; smaller rectangles cannot silently clip table rows or labels. */
export function resizeDraft(
  state: SessionState,
  event: EventOf<'resize'>,
): PlacementDraft {
  const draft = activeDraft(state, event.id);
  if (draft.kind !== 'resize')
    return reject('invalid-gesture', event.id, 'Active gesture is not a resize');
  return resizePlacement(state, draft, event);
}
/** One resize target was checked at begin; final geometry remains independently bounded on update. */
function resizePlacement(
  state: SessionState,
  draft: PlacementDraft,
  event: EventOf<'resize'>,
): PlacementDraft {
  const entry = draft.original[0];
  if (!entry) return reject('invalid-gesture', event.id, 'Resize target is missing');
  const minimum = targetInfo(state.index, entry.target).minimum;
  const resized = parse(box, {
    ...event.box,
    width: Math.max(minimum.width, event.box.width),
    height: Math.max(minimum.height, event.box.height),
  });
  const current = [{ ...entry, box: resized }];
  return {
    ...draft,
    generation: draft.generation + 1,
    current,
    changed: JSON.stringify(current) !== JSON.stringify(draft.original),
  };
}
/** Route points arrive in section space; changing a side/lock is meaningful even with identical points. */
export function updateRoute(
  state: SessionState,
  event: EventOf<'route'>,
): RouteDraft {
  const draft = activeDraft(state, event.id);
  if (draft.kind !== 'route')
    return reject('invalid-gesture', event.id, 'Active gesture is not a route');
  const current = {
    points: event.points,
    sourceSide: event.sourceSide,
    targetSide: event.targetSide,
    locked: event.locked,
  };
  return {
    ...draft,
    generation: draft.generation + 1,
    current,
    changed: JSON.stringify(current) !== JSON.stringify(draft.original),
  };
}
