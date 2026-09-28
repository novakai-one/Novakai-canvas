/** Public Layout arrange/route/inspect catches structured endpoint faults; Authoring retains the scene and owns correction. */
import type {
  PlacedNode,
  Point,
  ResolvedEndpoint,
  Side,
  Box,
} from '../../contract/records/geometry.js';
import type { VisualWire } from '../../contract/records/input.js';
import { center } from '../geometry/bounds.js';
import { contentBoxes } from './obstacles.js';
import { reject } from '../validation/outcomes.js';
export interface Attachments {
  readonly source: ResolvedEndpoint;
  readonly target: ResolvedEndpoint;
}
/** Resolve the physical visible node; callers never substitute an absent member/object. Layout execute catches faults; Authoring retains the scene and owns correction. */
export function visible(
  id: string,
  nodes: readonly PlacedNode[],
): PlacedNode {
  const found = nodes.find((node): boolean => node.id === id);
  if (!found) return reject('invalid-input', id, 'Wire attachment node is not visible');
  return found;
}
/** Automatic sides follow centre separation, with a stable horizontal tie break. */
function facing(
  source: PlacedNode,
  target: PlacedNode,
): Side {
  const a = center(source.box);
  const b = center(target.box);
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return horizontalSide(a.x, b.x);
  return verticalSide(a.y, b.y);
}
/** Positive horizontal separation exits on the right; ties use the same stable side. */
function horizontalSide(
  from: number,
  to: number,
): Side {
  if (to >= from) return 'right';
  return 'left';
}
/** Positive vertical separation exits below the source. */
function verticalSide(
  from: number,
  to: number,
): Side {
  if (to >= from) return 'bottom';
  return 'top';
}
/** Named sides are hard intent; row members default to a lateral attachment at the measured row. */
function chooseSide(
  requested: VisualWire['route']['sourceSide'],
  member: string | null,
  source: PlacedNode,
  target: PlacedNode,
): Side {
  if (requested !== 'auto') return requested;
  return automaticSide(member, source, target);
}
/** A table/interface member must connect at its row height, not the centre of the object. */
function automaticSide(
  member: string | null,
  source: PlacedNode,
  target: PlacedNode,
): Side {
  if (member === null) return facing(source, target);
  return horizontalSide(center(source.box).x, center(target.box).x);
}
/** Orthogonal attachment points lie on the chosen box edge. */
function edge(
  node: PlacedNode,
  side: Side,
): Point {
  const box = node.box;
  const middle = center(box);
  const points = {
    top: { x: middle.x, y: box.y },
    bottom: { x: middle.x, y: box.y + box.height },
    left: { x: box.x, y: middle.y },
    right: { x: box.x + box.width, y: middle.y },
  };
  return points[side];
}
/** Measured member coordinates are node-local and cannot be approximated by row indices. */
function attachment(
  node: PlacedNode,
  member: string | null,
  side: Side,
): Point {
  if (member === null) return edge(node, side);
  return memberPoint(node, member, side);
}
/** Vertical member-side requests have no row-edge interpretation and are rejected with the member identity. */
function memberPoint(
  node: PlacedNode,
  member: string,
  side: Side,
): Point {
  if (side === 'top' || side === 'bottom')
    return reject('constraint-conflict', member, 'Member ports require a left or right side', [
      node.id,
      member,
    ]);
  const anchor = node.measured.content.anchors.find((item): boolean => item.member === member);
  if (!anchor)
    return reject('invalid-input', member, 'Measured member anchor is missing', [node.id, member]);
  return { ...edge(node, side), y: node.box.y + anchor.y };
}
/** The semantically selected endpoint keeps a stable lateral approach, independent of label visibility. */
export function preferredSide(
  wire: VisualWire,
  endpoint: 'source' | 'target',
): Side | 'auto' {
  const requested = endpoint === 'source' ? wire.route.sourceSide : wire.route.targetSide;
  if (requested !== 'auto' || wire.annotationEndpoint !== endpoint) return requested;
  return endpoint === 'source' ? 'right' : 'left';
}
/** Resolve both ends before invoking native routing; automatic self-loops leave on different sides.
 * Whole-node ends that meet one side of a node each get their own point along it. Layout execute catches faults; Authoring retains the scene and owns correction. */
