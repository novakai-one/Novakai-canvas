import type { NestedWire, NestedWireSegment } from '../contract/records/nested-wires.js';
import type {
  PrototypeJunction,
  PrototypePoint,
  PrototypeRoad,
  PrototypePortLocation,
} from '../contract/records/road-prototype.js';
import type { AssignedTravel } from './nested-travel.js';
import { needsMedianBridge, terminalFanDistance } from './nested-wire-lanes.js';
import { axes, contains, samePoint } from './prototype-road-geometry.js';
import { reject } from './nested-support-graph.js';
import { validateSupportedProjection } from './nested-projection-support.js';
import { terminalPin, roadLanePitch } from './nested-terminal-pins.js';

interface Connection {
  readonly from: PrototypePoint;
  readonly to: PrototypePoint;
  readonly roadId: string;
  readonly via?: readonly PrototypePoint[];
}
type ConnectorLine = (
  from: PrototypePoint,
  to: PrototypePoint,
  preferredOwner: string,
) => readonly NestedWireSegment[];

type JunctionsByRoad = ReadonlyMap<string, readonly PrototypeJunction[]>;

/** Junction membership admits adjacent owners; containment only checks admitted candidates.
 * Streets take precedence. Missing candidates preserve the original inspection witness.
 */
function connectorLine(
  from: PrototypePoint,
  to: PrototypePoint,
  preferredOwner: string,
  adjacent: readonly string[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  junctions: JunctionsByRoad,
): readonly NestedWireSegment[] {
  const registered = (junctions.get(preferredOwner) ?? [])
    .filter((junction) => [from, to].every((p) => contains(junction.bounds, p)))
    .flatMap((junction) => junction.roadIds);
  const candidates = registered.filter((id) => [preferredOwner, ...adjacent].includes(id));
  const owners = [preferredOwner, ...candidates].filter(
    (id) => candidates.includes(id) && containsConnector(roads.get(id), from, to),
  );
  const owner = owners.find((id) => roads.get(id)?.kind === 'street') ?? owners[0];
  return line(from, to, owner ?? preferredOwner);
}
function junctionIndex(junctions: readonly PrototypeJunction[]): JunctionsByRoad {
  const byRoad = new Map<string, readonly PrototypeJunction[]>();
  junctions.forEach((junction) =>
    junction.roadIds.forEach((id) => byRoad.set(id, [...(byRoad.get(id) ?? []), junction])),
  );
  return byRoad;
}
function containsConnector(
  road: PrototypeRoad | undefined,
  from: PrototypePoint,
  to: PrototypePoint,
): boolean {
  if (road === undefined) return false;
  return [from, to].every((p) => contains(road.bounds, p));
}
function line(
  from: PrototypePoint,
  to: PrototypePoint,
  corridorId: string,
  laneId?: string,
): readonly NestedWireSegment[] {
  if (samePoint(from, to)) return [];
  return [{ from, to, corridorId, ...laneProperty(laneId) }];
}
function laneProperty(laneId: string | undefined) {
  return laneId === undefined ? {} : { laneId };
}
function point(
  t: AssignedTravel,
  along: number,
): PrototypePoint {
  return t.road.axis === 'horizontal' ? { x: along, y: t.at } : { x: t.at, y: along };
}
function corner(
  t: AssignedTravel,
  next: AssignedTravel,
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
): Connection {
  if (turnDirection(t, next) < 0) return leftConnection(t, next, roads, turns);
  const p = t.road.axis === 'horizontal' ? { x: next.at, y: t.at } : { x: t.at, y: next.at };
  return { from: p, to: p, roadId: next.road.id };
}
function center(road: PrototypeRoad): number {
  const a = axes[road.axis];
  return road.bounds[a.across] + road.bounds[a.breadth] / 2;
}
function turnKey(
  t: AssignedTravel,
  next: AssignedTravel,
  direction: number,
): string {
  return `${t.road.axis}/${center(t.road)}/${center(next.road)}/${direction}`;
}
/** One physical junction uses nested channels on every arm when either opposing pair needs them. */
function nestedJunction(
  t: AssignedTravel,
  next: AssignedTravel,
  turns: ReadonlySet<string>,
): boolean {
  const across = (direction: number) =>
    `${next.road.axis}/${center(next.road)}/${center(t.road)}/${direction}`;
  return (
    turns.has(turnKey(t, next, -t.direction)) ||
    [1, -1].every((direction) => turns.has(across(direction)))
  );
}
/** Separate coincident corner legs by a quarter pitch inside the junction. */
function leftConnection(
  t: AssignedTravel,
  next: AssignedTravel,
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
): Connection {
  if (nestedJunction(t, next, turns)) return leftCorner(t, next, roads);
  const road = roads.get(next.road.id) ?? next.road;
  const a = axes[t.road.axis];
  const from = point(t, edge(road, t, 0.5));
  const to = point(next, t.at + (next.direction * roadLanePitch(t.road)) / 4);
  return {
    from,
    to,
    roadId: road.kind === 'driveway' ? t.road.id : road.id,
    via: [{ ...from, [a.across]: to[a.across] }],
  };
}
/** Opposing left turns use nested outer channels. Entry/exit depths differ
 * by half a pitch so adjacent approach arms cannot share a turn segment.
 */
function leftCorner(
  t: AssignedTravel,
  next: AssignedTravel,
  roads: ReadonlyMap<string, PrototypeRoad>,
): Connection {
  const incoming = roads.get(t.road.id) ?? t.road,
    outgoing = roads.get(next.road.id) ?? next.road;
  const from = point(t, edge(outgoing, t, t.lane.index + 0.25));
  const to = point(
    next,
    edge(incoming, { ...next, direction: next.direction === 1 ? -1 : 1 }, next.lane.index + 0.75),
  );
  const a = axes[t.road.axis];
  return {
    from,
    to,
    roadId: outgoing.kind === 'driveway' ? incoming.id : outgoing.id,
    via: [{ ...from, [a.across]: to[a.across] }],
  };
}
function edge(
  road: PrototypeRoad,
  travel: Pick<AssignedTravel, 'road' | 'direction'>,
  rank: number,
): number {
  const a = axes[travel.road.axis],
    b = road.bounds;
  return (
    b[a.along] +
    b[a.length] / 2 -
    travel.direction * (b[a.length] / 2 - rank * roadLanePitch(travel.road))
  );
}
function crossing(
  t: AssignedTravel,
  next: AssignedTravel,
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
): PrototypeRoad | undefined {
  return wire.segments
    .slice(t.last + 1, next.first)
    .map((s) => roads.get(s.corridorId))
    .find((r) => r?.axis !== t.road.axis);
}
function bridge(
  t: AssignedTravel,
  next: AssignedTravel,
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
): Connection {
  const road = crossing(t, next, wire, roads);
  if (road === undefined) return gateJoin(t, next, wire);
  return streetBridge(t, next, road);
}
function streetBridge(
  t: AssignedTravel,
  next: AssignedTravel,
  road: PrototypeRoad,
): Connection {
  if (needsMedianBridge(t, next)) return medianBridge(t, next, road);
  if (t.at === next.at) {
    const a = axes[t.road.axis];
    const p = point(t, road.bounds[a.along] + road.bounds[a.length] / 2);
    return { from: p, to: p, roadId: road.id };
  }
  const at = transferCoordinates(t, road)[0]!;
  return { from: point(t, at), to: point(next, at), roadId: road.id };
}
/** No transfer is invented during projection: capacity already includes its measured slot. */
function transferCoordinates(
  t: AssignedTravel,
  road: PrototypeRoad,
): readonly number[] {
  if (t.transfer?.roadId !== road.id)
    return reject('unsupported-support', [t.wireId, road.id, 'missing-transfer-capacity']);
  return t.transfer.coordinates;
}
function medianBridge(
  t: AssignedTravel,
  next: AssignedTravel,
  road: PrototypeRoad,
): Connection {
  const a = axes[t.road.axis];
  const coordinates = transferCoordinates(t, road).toSorted((a, b) => t.direction * (a - b));
  const near = coordinates[0]!,
    far = coordinates[1]!;
  const displacement = next.at - t.at;
  const median =
    t.at +
    Math.sign(displacement) * Math.min(Math.abs(displacement) / 2, roadLanePitch(t.road) / 4);
  return {
    from: point(t, near),
    to: point(next, far),
    roadId: road.id,
    via: [point(t, near), point(t, far)].map((p) => ({ ...p, [a.across]: median })),
  };
}
function gateJoin(
  t: AssignedTravel,
  next: AssignedTravel,
  wire: NestedWire,
): Connection {
  const at = wire.segments[t.last]?.to[axes[t.road.axis].along] ?? 0;
  return { from: point(t, at), to: point(next, at), roadId: t.road.id };
}
function connect(
  t: AssignedTravel,
  next: AssignedTravel,
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
): Connection {
  if (t.road.axis !== next.road.axis) return corner(t, next, roads, turns);
  return bridge(t, next, wire, roads);
}
function fan(
  t: AssignedTravel,
  endpoint: PrototypePoint,
  sign: number,
) {
  const a = axes[t.road.axis];
  const pin = terminalPin(endpoint, a.across, t.lane, t.count, t.road.access?.fixed);
  const distance = terminalFanDistance(t);
  const along = endpoint[a.along] + sign * t.direction * distance;
  return { pin, bend: { ...pin, [a.along]: along }, end: point(t, along) };
}
function clipped(
  p: PrototypePoint,
  road: PrototypeRoad,
): PrototypePoint {
  const a = axes[road.axis],
    b = road.bounds;
  return { ...p, [a.along]: Math.max(b[a.along], Math.min(b[a.along] + b[a.length], p[a.along])) };
}
function owned(
  t: AssignedTravel,
  road: PrototypeRoad,
  from: PrototypePoint,
  to: PrototypePoint,
  before: string,
  after: string,
  connector: ConnectorLine,
): readonly NestedWireSegment[] {
  const p = clipped(from, road),
    q = clipped(to, road);
  return [
    ...connector(from, p, before),
    ...line(p, q, road.id, t.lane.id),
    ...connector(q, to, after),
  ];
}
function piece(
  t: AssignedTravel,
  index: number,
  joins: readonly Connection[],
  travels: readonly AssignedTravel[],
  ends: readonly PrototypePoint[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  junctions: JunctionsByRoad,
): readonly NestedWireSegment[] {
  const previous = joins[index - 1],
    next = joins[index];
  const start = previous?.to ?? ends[0],
    end = next?.from ?? ends[1];
  const road = roads.get(t.road.id);
  if (road === undefined || start === undefined || end === undefined) return [];
  const before = previous?.roadId ?? t.road.id;
  const after = nextOwner(t, travels[index + 1], next);
  const adjacent = travels.slice(Math.max(0, index - 1), index + 2).map((travel) => travel.road.id);
  const connector: ConnectorLine = (from, to, owner) =>
    connectorLine(from, to, owner, adjacent, roads, junctions);
  return [
    ...owned(t, road, start, end, beforeOwner(t, travels[index - 1], before), after, connector),
    ...connectionLine(next, connector),
  ];
}
function beforeOwner(
  t: AssignedTravel,
  previous: AssignedTravel | undefined,
  bridgeId: string,
): string {
  if (previous?.road.axis !== t.road.axis) return previous?.road.id ?? t.road.id;
  return bridgeId;
}
function nextOwner(
  t: AssignedTravel,
  next: AssignedTravel | undefined,
  connection: Connection | undefined,
): string {
  if (next?.road.axis !== t.road.axis) return next?.road.id ?? t.road.id;
  return connection?.roadId ?? t.road.id;
}
function connectionLine(
  c: Connection | undefined,
  connector: ConnectorLine,
): readonly NestedWireSegment[] {
  if (c === undefined) return [];
  const points = [c.from, ...(c.via ?? []), c.to];
  return points.slice(1).flatMap((p, i) => connector(points[i] ?? p, p, c.roadId));
}
function joinsFor(
  travels: readonly AssignedTravel[],
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
  start: PrototypePoint,
): readonly Connection[] {
  const source = { from: start, to: start, roadId: travels[0]?.road.id ?? '' };
  return travels.slice(0, -1).reduce<Connection[]>((joins, t, i) => {
    const next = joined(t, travels[i + 1], wire, roads, turns);
    return [...joins, ...next.map((c) => forwardConnection(c, t, joins.at(-1) ?? source))];
  }, []);
}
/** A widened neighboring mouth may consume the approach: retain a positive
 * stem before the turn instead of backtracking to the nominal entry column.
 */
function forwardConnection(
  c: Connection,
  t: AssignedTravel,
  previous: Connection | undefined,
): Connection {
  if (!previous || !c.via) return c;
  const axis = axes[t.road.axis].along;
  const start = previous.to[axis] + (t.direction * roadLanePitch(t.road)) / 4;
  if (t.direction * (c.from[axis] - start) >= 0) return c;
  return {
    ...c,
    from: { ...c.from, [axis]: start },
    via: forwardColumns(c.via, axis, start, t),
  };
}
/** A median keeps its far column; a collapsed two-column support is infeasible. */
function forwardColumns(
  points: readonly PrototypePoint[],
  axis: 'x' | 'y',
  start: number,
  travel: AssignedTravel,
): readonly PrototypePoint[] {
  const far = points[1];
  if (far === undefined) return points.map((p) => ({ ...p, [axis]: start }));
  if (travel.direction * (far[axis] - start) < roadLanePitch(travel.road) / 4)
    return reject('unsupported-support', [travel.wireId, travel.road.id, 'median-columns']);
  return points.map((p, ordinal) => (ordinal === 0 ? { ...p, [axis]: start } : p));
}
function joined(
  t: AssignedTravel,
  next: AssignedTravel | undefined,
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
): readonly Connection[] {
  return next === undefined ? [] : [connect(t, next, wire, roads, turns)];
}
/** Materialize retained assignments, never reroute. Missing plans leave the original typed failure owner intact. */
function projectNestedWire(
  wire: NestedWire,
  travels: readonly AssignedTravel[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
  junctions: JunctionsByRoad,
): NestedWire {
  const first = travels[0],
    last = travels.at(-1),
    source = wire.segments[0]?.from,
    target = wire.segments.at(-1)?.to;
  if (first === undefined || last === undefined || source === undefined || target === undefined)
    return wire;
  const start = fan(first, source, 1),
    end = fan(last, target, -1);
  const joins = joinsFor(travels, wire, roads, turns, start.end);
  const middle = travels.flatMap((t, i) =>
    piece(t, i, joins, travels, [start.end, end.end], roads, junctions),
  );
  return {
    ...wire,
    segments: [
      ...line(start.pin, start.bend, first.road.id),
      ...line(start.bend, start.end, first.road.id),
      ...middle,
      ...line(end.end, end.bend, last.road.id),
      ...line(end.bend, end.pin, last.road.id),
    ],
  };
}

function turnDirection(
  t: AssignedTravel,
  next: AssignedTravel,
): number {
  return t.direction * next.direction * (t.road.axis === 'horizontal' ? 1 : -1);
}
function leftKey(
  t: AssignedTravel,
  next: AssignedTravel,
): readonly string[] {
  return turnDirection(t, next) < 0 ? [turnKey(t, next, t.direction)] : [];
}
function leftKeys(
  t: AssignedTravel,
  next: AssignedTravel | undefined,
): readonly string[] {
  if (!next || t.road.axis === next.road.axis) return [];
  return leftKey(t, next);
}
/** Coordinate opposing left turns from retained assignments, then project each wire once. */
export function projectNestedWires(
  wires: readonly NestedWire[],
  byWire: ReadonlyMap<string, readonly AssignedTravel[]>,
  roads: ReadonlyMap<string, PrototypeRoad>,
  junctions: readonly PrototypeJunction[],
  ports: readonly PrototypePortLocation[],
  checked = true,
): readonly NestedWire[] {
  const byRoad = junctionIndex(junctions);
  const turns = new Set(
    [...byWire.values()].flatMap((ts) => ts.flatMap((t, i) => leftKeys(t, ts[i + 1]))),
  );
  const projected = wires.map((wire) =>
    projectNestedWire(wire, byWire.get(wire.id) ?? [], roads, turns, byRoad),
  );
  if (checked) validateSupportedProjection(projected, byWire, roads, ports);
  return projected;
}

/** Read the same template algebra without emitting or changing a scene. Recovery is caller reconstruction. */
export function readNestedProjectionSupports(
  wires: readonly NestedWire[],
  byWire: ReadonlyMap<string, readonly AssignedTravel[]>,
  roads: ReadonlyMap<string, PrototypeRoad>,
) {
  const turns = new Set(
    [...byWire.values()].flatMap((ts) => ts.flatMap((t, i) => leftKeys(t, ts[i + 1]))),
  );
  return wires.flatMap((wire) => supportFor(wire, byWire.get(wire.id) ?? [], roads, turns));
}

interface RetainedJoin {
  readonly incoming: AssignedTravel;
  readonly outgoing: AssignedTravel;
  readonly previous: Connection;
  readonly nominal: Connection;
  readonly adjusted: Connection;
}

function supportFor(
  wire: NestedWire,
  travels: readonly AssignedTravel[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
) {
  const first = travels[0],
    last = travels.at(-1);
  const source = wire.segments[0]?.from,
    target = wire.segments.at(-1)?.to;
  if ([first, last, source, target].some((value) => value === undefined)) return [];
  return supportedEnds(wire, travels, roads, turns, first, last, source, target);
}

function supportedEnds(
  wire: NestedWire,
  travels: readonly AssignedTravel[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  turns: ReadonlySet<string>,
  first: AssignedTravel | undefined,
  last: AssignedTravel | undefined,
  source: PrototypePoint | undefined,
  target: PrototypePoint | undefined,
) {
  if (!first || !last || !source || !target) return [];
  const start = fan(first, source, 1),
    end = fan(last, target, -1);
  const initial = { from: start.end, to: start.end, roadId: first.road.id };
  const joins: RetainedJoin[] = [];
  travels.forEach((incoming, ordinal) => {
    const outgoing = travels[ordinal + 1];
    if (outgoing === undefined) return;
    const previous = joins.at(-1)?.adjusted ?? initial;
    const nominal = connect(incoming, outgoing, wire, roads, turns);
    joins.push({
      incoming,
      outgoing,
      previous,
      nominal,
      adjusted: forwardConnection(nominal, incoming, previous),
    });
  });
  return [{ wire, travels, start, end, joins }];
}

/** Observe only adjusted connector ownership for support admission, never project a provisional wire.
 * The final emitter shares this exact connector algebra; recovery is caller reconstruction.
 */
export function readNestedAdjustmentEvidence(
  supports: ReturnType<typeof readNestedProjectionSupports>,
  roads: ReadonlyMap<string, PrototypeRoad>,
  areas: () => readonly PrototypeJunction[],
): readonly NestedWire[] {
  const adjusted = supports.filter((support) =>
    support.joins.some((join) => join.nominal !== join.adjusted),
  );
  if (adjusted.length === 0) return [];
  const index = junctionIndex(areas());
  return adjusted.map((support) => ({
    ...support.wire,
    segments: support.joins.flatMap((join, ordinal) =>
      adjustmentEvidence(support, join, ordinal, roads, index),
    ),
  }));
}

function adjustmentEvidence(
  support: ReturnType<typeof readNestedProjectionSupports>[number],
  join: RetainedJoin,
  ordinal: number,
  roads: ReadonlyMap<string, PrototypeRoad>,
  junctions: JunctionsByRoad,
): readonly NestedWireSegment[] {
  if (join.nominal === join.adjusted) return [];
  const adjacent = support.travels
    .slice(Math.max(0, ordinal - 1), ordinal + 2)
    .map((travel) => travel.road.id);
  return connectionLine(join.adjusted, (from, to, owner) =>
    connectorLine(from, to, owner, adjacent, roads, junctions),
  );
}
