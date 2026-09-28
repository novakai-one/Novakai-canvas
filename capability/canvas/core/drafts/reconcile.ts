import { targetKey } from '../scenes/address.js';
import type { SessionState, Transition } from '../../contract/records/state.js';
import type { RecoverableDraft } from '../../contract/records/draft.js';
import type { SceneAdmission } from '../../contract/ports/scene-admission.js';
import type { EventOf } from '../../contract/events.js';
import type { GestureId } from '../../contract/brands.js';
import { sameStamp, admitScene } from '../scenes/accept.js';
import { indexScene } from '../scenes/index.js';
import { refreshReadingOrder } from '../scenes/reading.js';
import { survivingSelection } from '../interaction/selection.js';
import { changed } from '../interaction/changes.js';
import type { Result } from '../../contract/errors.js';
import { protect, reject } from '../validation/outcomes.js';
/** Foreign scene/disconnection cancels only the active gesture and retains its original base and geometry. */
export function retainActive(
  state: SessionState,
  reason: RecoverableDraft['reason'],
  message: string,
): SessionState {
  if (state.draft === null) return state;
  return {
    ...state,
    draft: null,
    recovery: [...state.recovery, { draft: state.draft, reason, message }],
  };
}
/** New data never refits or overwrites active human geometry; host can reopen the explicit recovery copy. */
export function receiveScene(
  state: SessionState,
  event: EventOf<'receive-scene'>,
  reader: SceneAdmission,
): Result<Transition> {
  return protect(() => reconcileScene(state, event, reader));
}
/** Admission completes before replacement; the Result boundary retains original state on any failure. */
function reconcileScene(
  state: SessionState,
  event: EventOf<'receive-scene'>,
  reader: SceneAdmission,
): Transition {
  if (!sameStamp(state.requested, event.stamp))
    return reject('stale-scene', 'stamp', 'Scene belongs to an obsolete requested job');
  if (sameStamp(state.stamp, event.stamp)) return changed(state, state);
  const scene = admitScene(reader, event.scene, event.stamp);
  const index = indexScene(scene);
  const retained = retainForScene(state, index);
  const updated = {
    ...retained,
    scene,
    index,
    stamp: event.stamp,
    connection: null,
    hover: null,
    routePreview: null,
  };
  const selection = survivingSelection(updated, state.selection);
  return changed(state, refreshReadingOrder({ ...updated, selection }), [
    { kind: 'announce', message: 'Collection updated; camera preserved' },
  ]);
}
/** Definitive rejection changes only the matching retained gesture; later drafts cannot be cleared accidentally. */
export function rejectDraft(
  state: SessionState,
  id: GestureId,
  message: string,
): SessionState {
  const recovery = state.recovery.map((entry): RecoverableDraft => {
    if (entry.draft.id !== id) return entry;
    return { ...entry, reason: 'rejected', message };
  });
  return {
    ...state,
    recovery,
    routePreview: state.routePreview?.gesture === id ? null : (state.routePreview ?? null),
  };
}
/** Receipt confirmation and explicit discard remove a single matching recovery copy; replay is harmless. */
export function removeRecovery(
  state: SessionState,
  id: GestureId,
): SessionState {
  return {
    ...state,
    recovery: state.recovery.filter((entry) => entry.draft.id !== id),
    routePreview: state.routePreview?.gesture === id ? null : (state.routePreview ?? null),
  };
}

/** A removed target is retained as recovery data only; it cannot be projected onto an unrelated replacement scene. */
function draftSurvives(
  state: SessionState,
  index: SessionState['index'],
): boolean {
  const draft = state.draft;
  if (draft === null) return true;
  const targets =
    draft.kind === 'route' ? [draft.target] : draft.original.map((entry) => entry.target);
  return targets.every((target) => index.targets[targetKey(target)] !== undefined);
}

/** Scene replacement classifies a removed gesture target distinctly while preserving the full recovery payload. */
function retainForScene(
  state: SessionState,
  index: SessionState['index'],
): SessionState {
  const reason = draftSurvives(state, index) ? 'scene-changed' : 'target-removed';
  return retainActive(state, reason, 'The collection changed during your gesture');
}
