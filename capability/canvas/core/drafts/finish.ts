import type { SessionState, Transition } from '../../contract/records/state.js';
import type {
  GestureDraft,
  GeometryEntry,
  PlacementDraft,
  RecoverableDraft,
} from '../../contract/records/draft.js';
import type { EditIntent, LocalPlacement } from '../../contract/records/intent.js';
import type { GestureId } from '../../contract/brands.js';
import { activeDraft } from './update.js';
import { regroupIntent } from './regroup.js';
import { targetInfo } from '../scenes/address.js';
import { changed, canMutate } from '../interaction/changes.js';
import { reject } from '../validation/outcomes.js';
/** Convert explicit geometry only; moving preserves omitted dimensions, resizing supplies both. */
function localPlacement(
  state: SessionState,
  draft: PlacementDraft,
  entry: GeometryEntry,
): LocalPlacement {
  const origin = targetInfo(state.index, entry.target).parentOrigin;
  const position = { x: entry.box.x - origin.x, y: entry.box.y - origin.y, locked: entry.locked };
  if (draft.kind === 'move') return position;
  return { ...position, width: entry.box.width, height: entry.box.height };
}
/** One intent represents the whole gesture; Model/Authoring still own feasibility and committed truth. */
export function draftIntent(
  state: SessionState,
  draft: GestureDraft,
): EditIntent {
  if (draft.kind === 'route')
    return {
      kind: 'route',
      id: draft.id,
      base: draft.base,
      scope: 'appearance',
      target: draft.target,
      route: draft.current,
    };
  const regroup = regroupIntent(state, draft);
  if (regroup !== null) return regroup;
  const entries = draft.current.map((entry) => ({
    target: entry.target,
    placement: localPlacement(state, draft, entry),
  }));
  return { kind: 'placement', id: draft.id, base: draft.base, scope: 'appearance', entries };
}
/** Release emits once and retains a recovery copy until the host confirms its matching receipt. */
export function finishDraft(
  state: SessionState,
  id: GestureId,
): Transition {
  const draft = activeDraft(state, id);
  if (!draft.changed) return changed(state, { ...state, draft: null });
  if (!canMutate(state))
    return reject('mutation-unavailable', id, 'Keep the draft until editing is available');
  const intent = draftIntent(state, draft);
  const retained: RecoverableDraft = {
    draft,
    reason: 'submitted',
    message: 'Awaiting confirmed authoring outcome',
  };
  return changed(state, { ...state, draft: null, recovery: [...state.recovery, retained] }, [
    { kind: 'edit-intent', intent },
  ]);
}
