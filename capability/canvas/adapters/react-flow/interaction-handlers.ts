/*
 * Translates React Flow callbacks into public Canvas events: selection, hover, connections and the
 * viewport, composed with the geometry gestures and keyboard commands it is given. Not pure: it
 * dispatches to the session. The host drains effects, retains drafts and repairs reported callback
 * failures; canceled pointer IDs never replay.
 */
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';
import type {
  InteractionOwners,
  Interactions,
  FlowNode,
  FlowEdge,
  ViewActions,
} from '../../contract/react-types.js';
import type { HoverPause, InteractionParts } from '../../contract/interaction-parts.js';
import type { Target } from '../../contract/records/selection.js';
import type { CanvasEvent } from '../../contract/events.js';
import type { SessionState } from '../../contract/records/state.js';
import type { Endpoint } from '../../contract/records/intent.js';
/** The React Flow change records selection reads. */
type FlowChange = NodeChange<FlowNode> | EdgeChange<FlowEdge>;
/** The two node endpoints one React Flow connection joins. */
interface ConnectionEnds {
  readonly source: Endpoint;
  readonly target: Endpoint;
}
/** Translate React Flow events to public Canvas commands; drag, resize and keys come from `parts`. */
export function createInteractions(
  parts: InteractionParts,
  owners: InteractionOwners,
): Interactions {
  const hoverSuppression = new Set<HoverPause>();
  /** Typed failures are reported to the host; they never trigger a fallback save or guessed state change. */
  function dispatch(event: CanvasEvent): void {
    const result = owners.session.dispatch(event);
    if (!result.ok) {
      owners.onError(result.error);
      return;
    }
    result.value.diagnostics.forEach((diagnostic) => owners.onError(diagnostic));
  }
  /** Gesture suppression is adapter-local because React Flow owns pan/connect lifecycle boundaries. */
  function suppressHover(reason: HoverPause): void {
    hoverSuppression.add(reason);
    clearHover();
  }
  /** Lifts one pause; hover returns once no pause remains. */
  function resumeHover(reason: HoverPause): void {
    hoverSuppression.delete(reason);
  }
  /** Leaves the hovered target, if any. */
  function clearHover(): void {
    const hover = owners.session.getSnapshot().hover;
    if (hover !== null) leaveHover(hover);
  }
  /** Hovers the target unless a drag, pan or connection is running. */
  function enterHover(target: Target): void {
    if (hoverSuppression.size > 0) return;
    dispatch({ kind: 'target-enter', target });
  }
  /** Leaves the target; leaving is never paused. */
  function leaveHover(target: Target): void {
    dispatch({ kind: 'target-leave', target });
  }
  /** Asks the host to inspect the target. */
  function inspect(target: Target): void {
    dispatch({ kind: 'inspect', target });
  }
  const geometry = parts.createGeometryGestures({
    owners,
    dispatch,
    sameTarget,
    suppressHover,
    resumeHover,
  });
  const keyboard = parts.createKeyboardCommands({ owners, dispatch, sameTarget });
  /** Selection changes are the only React Flow change records consumed; dimensions/positions remain derived. */
  function selection(changes: readonly FlowChange[]): void {
    if (!changes.some((change) => change.type === 'select')) return;
    dispatch({ kind: 'select', targets: selectedTargets(owners, changes), mode: 'replace' });
  }
  /** Connect callbacks resolve endpoint data through the admitted index and never assume a scene-ID encoding. */
  function connect(connection: Connection): void {
    const ends = connectionEnds(owners.session.getSnapshot(), connection);
    if (ends === null) return;
    const gestureId = owners.nextGestureId();
    if (!gestureId.ok) return;
    dispatch({ kind: 'connect', id: gestureId.value, endpoint: ends.source });
    dispatch({ kind: 'connect', id: gestureId.value, endpoint: ends.target });
  }
  const actions: ViewActions = {
    dispatch,
    beginResize: geometry.beginResize,
    resize: geometry.resize,
    finishGeometry: geometry.finishGeometry,
    cancelGeometry: geometry.cancelGeometry,
    nextGestureId: owners.nextGestureId,
    readPreview: owners.session.readPreview,
    subscribePreview: owners.session.subscribePreview,
  };
  return {
    actions,
    keyboard,
    flow: {
      onNodeDragStart: geometry.startDrag,
      onNodeDrag: geometry.moveDrag,
      onNodeDragStop: geometry.finishGeometry,
      onSelectionDragStart: (event, nodes) => {
        const first = nodes[0];
        if (first) geometry.startDrag(event.nativeEvent, first, nodes);
      },
      onSelectionDrag: (event, nodes) => {
        const first = nodes[0];
        if (first) geometry.moveDrag(event.nativeEvent, first);
      },
      onSelectionDragStop: geometry.finishGeometry,
      onNodeClick: () => undefined,
      onNodeDoubleClick: (event, node) => {
        if (!owners.input.ownsNativeInput(event.target)) inspect(node.data.view.target);
      },
      onNodeMouseEnter: (_event, node) => enterHover(node.data.view.target),
      onNodeMouseLeave: (_event, node) => leaveHover(node.data.view.target),
      onEdgeClick: () => undefined,
      onEdgeDoubleClick: onEdge(inspect),
      onEdgeMouseEnter: onEdge(enterHover),
      onEdgeMouseLeave: onEdge(leaveHover),
      onPaneClick: () => dispatch({ kind: 'select', targets: [], mode: 'replace' }),
      onPaneMouseLeave: clearHover,
      onNodesChange: selection,
      onEdgesChange: selection,
      onViewportChange: (viewport) =>
        dispatch({
          kind: 'viewport',
          camera: { ...owners.session.getSnapshot().camera, ...viewport },
        }),
      onMoveStart: (event) => {
        if (event) suppressHover('pan');
      },
      onMoveEnd: () => resumeHover('pan'),
      onConnect: connect,
      onConnectStart: () => suppressHover('connect'),
      onConnectEnd: () => resumeHover('connect'),
    },
  };
}
/** The node endpoints a connection joins, read from the admitted index; null unless both ends are nodes. */
function connectionEnds(
  state: SessionState,
  connection: Connection,
): ConnectionEnds | null {
  const source = state.index.targets[connection.source]?.target;
  const target = state.index.targets[connection.target]?.target;
  if (source?.kind !== 'node' || target?.kind !== 'node') return null;
  return {
    source: { section: source.section, node: source.id, member: connection.sourceHandle },
    target: { section: target.section, node: target.id, member: connection.targetHandle },
  };
}
/** True when both targets name the same diagram item; the geometry and keyboard parts compare with it. */
function sameTarget(
  left: Target,
  right: Target,
): boolean {
  return targetAddress(left) === targetAddress(right);
}
/** Opaque structural target identity is shared by adapter comparisons; no generated ID encoding is parsed. */
function targetAddress(target: Target): string {
  return JSON.stringify(target);
}
/** Incoming selection change carries its scoped node/edge ID; no generated ID parsing is needed. */
function selectedTargets(
  owners: InteractionOwners,
  changes: readonly FlowChange[],
): readonly Target[] {
  const state = owners.session.getSnapshot();
  const selected = new Map(state.selection.map((target) => [targetAddress(target), target]));
  changes.forEach((change) => applySelectionChange(selected, state.index.targets, change));
  return [...selected.values()];
}
/** Apply only selection deltas; geometry dimensions/positions never become canonical React Flow JSON. */
function applySelectionChange(
  selected: Map<string, Target>,
  targets: SessionState['index']['targets'],
  change: FlowChange,
): void {
  if (change.type !== 'select') return;
  const target = targets[change.id]?.target;
  if (!target) return;
  setSelected(selected, target, change.selected);
}
/** Immutable domain selection is assembled outside the temporary local Map. */
function setSelected(
  selected: Map<string, Target>,
  target: Target,
  enabled: boolean,
): void {
  if (enabled) {
    selected.set(targetAddress(target), target);
    return;
  }
  selected.delete(targetAddress(target));
}
/** Runs `act` on the diagram item an edge draws; an edge without data is ignored. */
function onEdge(act: (target: Target) => void): (event: unknown, edge: FlowEdge) => void {
  return (_event, edge) => {
    if (edge.data) act(edge.data.view.target);
  };
}
