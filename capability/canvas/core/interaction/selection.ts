import type { SessionState } from '../../contract/records/state.js';
import type { Target } from '../../contract/records/selection.js';
import type { Box } from '../../contract/records/camera.js';
import type { EventOf } from '../../contract/events.js';
import { targetKey, targetInfo } from '../scenes/address.js';
import { intersects } from '../camera/coordinates.js';
/** Deduplicate scoped addresses; order remains the explicit selection order rather than object identity. */
function distinct(targets: readonly Target[]): readonly Target[] {
  return [...new Map(targets.map((target) => [targetKey(target), target])).values()];
}
/** Toggle uses symmetric membership; one canonical object in another section remains untouched. */
function toggle(
  current: readonly Target[],
  incoming: readonly Target[],
): readonly Target[] {
  const keys = new Set(incoming.map(targetKey));
  const old = new Set(current.map(targetKey));
  return [
    ...current.filter((target) => !keys.has(targetKey(target))),
    ...incoming.filter((target) => !old.has(targetKey(target))),
  ];
}
const modes = {
  replace: (_current: readonly Target[], incoming: readonly Target[]): readonly Target[] =>
    incoming,
  add: (current: readonly Target[], incoming: readonly Target[]): readonly Target[] =>
    distinct([...current, ...incoming]),
  toggle,
};
/** Selection changes only scoped addresses; there is deliberately no camera or inspector visibility update. */
export function selectTargets(
  state: SessionState,
  event: EventOf<'select'>,
): SessionState {
  event.targets.forEach((target) => targetInfo(state.index, target));
  return {
    ...state,
    selection: modes[event.mode](state.selection, distinct(event.targets)),
    hover: null,
  };
}
/** Marquee selects visible node appearances; section backgrounds cannot swallow their entire contents. */
export function marquee(
  state: SessionState,
  bounds: Box,
  additive: boolean,
): SessionState {
  const targets = Object.values(state.index.targets)
    .filter((info) => info.target.kind === 'node')
    .filter((info) => intersects(info.box, bounds))
    .map((info) => info.target);
  return selectTargets(state, { kind: 'select', targets, mode: additive ? 'add' : 'replace' });
}
/** Scene reconciliation removes only missing addresses and keeps all surviving appearance identities. */
export function survivingSelection(
  state: SessionState,
  selection: readonly Target[],
): readonly Target[] {
  return selection.filter((target) => state.index.targets[targetKey(target)] !== undefined);
}
