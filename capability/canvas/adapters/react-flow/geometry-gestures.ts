/*
 * Drag and resize gestures on the React Flow canvas: begin, live preview, release and cancel.
 * Not pure: it reads and writes the session's pointer and drag preview. The host drains effects,
 * retains drafts and owns recovery; failures reach it through the context's `dispatch`.
 */
import type { FlowNode } from '../../contract/react-types.js';
import type { GeometryContext, GeometryGestures } from '../../contract/interaction-parts.js';
import type { Target } from '../../contract/records/selection.js';
import type { Box, Point } from '../../contract/records/camera.js';
import type { PointerGesture } from '../../contract/ports/session.js';
import type { SessionState } from '../../contract/records/state.js';
import type { GestureId } from '../../contract/brands.js';

/**
 * Builds the drag and resize handlers. A drag of plain nodes publishes only a live offset; tree
 * and sequence sections take the full per-frame path. Release submits one coalesced intent;
 * callbacks for a gesture that is no longer active only clear the pointer.
 */
export function createGeometryGestures(context: GeometryContext): GeometryGestures {
  const { owners, dispatch, sameTarget, suppressHover, resumeHover } = context;
  /** Keys that move with the current drag; null means the full per-frame path. */
  let moved: LiveMove | null = null;
  /** Release applies the last live offset once, then the usual finish. */
  function flushPreview(active: PointerGesture): void {
    const preview = owners.session.readPreview();
    if (preview?.id !== active.id) return;
    dispatch({ kind: 'move', id: active.id, delta: preview.delta });
  }
  /** Initial geometry comes from the admitted view, not a possibly already-moved callback position. */
  function startDrag(
    event: MouseEvent | TouchEvent,
    node: FlowNode,
    nodes: readonly FlowNode[],
  ): void {
    if (owners.input.ownsNativeInput(event.target)) return;
    const issued = owners.nextGestureId();
    if (!issued.ok) return;
    const id = issued.value;
    suppressHover('drag');
    owners.session.writePointer({
      id,
      target: node.data.view.target,
      start: node.data.view.position,
    });
    const targets = nodes.map((item) => item.data.view.target);
    dispatch({ kind: 'begin', id, gesture: 'move', targets });
    moved = liveMove(owners.session.getSnapshot(), id, nodes);
  }
  /** Frame updates carry a total delta from drag start; reducers retain original geometry for recovery. */
  function moveDrag(
    _event: MouseEvent | TouchEvent,
    node: FlowNode,
  ): void {
    const active = activePointer();
    if (active === null) return;
    const delta = { x: node.position.x - active.start.x, y: node.position.y - active.start.y };
    livePreview(active.id, delta);
  }
  /** Previewable drags publish only the offset; others take the full per-frame path. */
  function livePreview(
    id: GestureId,
    delta: Point,
  ): void {
    if (moved?.id === id) {
      owners.session.writePreview({ id, delta, moved: moved.keys });
      return;
    }
    dispatch({ kind: 'move', id, delta });
  }
  /** Release submits exactly one coalesced intent; late duplicate stops are harmless. */
  function finishGeometry(): void {
    const active = activePointer();
    if (active === null) {
      abandonPointer();
      return;
    }
    flushPreview(active);
    dispatch({ kind: 'finish', id: active.id });
    owners.session.writePointer(null);
    resumeHover('drag');
  }
  /** Pointer cancellation never emits an edit intent; only the active gesture is cleared. */
  function cancelGeometry(): void {
    const active = activePointer();
    if (active === null) {
      abandonPointer();
      return;
    }
    dispatch({ kind: 'cancel', id: active.id });
    owners.session.writePointer(null);
    resumeHover('drag');
  }
  /** Resize controls operate on one target and retain the same gesture identity through their lifecycle. */
  function beginResize(target: Target): void {
    const issued = owners.nextGestureId();
    if (!issued.ok) return;
    const id = issued.value;
    owners.session.writePointer({ id, target, start: { x: 0, y: 0 } });
    dispatch({ kind: 'begin', id, gesture: 'resize', targets: [target] });
  }
  /** React Flow resize coordinates are parent-relative; add the displayed parent's world origin once. */
  function resize(
    target: Target,
    box: Box,
  ): void {
    const active = activePointer();
    if (active === null) return;
    const state = owners.session.getSnapshot();
    const info = Object.values(state.index.targets).find((item) => sameTarget(item.target, target));
    if (!info) return;
    const parent = state.index.targets[info.parentKey ?? ''];
    const origin = parent?.box ?? { x: 0, y: 0 };
    dispatch({
      kind: 'resize',
      id: active.id,
      box: { x: box.x + origin.x, y: box.y + origin.y, width: box.width, height: box.height },
    });
  }
  /** The drafted pointer gesture; null once Escape, a foreign update or a newer gesture replaced it. */
  function activePointer(): PointerGesture | null {
    const active = owners.session.readPointer();
    if (!stillActive(owners, active)) return null;
    return active;
  }
  /** A stale gesture only clears the pointer, the live offset and the drag's hover pause. */
  function abandonPointer(): void {
    owners.session.writePointer(null);
    owners.session.writePreview(null);
    resumeHover('drag');
  }
  return { startDrag, moveDrag, finishGeometry, cancelGeometry, beginResize, resize };
}

/** Ignore delayed drag callbacks after Escape, a foreign update or gesture replacement. */
function stillActive(
  owners: GeometryContext['owners'],
  active: PointerGesture | null,
): active is PointerGesture {
  if (active === null) return false;
  return owners.session.getSnapshot().draft?.id === active.id;
}
/** A previewable drag: its gesture and the index keys that move with it. */
interface LiveMove {
  readonly id: GestureId;
  readonly keys: ReadonlySet<string>;
}
/** The drag's live move when every dragged node is previewable; null means the full per-frame path. */
function liveMove(
  state: SessionState,
  id: GestureId,
  nodes: readonly FlowNode[],
): LiveMove | null {
  const targets = nodes.map((item) => item.data.view.target);
  if (!previewable(state, targets)) return null;
  const keys = movedKeys(
    state,
    nodes.map((item) => item.id),
  );
  return { id, keys };
}
/** Sequence and tree sections draw from node positions outside the node itself; they keep the full per-frame path. */
function previewable(
  state: SessionState,
  targets: readonly Target[],
): boolean {
  return targets.every((target) => {
    if (target.kind !== 'node') return false;
    const section = state.scene.sections.find((item) => item.id === target.section);
    return section?.tree === undefined && section?.sequence.lifelines.length === 0;
  });
}
/** Dragged targets plus every descendant; children are separate React Flow nodes and must move too. */
function movedKeys(
  state: SessionState,
  dragged: readonly string[],
): ReadonlySet<string> {
  const roots = new Set(dragged);
  return new Set(Object.keys(state.index.targets).filter((key) => under(state, key, roots)));
}
/** True when the key or any of its ancestors is dragged. */
function under(
  state: SessionState,
  key: string | null,
  dragged: ReadonlySet<string>,
): boolean {
  if (key === null) return false;
  if (dragged.has(key)) return true;
  return under(state, state.index.targets[key]?.parentKey ?? null, dragged);
}
