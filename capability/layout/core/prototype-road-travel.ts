import type {
  PrototypeTravel,
  PrototypeTravelResult,
  PrototypeLane,
  PrototypePoint,
  PrototypeBounds,
} from '../contract/records/road-prototype.js';
import type { RoadPrototypeScene } from '../contract/records/road-scene.js';
import { contains, follows, samePoint, directionVector } from './prototype-road-geometry.js';

const allowed: PrototypeTravelResult = { ok: true, value: null };
function denied(
  code: Extract<PrototypeTravelResult, { ok: false }>['error']['code'],
): PrototypeTravelResult {
  return { ok: false, error: { code } };
}

/** The lateral lane boundary is excluded: travel exactly on the opposing-lane divider is ambiguous. */
function insideLane(
  lane: PrototypeLane,
  point: PrototypePoint,
): boolean {
  const vector = directionVector[lane.direction];
  const across = vector.x === 0 ? 'x' : 'y';
  const breadth = vector.x === 0 ? 'width' : 'height';
  return [
    contains(lane.bounds, point),
    point[across] > lane.bounds[across],
    point[across] < lane.bounds[across] + lane.bounds[breadth],
  ].every(Boolean);
}

function laneTravel(
  scene: RoadPrototypeScene,
  travel: Extract<PrototypeTravel, { kind: 'lane' }>,
): PrototypeTravelResult {
  const lane = scene.lanes.find((item) => item.id === travel.laneId);
  if (lane === undefined) return denied('unknown-lane');
  return inspectLane(lane, travel.from, travel.to);
}

function inspectLane(
  lane: PrototypeLane,
  from: PrototypePoint,
  to: PrototypePoint,
): PrototypeTravelResult {
  if (![from, to].every((point) => insideLane(lane, point))) return denied('outside-lane');
  if (!follows(lane.direction, from, to)) return denied('wrong-direction');
  return allowed;
}

function orthogonal(
  a: PrototypePoint,
  b: PrototypePoint,
): boolean {
  return a.x === b.x || a.y === b.y;
}
function confined(
  points: readonly PrototypePoint[],
  bounds: PrototypeBounds,
): boolean {
  return points.every((point) => contains(bounds, point));
}

/** Convex rectangular junctions contain each orthogonal segment when all its vertices are inside. */
function junctionPath(
  points: readonly PrototypePoint[],
  bounds: PrototypeBounds,
  from: PrototypeLane,
  to: PrototypeLane,
): PrototypeTravelResult {
  if (!confined(points, bounds)) return denied('invalid-junction-path');
  const pairs = points
    .slice(1)
    .map((point, index) => ({ from: points[index] ?? point, to: point }));
  if (!pairs.every((pair) => orthogonal(pair.from, pair.to)))
    return denied('invalid-junction-path');
  return entryExitDirections(points, from, to);
}

/** Direction must agree with the incoming lane on entry and the outgoing lane on departure. */
function entryExitDirections(
  points: readonly PrototypePoint[],
  from: PrototypeLane,
  to: PrototypeLane,
): PrototypeTravelResult {
  const afterEntry = points.find((point) => !samePoint(point, from.exit));
  const beforeExit = points.findLast((point) => !samePoint(point, to.entry));
  if (afterEntry === undefined || beforeExit === undefined) return denied('invalid-junction-path');
  return directionalTurn(from, to, afterEntry, beforeExit);
}

function directionalTurn(
  from: PrototypeLane,
  to: PrototypeLane,
  afterEntry: PrototypePoint,
  beforeExit: PrototypePoint,
): PrototypeTravelResult {
  const valid = [
    follows(from.direction, from.exit, afterEntry),
    follows(to.direction, beforeExit, to.entry),
  ].every(Boolean);
  if (!valid) return denied('wrong-direction');
  return allowed;
}

function connectionTravel(
  scene: RoadPrototypeScene,
  travel: Extract<PrototypeTravel, { kind: 'connection' }>,
): PrototypeTravelResult {
  const link = scene.connections.find((item) => item.id === travel.connectionId);
  if (link === undefined) return denied('unknown-connection');
  const from = scene.lanes.find((item) => item.id === link.fromLaneId);
  const to = scene.lanes.find((item) => item.id === link.toLaneId);
  if (from === undefined || to === undefined) return denied('unknown-lane');
  return connectionPath(scene, link.junctionId, travel.points, from, to);
}

function connectionPath(
  scene: RoadPrototypeScene,
  junctionId: string | null,
  points: readonly PrototypePoint[],
  from: PrototypeLane,
  to: PrototypeLane,
): PrototypeTravelResult {
  if (!matchingEndpoints(points, from.exit, to.entry)) return denied('invalid-junction-path');
  if (junctionId === null) return directPath(points, from.exit);
  return checkedJunction(scene, junctionId, points, from, to);
}
function checkedJunction(
  scene: RoadPrototypeScene,
  junctionId: string,
  points: readonly PrototypePoint[],
  from: PrototypeLane,
  to: PrototypeLane,
): PrototypeTravelResult {
  const junction = scene.junctions.find((item) => item.id === junctionId);
  if (junction === undefined) return denied('unknown-connection');
  return junctionPath(points, junction.bounds, from, to);
}

function matchingEndpoints(
  points: readonly PrototypePoint[],
  start: PrototypePoint,
  end: PrototypePoint,
): boolean {
  const first = points[0],
    last = points.at(-1);
  if (first === undefined || last === undefined) return false;
  return samePoint(first, start) && samePoint(last, end);
}
function directPath(
  points: readonly PrototypePoint[],
  point: PrototypePoint,
): PrototypeTravelResult {
  if (!points.every((item) => samePoint(item, point))) return denied('invalid-junction-path');
  return allowed;
}

/** Inspect one directed movement against the authoritative scene, without mutation or DOM state.
 * A rejection retains the scene; callers correct the named movement and retry. This is not an automatic router.
 */
export function inspectRoadTravel(
  scene: RoadPrototypeScene,
  travel: PrototypeTravel,
): PrototypeTravelResult {
  if (travel.kind === 'lane') return laneTravel(scene, travel);
  return connectionTravel(scene, travel);
}