export function endpoints(
  wire: VisualWire,
  nodes: readonly PlacedNode[],
  wires: readonly VisualWire[] = [wire],
): Attachments {
  const own = sided(wire, nodes);
  if (wires.length < 2) return own;
  return {
    source: spread(own.source, wire.id, 'source', wires, nodes),
    target: spread(own.target, wire.id, 'target', wires, nodes),
  };
}
/** Closest two connection points on one side may sit; tighter than this, the router has no lanes between them. */
const MIN_SPACING = 10;
interface SharedEnd {
  readonly id: string;
  readonly end: 'source' | 'target';
  readonly far: Point;
  /** Same-direction wires to the same far node share a point; the parallel-wire offsets keep them apart. */
  readonly bundle: string;
}
/** Order the ends on one side by where their other end sits, then space them evenly along the side. */
function spread(
  endpoint: ResolvedEndpoint,
  id: string,
  end: 'source' | 'target',
  wires: readonly VisualWire[],
  nodes: readonly PlacedNode[],
): ResolvedEndpoint {
  if (endpoint.member !== null) return endpoint;
  const sharing = ordered(endpoint, wires, nodes);
  const bundles = [...new Set(sharing.map((item) => item.bundle))];
  const own = sharing.find((item) => item.id === id && item.end === end);
  return place(endpoint, bundles.length, bundles.indexOf(own?.bundle ?? ''), nodes);
}
function ordered(
  endpoint: ResolvedEndpoint,
  wires: readonly VisualWire[],
  nodes: readonly PlacedNode[],
): readonly SharedEnd[] {
  const across = axis(endpoint.side);
  return wires
    .flatMap((other) => sharedEnds(other, endpoint, nodes))
    .sort((a, b) => a.far[across] - b.far[across] || incomingFirst(a, b));
}
/** Equal far ends: incoming wires take the earlier point. */
function incomingFirst(
  a: SharedEnd,
  b: SharedEnd,
): number {
  if (a.end === b.end) return 0;
  return a.end === 'target' ? -1 : 1;
}
function axis(side: Side): 'x' | 'y' {
  return side === 'left' || side === 'right' ? 'y' : 'x';
}
function place(
  endpoint: ResolvedEndpoint,
  count: number,
  index: number,
  nodes: readonly PlacedNode[],
): ResolvedEndpoint {
  const across = axis(endpoint.side);
  const side = span(visible(endpoint.node, nodes).box, across);
  if (count < 2) return endpoint;
  // Too many wires for this side: neighbours pair up on the points that fit, never all on one.
  const slots = Math.min(count, Math.floor(side.length / MIN_SPACING) - 1);
  if (slots < 2) return endpoint;
  const slot = Math.round((index * (slots - 1)) / (count - 1));
  const offset = Math.round(side.start + (side.length / (slots + 1)) * (slot + 1));
  return { ...endpoint, point: { ...endpoint.point, [across]: offset } };
}
function span(
  box: Box,
  across: 'x' | 'y',
): { readonly start: number; readonly length: number } {
  return across === 'y'
    ? { start: box.y, length: box.height }
    : { start: box.x, length: box.width };
}
function sharedEnds(
  wire: VisualWire,
  endpoint: ResolvedEndpoint,
  nodes: readonly PlacedNode[],
): readonly SharedEnd[] {
  const ends = sided(wire, nodes);
  return (['source', 'target'] as const)
    .filter((end) => meets(ends[end], endpoint))
    .map((end) => ({
      id: wire.id,
      end,
      far: center(visible(farNode(wire, end), nodes).box),
      bundle: `${end}:${farNode(wire, end)}`,
    }));
}
/** Whole-node ends on the same node side compete for that side. */
function meets(
  candidate: ResolvedEndpoint,
  endpoint: ResolvedEndpoint,
): boolean {
  return (
    candidate.node === endpoint.node &&
    candidate.member === null &&
    candidate.side === endpoint.side
  );
}
function farNode(
  wire: VisualWire,
  end: 'source' | 'target',
): string {
  return end === 'source' ? wire.target.node : wire.source.node;
}
function sided(
  wire: VisualWire,
  nodes: readonly PlacedNode[],
): Attachments {
  const source = visible(wire.source.node, nodes);
  const target = visible(wire.target.node, nodes);
  const sourceSide = chooseSide(preferredSide(wire, 'source'), wire.source.member, source, target);
  const targetSide = selfTarget(wire, source, target);
  return {
    source: {
      ...wire.source,
      side: sourceSide,
      point: attachment(source, wire.source.member, sourceSide),
    },
    target: {
      ...wire.target,
      side: targetSide,
      point: attachment(target, wire.target.member, targetSide),
    },
  };
}
/** A whole-object self-loop's automatic target uses its bottom; explicit sides remain unchanged. */
function selfTarget(
  wire: VisualWire,
  source: PlacedNode,
  target: PlacedNode,
): Side {
  if (
    wire.source.node === wire.target.node &&
    preferredSide(wire, 'target') === 'auto' &&
    wire.target.member === null
  )
    return 'bottom';
  return chooseSide(preferredSide(wire, 'target'), wire.target.member, target, source);
}
/** Exact outward points define marker stubs; the native adapter routes their free corridor without a directed ConnEnd constructor. Layout execute catches faults; Authoring retains the scene and owns correction. */
export function approach(
  endpoint: ResolvedEndpoint,
  distance: number,
): Point {
  const vectors = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  const vector = vectors[endpoint.side];
  return { x: endpoint.point.x + vector.x * distance, y: endpoint.point.y + vector.y * distance };
}

