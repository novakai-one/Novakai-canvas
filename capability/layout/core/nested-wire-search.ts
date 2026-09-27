import type { PrototypePoint, PrototypeRoad } from '../contract/records/road-prototype.js';
import type { Access, WireRegistry } from './nested-wire-access.js';
import type { OwnedLine } from './nested-wire-corridors.js';
import { clear } from './nested-wire-corridors.js';

/** Each bend costs this much extra travel, so a slightly longer route with fewer bends wins. */
const BEND_COST = 32;
/** Bounded so a fallback route stays readable and the search stays cheap. */
const MAX_BENDS = 6;

interface Step {
  readonly roadId: string;
  readonly point: PrototypePoint;
  readonly cost: number;
  readonly bends: number;
  readonly previous: Step | null;
}
function lane(
  road: PrototypeRoad,
  offset: number,
): number {
  const b = road.bounds;
  return road.axis === 'vertical' ? b.x + b.width / 2 + offset : b.y + b.height / 2 + offset;
}
function meet(
  a: PrototypeRoad,
  b: PrototypeRoad,
  offset: number,
): PrototypePoint {
  const vertical = a.axis === 'vertical' ? a : b,
    horizontal = a.axis === 'vertical' ? b : a;
  return { x: lane(vertical, offset), y: lane(horizontal, offset) };
}
function manhattan(
  a: PrototypePoint,
  b: PrototypePoint,
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function key(step: Step): string {
  return `${step.roadId}@${step.point.x},${step.point.y}`;
}
function next(
  step: Step,
  registry: WireRegistry,
  offset: number,
  ends: ReadonlySet<string>,
): readonly Step[] {
  const road = registry.roads.get(step.roadId);
  if (road === undefined || step.bends >= MAX_BENDS) return [];
  return (registry.crossings.get(step.roadId) ?? []).flatMap((crossing) => {
    const other = registry.roads.get(crossing.roadId);
    if (other === undefined || other.axis === road.axis) return [];
    // Another node's driveway is its private approach, never through-traffic.
    if (other.kind === 'driveway' && !ends.has(other.id)) return [];
    const point = meet(road, other, offset);
    if (!clear({ from: step.point, to: point }, registry.bodies)) return [];
    const cost = step.cost + manhattan(step.point, point) + BEND_COST;
    return [{ roadId: other.id, point, cost, bends: step.bends + 1, previous: step }];
  });
}
function lines(
  step: Step,
  a: Access,
  b: Access,
  q: PrototypePoint,
): readonly OwnedLine[] {
  const path: Step[] = [];
  for (let s: Step | null = step; s !== null; s = s.previous) path.unshift(s);
  const travel = path.slice(1).map((s, i) => ({
    from: path[i]?.point ?? s.point,
    to: s.point,
    roadId: path[i]?.roadId ?? s.roadId,
  }));
  return [
    { from: a.mouth, to: path[0]?.point ?? q, roadId: a.roadId },
    ...travel,
    { from: step.point, to: q, roadId: b.roadId },
    { from: q, to: b.mouth, roadId: b.roadId },
  ];
}
/** Fallback when the pair law finds no trunk: cheapest bounded walk over registered crossings.
 * Deterministic: ties break on road id and point, never on insertion order.
 */
export function searchTrunk(
  a: Access,
  b: Access,
  p: PrototypePoint,
  q: PrototypePoint,
  registry: WireRegistry,
  offset: number,
): readonly OwnedLine[] | null {
  const open: Step[] = [{ roadId: a.roadId, point: p, cost: 0, bends: 0, previous: null }];
  const settled = new Set<string>();
  const ends = new Set([a.roadId, b.roadId]);
  while (open.length > 0) {
    open.sort((x, y) => x.cost - y.cost || key(x).localeCompare(key(y)));
    const step = open.shift() as Step;
    if (settled.has(key(step))) continue;
    settled.add(key(step));
    if (step.roadId === b.roadId && onLane(step.point, q)) return lines(step, a, b, q);
    if (step.roadId === b.roadId && clear({ from: step.point, to: q }, registry.bodies))
      open.push({ ...step, point: q, cost: step.cost + manhattan(step.point, q), previous: step });
    open.push(...next(step, registry, offset, ends).filter((s) => !settled.has(key(s))));
  }
  return null;
}
function onLane(
  a: PrototypePoint,
  b: PrototypePoint,
): boolean {
  return a.x === b.x && a.y === b.y;
}
