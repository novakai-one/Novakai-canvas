import { treeNode } from '../scenes/tree.js';
import type { SessionState, Transition } from '../../contract/records/state.js';
import type { Endpoint, EditIntent } from '../../contract/records/intent.js';
import type { EventOf } from '../../contract/events.js';
import { handler, type Handler } from './handler.js';
import { canMutate, changed } from './changes.js';
import { targetInfo, targetKey } from '../scenes/address.js';
import { reject } from '../validation/outcomes.js';
import { beginDraft } from '../drafts/begin.js';
import { moveDraft } from '../drafts/update.js';
import { finishDraft } from '../drafts/finish.js';
/** Mutation intents are requests to the host's Authoring planner, not direct canonical operations. */
function emitIntent(
  state: SessionState,
  intent: EditIntent,
): Transition {
  if (!canMutate(state))
    return reject('mutation-unavailable', intent.id, 'Editing is currently unavailable');
  return changed(state, state, [{ kind: 'edit-intent', intent }]);
}
/** Selectable endpoints resolve within one scene; member names come from measured typed anchors. */
function checkEndpoint(
  state: SessionState,
  endpoint: Endpoint,
): void {
  const target = { kind: 'node' as const, section: endpoint.section, id: endpoint.node };
  targetInfo(state.index, target);
  if (endpoint.member === null) return;
  const node = state.index.nodes[targetKey(target)];
  if (!node?.measured.content.anchors.some((anchor) => anchor.member === endpoint.member))
    reject('unknown-target', endpoint.member, 'Endpoint member is not visible');
}
/** The second endpoint emits a form intent; host supplies label/kind/cardinalities before Authoring submission. */
function connect(
  state: SessionState,
  event: EventOf<'connect'>,
): Transition {
  if (!canMutate(state))
    return reject('mutation-unavailable', event.id, 'Connections are unavailable');
  checkEndpoint(state, event.endpoint);
  const cleared = { ...state, hover: null };
  if (state.connection === null) return changed(state, { ...cleared, connection: event.endpoint });
  return completeConnection(cleared, event);
}
/** Connections cannot silently span sections; cross-section reuse is a canonical host/model decision. */
function completeConnection(
  state: SessionState,
  event: EventOf<'connect'>,
): Transition {
  const source = state.connection;
  if (source === null) return changed(state, state);
  if (source.section !== event.endpoint.section)
    return reject('invalid-gesture', event.id, 'Choose endpoints in the same section');
  return emitIntent(
    { ...state, connection: null },
    {
      kind: 'connection',
      id: event.id,
      base: state.stamp,
      scope: 'appearance',
      source,
      target: event.endpoint,
    },
  );
}
const directions = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};
/** Keyboard nudge reuses exactly the drag capture/conversion/recovery path, producing one transaction intent. */
export function nudgeSelection(
  state: SessionState,
  event: EventOf<'nudge'>,
): Transition {
  const targets = state.selection.filter((target) => !treeNode(state, target));
  if (targets.length === 0) return changed(state, state);
  const draft = beginDraft(state, {
    kind: 'begin',
    id: event.id,
    gesture: 'move',
    targets,
  });
  const captured = { ...state, draft };
  const amount = event.coarse ? state.profile.coarseNudge : state.profile.nudge;
  const vector = directions[event.direction];
  const updated = moveDraft(captured, {
    kind: 'move',
    id: event.id,
    delta: { x: vector.x * amount, y: vector.y * amount },
  });
  return finishDraft({ ...captured, draft: updated }, event.id);
}
/** Bulk/local semantic operations preserve scope and base; host owns review, transformation and acknowledgment. */
export function commandHandlers(): readonly Handler[] {
  return [
    handler('connect', connect),
    handler('nudge', nudgeSelection),
    handler('remove-appearances', (state, event) =>
      emitIntent(state, {
        kind: 'remove-appearances',
        id: event.id,
        base: state.stamp,
        scope: 'appearance',
        targets: state.selection,
      }),
    ),
    handler('duplicate', (state, event) =>
      emitIntent(state, {
        kind: 'duplicate',
        id: event.id,
        base: state.stamp,
        scope: 'appearance',
        targets: state.selection,
      }),
    ),
    handler('align', (state, event) =>
      state.selection.every((target) => treeNode(state, target))
        ? changed(state, state)
        : emitIntent(state, {
            kind: 'align',
            id: event.id,
            base: state.stamp,
            scope: 'appearance',
            targets: state.selection.filter((target) => !treeNode(state, target)),
            axis: event.axis,
          }),
    ),
  ];
}
