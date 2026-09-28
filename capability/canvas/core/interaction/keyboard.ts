import type { SessionState, Transition } from '../../contract/records/state.js';
import type { EventOf, CanvasEvent } from '../../contract/events.js';
import { targetKey } from '../scenes/address.js';
import { changed } from './changes.js';
import { nudgeSelection } from './commands.js';
import { escapeCanvas } from './selection-events.js';
const arrows = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
} as const;
/** Key narrowing is a checked vocabulary test, not a type assertion on arbitrary keyboard text. */
function arrow(key: string): key is keyof typeof arrows {
  return Object.hasOwn(arrows, key);
}
/** Reading-order arrows select a target without Locate; Alt arrows use world-unit nudge instead. */
function navigate(
  state: SessionState,
  event: EventOf<'keyboard'>,
): Transition {
  if (!arrow(event.key)) return changed(state, state);
  if (event.alt)
    return nudgeSelection(state, {
      kind: 'nudge',
      id: event.id,
      direction: arrows[event.key],
      coarse: event.shift,
    });
  return selectAdjacent(state, event.key);
}
/** Stable ordered appearance addresses permit predictable keyboard navigation across sections. */
function selectAdjacent(
  state: SessionState,
  key: keyof typeof arrows,
): Transition {
  const order = state.index.order.filter((id) => state.index.targets[id]?.target.kind === 'node');
  const selected = state.selection[0];
  const current = selected === undefined ? -1 : order.indexOf(targetKey(selected));
  const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[key];
  const next = Math.max(0, Math.min(order.length - 1, current + delta));
  const target = state.index.targets[order[next] ?? '']?.target;
  if (!target) return changed(state, state);
  return changed(state, { ...state, selection: [target], hover: null });
}
/** Enter is an explicit inspect request; missing selection is a harmless no-op. */
function inspectSelected(state: SessionState): Transition {
  const target = state.selection[0];
  if (!target) return changed(state, state);
  return changed(state, state, [{ kind: 'inspect-request', target }]);
}
export type Dispatch = (state: SessionState, event: CanvasEvent) => Transition;
/** Typing/modal contexts retain native keys; browser zoom shortcuts are never handled by this vocabulary. */
export function keyboardEvent(
  state: SessionState,
  event: EventOf<'keyboard'>,
  dispatch: Dispatch,
): Transition {
  if (event.typing || event.modal) return changed(state, state);
  return canvasKey(state, event, dispatch);
}
/** Explicit action registry keeps deletion and inspection distinct from arrow navigation. */
function canvasKey(
  state: SessionState,
  event: EventOf<'keyboard'>,
  dispatch: Dispatch,
): Transition {
  const actions: Readonly<Record<string, () => Transition>> = {
    Escape: () => escapeCanvas(state),
    Enter: () => inspectSelected(state),
    Delete: () => dispatch(state, { kind: 'remove-appearances', id: event.id }),
    Backspace: () => dispatch(state, { kind: 'remove-appearances', id: event.id }),
  };
  const action = actions[event.key];
  if (action) return action();
  return navigate(state, event);
}
