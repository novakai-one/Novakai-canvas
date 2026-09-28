import { foldedTreeAncestor } from './tree.js';
import type { SessionState } from '../../contract/records/state.js';
import type { ViewWire } from '../../contract/records/view.js';
import type { PlacedSection, RoutedWire } from '../../contract/records/scene.js';
import type { Point } from '../../contract/records/camera.js';
import { targetInfo, targetKey } from './address.js';
import { previewBox, previewOrigin, hiddenByReading } from './preview.js';
import type { FocusProjection } from '../../contract/records/focus.js';
import { emphasisFor } from './focus.js';
/** Endpoint deltas exclude section translation, because that is applied once by the wire's origin. */
function nodeDelta(
  state: SessionState,
  section: PlacedSection,
  id: string,
  sectionDelta: Point,
): Point {
  const info = targetInfo(state.index, { kind: 'node', section: section.id, id });
  const preview = previewBox(state, info);
  return { x: preview.x - info.box.x - sectionDelta.x, y: preview.y - info.box.y - sectionDelta.y };
}
/** Temporary endpoint stretch is explicitly preview-only; Layout must produce the next feasible route. */
function endpointPoints(
  points: readonly Point[],
  source: Point,
  target: Point,
): readonly Point[] {
  const translated = points.map((point) => ({ ...point }));
  const first = points[0];
  const last = points.at(-1);
  if (first) translated[0] = { x: first.x + source.x, y: first.y + source.y };
  if (last) translated[translated.length - 1] = { x: last.x + target.x, y: last.y + target.y };
  return translated;
}
/** When both endpoints move together, translate the complete route and label, preserving their shape. */
function movedWire(
  wire: RoutedWire,
  source: Point,
  target: Point,
): RoutedWire {
  const same = source.x === target.x && source.y === target.y;
  if (!same) return { ...wire, points: endpointPoints(wire.points, source, target) };
  return {
    ...wire,
    points: wire.points.map((point) => ({ x: point.x + source.x, y: point.y + source.y })),
    labelBox: { ...wire.labelBox, x: wire.labelBox.x + source.x, y: wire.labelBox.y + source.y },
  };
}
/** Active route handles supply a draft path; other wires preserve their admitted route unless an endpoint moves. */
function projectedWire(
  state: SessionState,
  wire: RoutedWire,
  key: string,
  section: string,
  source: Point,
  target: Point,
): RoutedWire {
  if (isRouteTarget(state, key)) return { ...wire, points: routePoints(state, wire.points) };
  const preview = releasedWire(state, wire, section);
  if (preview !== undefined) return preview;
  return movingWire(wire, source, target);
}
/** Pointer-only stretching remains distinct from a fully inspected released route. */
function movingWire(
  wire: RoutedWire,
  source: Point,
  target: Point,
): RoutedWire {
  const unchanged = [source.x, source.y, target.x, target.y].every((delta) => delta === 0);
  return unchanged ? wire : movedWire(wire, source, target);
}
function releasedWire(
  state: SessionState,
  wire: RoutedWire,
  section: string,
): RoutedWire | undefined {
  if (state.draft !== null) return undefined;
  const preview = state.routePreview?.wires.find(
    (item) => item.section === section && item.id === wire.id,
  );
  if (preview === undefined) return undefined;
  return {
    ...wire,
    source: preview.source,
    target: preview.target,
    points: preview.points,
    labelBox: preview.labelBox,
  };
}
/** Wire view reuses labels/markers and marks endpoint-stretched paths as previews, never feasible committed geometry. */
export function viewWire(
  state: SessionState,
  wire: RoutedWire,
  section: PlacedSection,
  focus: FocusProjection,
): ViewWire {
  const target = { kind: 'wire' as const, section: section.id, id: wire.id };
  const key = targetKey(target);
  const sectionInfo = targetInfo(state.index, { kind: 'section', id: section.id });
  const sectionBox = previewBox(state, sectionInfo);
  const delta = { x: sectionBox.x - sectionInfo.box.x, y: sectionBox.y - sectionInfo.box.y };
  const sourceInfo = targetInfo(state.index, {
    kind: 'node',
    section: section.id,
    id: wire.source.node,
  });
  const targetData = targetInfo(state.index, {
    kind: 'node',
    section: section.id,
    id: wire.target.node,
  });
  const projected = projectedWire(
    state,
    wire,
    key,
    section.id,
    nodeDelta(state, section, wire.source.node, delta),
    nodeDelta(state, section, wire.target.node, delta),
  );
  return {
    id: key,
    target,
    sourceId: sourceInfo.key,
    targetId: targetData.key,
    wire: projected,
    drawn: admitted(projected, wire, section),
    origin: previewOrigin(state, section.id) ?? {
      x: section.origin.x + delta.x,
      y: section.origin.y + delta.y,
    },
    selected: state.selection.some((value) => targetKey(value) === key),
    hovered: state.hover !== null && targetKey(state.hover) === key,
    emphasis: emphasisFor(focus, key),
    showLabel: focus.source === 'selection' && focus.primary.has(key),
    hidden:
      hiddenByReading(state, sourceInfo) ||
      hiddenByReading(state, targetData) ||
      foldedTreeAncestor(state, section, wire.source.node) ||
      foldedTreeAncestor(state, section, wire.target.node),
    draft: projected !== wire,
  };
}

