import { treeFolder } from './tree.js';
import type { SessionState } from '../../contract/records/state.js';
import type { Target } from '../../contract/records/selection.js';
import { targetKey, targetInfo } from './address.js';
import { fitBounds } from '../camera/navigate.js';
import { survivingSelection } from '../interaction/selection.js';
import { reject } from '../validation/outcomes.js';
/** Entering reading mode records editing context; it never commits a detail-collapse change. */
function enter(state: SessionState): SessionState {
  if (state.reading !== null) return state;
  if (state.draft !== null)
    return reject(
      'invalid-gesture',
      'reading',
      'Finish or cancel your gesture before entering reading mode',
    );
  const reading = {
    savedCamera: state.camera,
    savedSelection: state.selection,
    sections: state.scene.sections.map((section) => section.id),
    active: 0,
    collapsed: [],
  };
  return focusReading({ ...state, reading, selection: [], connection: null });
}
/** Reading camera follows explicit next/previous requests and clamps to available sections. */
function advance(
  state: SessionState,
  delta: number,
): SessionState {
  if (state.reading === null) return state;
  const active = Math.max(
    0,
    Math.min(state.reading.sections.length - 1, state.reading.active + delta),
  );
  return focusReading({ ...state, reading: { ...state.reading, active } });
}
/** Missing sections after a remote update do not force a camera jump or invent a reading target. */
function focusReading(state: SessionState): SessionState {
  const id = state.reading?.sections[state.reading.active];
  const section = state.scene.sections.find((candidate) => candidate.id === id);
  if (!section) return state;
  return { ...state, camera: fitBounds(state.camera, section.box, state.profile) };
}
/** Exit restores exact editing camera and surviving selection even if the visible scene changed meanwhile. */
function exit(state: SessionState): SessionState {
  if (state.reading === null) return state;
  return {
    ...state,
    camera: state.reading.savedCamera,
    selection: survivingSelection(state, state.reading.savedSelection),
    reading: null,
  };
}
const readingActions = {
  enter,
  exit,
  next: (state: SessionState): SessionState => advance(state, 1),
  previous: (state: SessionState): SessionState => advance(state, -1),
};
/** Closed reading lifecycle is independent of persistence and panel state; host handles typed failures. */
export function readingAction(
  state: SessionState,
  action: keyof typeof readingActions,
): SessionState {
  return readingActions[action](state);
}
/** Collapse is session-only and requires reading mode; descendants/wires are hidden by the view projection. */
export function collapseTarget(
  state: SessionState,
  target: Target,
): SessionState {
  if (treeFolder(state, target)) return collapseTree(state, target);
  if (state.reading === null)
    return reject('invalid-gesture', 'reading', 'Detail collapse is available in reading mode');
  targetInfo(state.index, target);
  const key = targetKey(target);
  const collapsed = toggled(state.reading.collapsed, key);
  return { ...state, reading: { ...state.reading, collapsed } };
}

/** A committed replacement refreshes reading order without navigating; surviving active sections retain their identity. */
export function refreshReadingOrder(state: SessionState): SessionState {
  const reading = state.reading;
  if (reading === null) return state;
  const sections = state.scene.sections.map((section) => section.id);
  const previousId = reading.sections[reading.active];
  const found = sections.findIndex((id) => id === previousId);
  const fallback = Math.max(0, Math.min(reading.active, sections.length - 1));
  const active = found < 0 ? fallback : found;
  const collapsed = reading.collapsed.filter((key) => state.index.targets[key] !== undefined);
  return { ...state, reading: { ...reading, sections, active, collapsed } };
}

function toggled(
  current: readonly string[],
  key: string,
): readonly string[] {
  return current.includes(key) ? current.filter((id) => id !== key) : [...current, key];
}
function collapseTree(
  state: SessionState,
  target: Target,
): SessionState {
  return {
    ...state,
    treeCollapsed: toggled(state.treeCollapsed ?? [], targetKey(target)),
    hover: null,
  };
}
