import { terminalPin } from './nested-terminal-pins.js';
import type { NestedWire, NestedWireSegment } from '../contract/records/nested-wires.js';
import type {
  PrototypeBounds,
  PrototypePoint,
  PrototypePortLocation,
  PrototypeRoad,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';

/** Independent invariant observations, not the router's own feasibility predicates. */
export interface NestedWireInspection {
  readonly corridors: readonly string[];
  readonly nodeBodies: readonly string[];
  readonly boundaries: readonly string[];
  readonly continuity: readonly string[];
}
function containsPoint(
  b: PrototypeBounds,
  p: PrototypePoint,
): boolean {
  return [b.x <= p.x, p.x <= b.x + b.width, b.y <= p.y, p.y <= b.y + b.height].every(Boolean);
}
function covered(
  s: NestedWireSegment,
  roads: ReadonlyMap<string, PrototypeRoad>,
): boolean {
  const road = roads.get(s.corridorId);
  if (road === undefined) return false;
  return [
    orthogonal(s),
    containsPoint(road.bounds, s.from),
    containsPoint(road.bounds, s.to),
  ].every(Boolean);
}
function orthogonal(s: NestedWireSegment): boolean {
  return s.from.x === s.to.x || s.from.y === s.to.y;
}
function openOverlap(
  a: number,
  b: number,
  c: number,
  d: number,
): boolean {
  return Math.max(Math.min(a, b), c) < Math.min(Math.max(a, b), d);
}
function bodyIntersection(
  s: NestedWireSegment,
  b: PrototypeBounds,
): boolean {
  const horizontal = [
    s.from.y > b.y,
    s.from.y < b.y + b.height,
    openOverlap(s.from.x, s.to.x, b.x, b.x + b.width),
  ].every(Boolean);
  const vertical = [
    s.from.x > b.x,
    s.from.x < b.x + b.width,
    openOverlap(s.from.y, s.to.y, b.y, b.y + b.height),
  ].every(Boolean);
  return horizontal || vertical;
}
function within(
  n: number,
  a: number,
  b: number,
): boolean {
  return n >= Math.min(a, b) && n <= Math.max(a, b);
}
const perpendicular = { x: 'y', y: 'x' } as const;
function intersection(
  s: NestedWireSegment,
  axis: 'x' | 'y',
  at: number,
  low: number,
  high: number,
): readonly PrototypePoint[] {
  const other = perpendicular[axis];
  if (s.from[axis] === s.to[axis]) return [];
  if (![within(at, s.from[axis], s.to[axis]), within(s.from[other], low, high)].every(Boolean))
    return [];
  return [{ ...s.from, [axis]: at }];
}
function touches(
  s: NestedWireSegment,
  b: PrototypeBounds,
): readonly PrototypePoint[] {
  return [
    ...[b.x, b.x + b.width].flatMap((x) => intersection(s, 'x', x, b.y, b.y + b.height)),
    ...[b.y, b.y + b.height].flatMap((y) => intersection(s, 'y', y, b.x, b.x + b.width)),
  ];
}
function same(
  a: PrototypePoint,
  b: PrototypePoint,
): boolean {
  return a.x === b.x && a.y === b.y;
}
function gatePosition(
  scene: RoadPrototypeScene,
  wire: NestedWire,
  gate: string,
): PrototypePoint | undefined {
  const port = scene.ports.find((p) => p.portId === gate);
  const lane = scene.wireLanes?.find((l) => l.wireId === wire.id && l.roadId === `drive:${gate}`);
  if (port === undefined || lane === undefined) return undefined;
  const horizontal = port.side === 'left' || port.side === 'right';
  return horizontal
    ? { x: port.point.x, y: port.point.y + lane.offset }
    : { x: port.point.x + lane.offset, y: port.point.y };
}
function permitted(
  point: PrototypePoint,
  scene: RoadPrototypeScene,
  wire: NestedWire,
  sectionId: string,
): boolean {
  return wire.gates.some((gate) => permittedGate(point, scene, wire, gate, sectionId));
}
function permittedGate(
  point: PrototypePoint,
  scene: RoadPrototypeScene,
  wire: NestedWire,
  gate: string,
  sectionId: string,
): boolean {
  const road = scene.roads.find((r) => r.id === `drive:${gate}`);
  const expected = gatePosition(scene, wire, gate);
  if (road === undefined || expected === undefined) return false;
  return [
    road.access?.nodeId === sectionId,
    containsPoint(road.bounds, point),
    same(point, expected),
  ].every(Boolean);
}
function nongate(
  s: NestedWireSegment,
  scene: RoadPrototypeScene,
  wire: NestedWire,
): boolean {
  return scene.sections.some((section) =>
    touches(s, section.bounds).some((p) => !permitted(p, scene, wire, section.id)),
  );
}
function terminals(
  wire: NestedWire,
  scene: RoadPrototypeScene,
): boolean {
  const ends = [
    [wire.sourcePortId, wire.segments[0]?.from],
    [wire.targetPortId, wire.segments.at(-1)?.to],
  ] as const;
  return ends.every(([id, point]) => terminal(id, point, scene, wire.id));
}
function terminal(
  id: string,
  point: PrototypePoint | undefined,
  scene: RoadPrototypeScene,
  wireId: string,
): boolean {
  const port = scene.ports.find((p) => p.portId === id);
  if (port === undefined || point === undefined) return false;
  return same(pinFor(port, scene, wireId), point);
}
function pinFor(
  port: PrototypePortLocation,
  scene: RoadPrototypeScene,
  wireId: string,
): PrototypePoint {
  const lanes = scene.wireLanes?.filter((lane) => lane.roadId === `drive:${port.portId}`) ?? [];
  const lane = lanes.find((entry) => entry.wireId === wireId);
  if (lane === undefined) return port.point;
  const across = ['left', 'right'].includes(port.side) ? 'y' : 'x';
  return terminalPin(port.point, across, lane, lanes.length, port.fixed);
}
function disconnected(w: NestedWire): boolean {
  return w.segments.slice(1).some((s, i) => !same(w.segments[i]?.to ?? s.from, s.from));
}
/** Read-only rectangle checks. All failures are returned as segment identities; retries have no effects. */
export function inspectNestedWires(
  scene: RoadPrototypeScene,
  wires: readonly NestedWire[],
): NestedWireInspection {
  const roads = new Map(scene.roads.map((r) => [r.id, r]));
  const all = wires.flatMap((w) =>
    w.segments.map((segment, i) => ({ id: `${w.id}:${i + 1}`, segment, wire: w })),
  );
  return {
    corridors: all.filter((s) => !covered(s.segment, roads)).map((s) => s.id),
    nodeBodies: all
      .filter((s) => scene.nodes.some((n) => bodyIntersection(s.segment, n.bounds)))
      .map((s) => s.id),
    boundaries: all.filter((s) => nongate(s.segment, scene, s.wire)).map((s) => s.id),
    continuity: wires.filter((w) => disconnected(w) || !terminals(w, scene)).map((w) => w.id),
  };
}