/** Narrow active route identity before choosing its section-local preview. */
function isRouteTarget(
  state: SessionState,
  key: string,
): boolean {
  if (state.draft?.kind !== 'route') return false;
  return targetKey(state.draft.target) === key;
}
/** Safe fallback is the admitted path; narrowing never casts another gesture into a route. */
function routePoints(
  state: SessionState,
  fallback: readonly Point[],
): readonly Point[] {
  if (state.draft?.kind !== 'route') return fallback;
  return state.draft.current.points;
}

/** Only an admitted route is redrawn to the outline; a moving preview keeps its stretched ends. */
function admitted(
  projected: RoutedWire,
  wire: RoutedWire,
  section: PlacedSection,
): RoutedWire {
  return projected === wire ? outlined(wire, section) : projected;
}
/** Wires meet a diamond's box edge; the drawn line continues in to its slanted outline. */
function outlined(
  wire: RoutedWire,
  section: PlacedSection,
): RoutedWire {
  const start = outlinePoint(wire.source, section);
  const end = outlinePoint(wire.target, section);
  return start === undefined && end === undefined
    ? wire
    : {
        ...wire,
        points: [...present(start), ...wire.points, ...present(end)],
        path: `${pathStart(start, wire.path)}${pathEnd(end)}`,
      };
}
function present(point: Point | undefined): readonly Point[] {
  return point === undefined ? [] : [point];
}
function pathStart(
  start: Point | undefined,
  path: string,
): string {
  return start === undefined ? path : `M${start.x} ${start.y} L${path.slice(1)}`;
}
function pathEnd(end: Point | undefined): string {
  return end === undefined ? '' : ` L${end.x} ${end.y}`;
}
function outlinePoint(
  end: RoutedWire['source'],
  section: PlacedSection,
): Point | undefined {
  const node = section.nodes.find((item) => item.id === end.node);
  return node !== undefined && slanted(node) ? onOutline(node.box, end) : undefined;
}
function slanted(node: PlacedSection['nodes'][number]): boolean {
  return node.measured.shape === 'diamond' && node.measured.frame === 'auto';
}
function onOutline(
  box: PlacedSection['nodes'][number]['box'],
  end: RoutedWire['source'],
): Point | undefined {
  const point = inward[end.side](box, end.point);
  return point.x === end.point.x && point.y === end.point.y ? undefined : point;
}
type Inward = (box: PlacedSection['nodes'][number]['box'], point: Point) => Point;
/** Move a box-edge point in to the diamond outline. */
const inward: Readonly<Record<RoutedWire['source']['side'], Inward>> = {
  left: (box, point) => ({ x: point.x + sideInset(box, point), y: point.y }),
  right: (box, point) => ({ x: point.x - sideInset(box, point), y: point.y }),
  top: (box, point) => ({ x: point.x, y: point.y + topInset(box, point) }),
  bottom: (box, point) => ({ x: point.x, y: point.y - topInset(box, point) }),
};
/** Left/right: how far in the outline sits at this height. */
function sideInset(
  box: PlacedSection['nodes'][number]['box'],
  point: Point,
): number {
  return (box.width / 2) * (Math.abs(point.y - (box.y + box.height / 2)) / (box.height / 2));
}
/** Top/bottom: how far in the outline sits at this x. */
function topInset(
  box: PlacedSection['nodes'][number]['box'],
  point: Point,
): number {
  return (box.height / 2) * (Math.abs(point.x - (box.x + box.width / 2)) / (box.width / 2));
}