/** The first fixed obstacle on the outward ray limits optional routing clearance, never marker length. Layout execute catches faults; Authoring retains the scene and owns correction. */
export function departureSpace(
  endpoint: ResolvedEndpoint,
  nodes: readonly PlacedNode[],
): number {
  const boxes = contentBoxes(nodes.filter((node): boolean => node.id !== endpoint.node));
  return Math.min(Infinity, ...boxes.map((box): number => obstacleDistance(endpoint, box)));
}
/** Normalize every named side to a positive ray; container headers use the same protected content geometry. */
function obstacleDistance(
  endpoint: ResolvedEndpoint,
  box: Box,
): number {
  const point = endpoint.point;
  const rays = {
    right: {
      position: point.x,
      near: box.x,
      far: box.x + box.width,
      across: point.y,
      min: box.y,
      max: box.y + box.height,
    },
    left: {
      position: -point.x,
      near: -box.x - box.width,
      far: -box.x,
      across: point.y,
      min: box.y,
      max: box.y + box.height,
    },
    bottom: {
      position: point.y,
      near: box.y,
      far: box.y + box.height,
      across: point.x,
      min: box.x,
      max: box.x + box.width,
    },
    top: {
      position: -point.y,
      near: -box.y - box.height,
      far: -box.y,
      across: point.x,
      min: box.x,
      max: box.x + box.width,
    },
  };
  return distanceAlongRay(rays[endpoint.side]);
}
/** Obstacles behind the endpoint or outside its attachment axis do not constrain departure. */
function distanceAlongRay(ray: {
  readonly position: number;
  readonly near: number;
  readonly far: number;
  readonly across: number;
  readonly min: number;
  readonly max: number;
}): number {
  if (ray.across <= ray.min || ray.across >= ray.max || ray.far <= ray.position) return Infinity;
  return Math.max(0, ray.near - ray.position);
}
