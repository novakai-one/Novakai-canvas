import type { SessionState, Transition } from '../../contract/records/state.js';
import { handler, type Handler } from './handler.js';
import { changed } from './changes.js';
import { selectTargets, marquee } from './selection.js';
import { targetInfo, targetKey } from '../scenes/address.js';
import { readingAction, collapseTarget } from '../scenes/reading.js';
import type { EventOf } from '../../contract/events.js';
/** Escape cancels the innermost Canvas interaction first, then clears selection on a later press. */
export function escapeCanvas(state: SessionState): Transition {
  if (state.draft !== null) return changed(state, { ...state, draft: null, hover: null });
  if (state.connection !== null) return changed(state, { ...state, connection: null, hover: null });
  return escapeTool(state);
}
/** A temporary connect/hand tool resets before selection; camera is never part of Escape behavior. */
function escapeTool(state: SessionState): Transition {
  if (state.tool !== 'select') return changed(state, { ...state, tool: 'select', hover: null });
  return changed(state, { ...state, selection: [], hover: null });
}

/** Hover is view-only, graph-only and inactive throughout every edit gesture or explicit selection. */
function canHover(
  state: SessionState,
  event: EventOf<'target-enter'>,
): boolean {
  return [
    state.selection.length === 0,
    state.draft === null,
    state.connection === null,
    state.tool === 'select',
    event.target.kind === 'wire' ||
      state.index.nodes[targetKey(event.target)]?.measured.groupId === null,
  ].every(Boolean);
}

/** A late leave clears only the same scoped target, never a newer hover. */
function leaveTarget(
  state: SessionState,
  event: EventOf<'target-leave'>,
): SessionState {
  if (state.hover === null || targetKey(state.hover) !== targetKey(event.target)) return state;
  return { ...state, hover: null };
}

/** Enter validates against the admitted index before storing a transient appearance target. */
function enterTarget(
  state: SessionState,
  event: EventOf<'target-enter'>,
): SessionState {
  targetInfo(state.index, event.target);
  return canHover(state, event) ? { ...state, hover: event.target } : state;
}
/** Selection, inspect and reading remain explicit independent transitions; shell owns panel visibility. */
export function selectionHandlers(): readonly Handler[] {
  return [
    handler('select', (state, event) => changed(state, selectTargets(state, event))),
    handler('marquee', (state, event) => changed(state, marquee(state, event.box, event.additive))),
    handler('target-enter', (state, event) => changed(state, enterTarget(state, event))),
    handler('target-leave', (state, event) => changed(state, leaveTarget(state, event))),
    handler('tool', (state, event) =>
      changed(state, { ...state, tool: event.tool, connection: null, hover: null }),
    ),
    handler('inspect', (state, event) => {
      targetInfo(state.index, event.target);
      return changed(state, state, [{ kind: 'inspect-request', target: event.target }]);
    }),
    handler('escape', (state) => escapeCanvas(state)),
    handler('reading', (state, event) =>
      changed(state, { ...readingAction(state, event.action), hover: null }),
    ),
    handler('collapse', (state, event) =>
      changed(state, { ...collapseTarget(state, event.target), hover: null }),
    ),
  ];
}
