import type { VisualWire } from '../../contract/records/input.js';
import type { PlacedNode, RoutedWire } from '../../contract/records/geometry.js';
import { linePath, clear } from './paths.js';
import { contentBoxes } from './obstacles.js';

/** Parent branches use the measured disclosure gutter; shared trunks are native tree notation. */
export function treeBranch(
  wire: VisualWire,
  nodes: readonly PlacedNode[],
): RoutedWire | undefined {
  if (!automaticBranch(wire)) return undefined;
  const parent = rowNode(wire.source.node, nodes);
  if (parent === undefined) return undefined;
  return childBranch(wire, parent, nodes);
}
function rowNode(
  id: string,
  nodes: readonly PlacedNode[],
): PlacedNode | undefined {
  const node = nodes.find((item) => item.id === id);
  return node?.measured.treeRow === undefined ? undefined : node;
}
function childBranch(
  wire: VisualWire,
  parent: PlacedNode,
  nodes: readonly PlacedNode[],
): RoutedWire | undefined {
  const child = rowNode(wire.target.node, nodes);
  if (child === undefined) return undefined;
  if (parent.parent !== child.parent) return undefined;
  return branch(wire, parent, child, nodes);
}
function branch(
  wire: VisualWire,
  parent: PlacedNode,
  child: PlacedNode,
  nodes: readonly PlacedNode[],
): RoutedWire | undefined {
  const start = {
    x: parent.box.x + (parent.measured.treeRow?.gutter ?? 0) / 2,
    y: parent.box.y + parent.box.height,
  };
  const end = { x: child.box.x, y: child.box.y + child.box.height / 2 };
  const points = [start, { x: start.x, y: end.y }, end];
  if (![end.y > start.y, end.x > start.x, clear(points, contentBoxes(nodes))].every(Boolean))
    return undefined;
  return {
    id: wire.id,
    source: { ...wire.source, side: 'bottom', point: start },
    target: { ...wire.target, side: 'left', point: end },
    points,
    path: linePath(points),
    labelBox: { ...start, width: 0, height: 0 },
    measuredLabel: wire.label,
    labelVisible: false,
    appearance: wire.appearance,
    sourceMarker: wire.sourceMarker,
    targetMarker: wire.targetMarker,
    style: wire.style,
  };
}

/** Explicit authored routing stays with the ordinary routing path and its existing inspection. */
function automaticBranch(wire: VisualWire): boolean {
  return [
    wire.kind === 'parent',
    wire.route.route === 'orthogonal',
    !wire.route.locked,
    wire.route.manual === undefined,
    wire.route.sourceSide === 'auto',
    wire.route.targetSide === 'auto',
    wire.source.member === null,
    wire.target.member === null,
    wire.labelVisible === false,
  ].every(Boolean);
}
