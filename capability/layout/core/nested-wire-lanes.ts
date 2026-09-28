import type { NestedWire, NestedWireSegment } from '../contract/records/nested-wires.js';
import type { PrototypeRoad } from '../contract/records/road-prototype.js';
import type { AssignedTravel, TransferChannel, Travel } from './nested-travel.js';
import { axes } from './prototype-road-geometry.js';
import { roadLanePitch, terminalStem } from './nested-terminal-pins.js';
import { laneOrder } from './nested-lane-order.js';

export function transferKey(
  t: AssignedTravel,
  next: AssignedTravel,
): string {
  return `${t.wireId}:${t.last}:${next.first}`;
}
/** A rank swap needs separate entry and exit channels to avoid sharing a continuing lane. */
export function needsMedianBridge(
  t: AssignedTravel,
  next: AssignedTravel,
): boolean {
  if (t.direction !== next.direction) return false;
  return (
    (next.lane.index < t.count && next.lane.index > t.lane.index) ||
    (t.lane.index < next.count && t.lane.index > next.lane.index)
  );
}
function travel(
  wireId: string,
  segment: NestedWireSegment,
  first: number,
  road: PrototypeRoad,
): readonly Travel[] {
  const a = axes[road.axis].along;
  if (segment.from[a] === segment.to[a]) return [];
  const direction = segment.to[a] > segment.from[a] ? 1 : -1;
  return [{ road, wireId, first, last: first, direction }];
}
function append(
  parts: readonly Travel[],
  next: Travel,
): readonly Travel[] {
  const last = parts.at(-1);
  if (last?.road.id !== next.road.id) return [...parts, next];
  return [...parts.slice(0, -1), { ...next, first: last.first }];
}
function wireTravels(
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
): readonly Travel[] {
  return wire.segments
    .flatMap((s, i) => knownTravel(wire.id, s, i, roads.get(s.corridorId)))
    .reduce(append, []);
}
function knownTravel(
  wire: string,
  segment: NestedWireSegment,
  first: number,
  road: PrototypeRoad | undefined,
): readonly Travel[] {
  if (road === undefined) return [];
  return travel(wire, segment, first, road);
}
function rightHand(road: PrototypeRoad): number {
  return road.axis === 'horizontal' ? 1 : -1;
}
function assign(
  t: Travel,
  index: number,
  count: number,
  distance: number,
  pitch: number,
): AssignedTravel {
  const offset = distance * t.direction * rightHand(t.road);
  const a = axes[t.road.axis],
    b = t.road.bounds;
  return {
    ...t,
    count,
    fanIndex: index,
    fanCount: count,
    pitch,
    at: b[a.across] + b[a.breadth] / 2 + offset,
    lane: {
      id: `${t.wireId}:${t.first}`,
      wireId: t.wireId,
      roadId: t.road.id,
      direction: t.direction,
      index,
      offset,
    },
  };
}
export interface LaneAnnotation {
  readonly roadId: string;
  readonly pitch: number;
  readonly verticalPitch?: number;
}
/** Physical lane populations continue across collinear, zero-length junction crossings. */
function continuityGroups(
  wires: readonly NestedWire[],
  roads: ReadonlyMap<string, PrototypeRoad>,
) {
  const parent = new Map<string, string>();
  const all: Travel[] = [];
  const key = (t: Travel) => `${t.road.id}:${t.direction}`;
  const root = (id: string): string => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const result = root(next);
    parent.set(id, result);
    return result;
  };
  wires.forEach((wire) => {
    const visits = wireTravels(wire, roads);
    all.push(...visits);
    visits.slice(0, -1).forEach((t, index) => {
      const next = visits[index + 1]!;
      if (!continuous(t, next, wire)) return;
      parent.set(root(key(next)), root(key(t)));
    });
  });
  const groups = new Map<string, Travel[]>();
  all.forEach((t) => addTo(groups, root(key(t)), t));
  return { travels: all, groups: [...groups.values()] };
}
function continuous(
  t: Travel,
  next: Travel,
  wire: NestedWire,
): boolean {
  if (t.direction !== next.direction || t.road.axis !== next.road.axis) return false;
  const a = axes[t.road.axis];
  const center = (road: PrototypeRoad) => road.bounds[a.across] + road.bounds[a.breadth] / 2;
  if (center(t.road) !== center(next.road)) return false;
  const skipped = wire.segments.slice(t.last + 1, next.first);
  if (skipped.length === 0) return false;
  return skipped.every(
    (s) =>
      s.from[a.across] === s.to[a.across] && t.direction * (s.to[a.along] - s.from[a.along]) >= 0,
  );
}
function assignedComponent(
  travels: readonly Travel[],
  order: ReturnType<typeof laneOrder>,
  annotations?: ReadonlyMap<string, LaneAnnotation>,
): readonly AssignedTravel[] {
  const visits = new Map<string, Travel[]>();
  travels.forEach((travel) => addTo(visits, travel.wireId, travel));
  const groups = order([...visits.values()]);
  const pitches = groups.map((group) =>
    Math.max(...group.map((t) => annotationPitch(t, annotations?.get(t.wireId)))),
  );
  let distance = 0;
  const assigned = groups.flatMap((group, index) => {
    const pitch = pitches[index]!;
    distance += index === 0 ? pitch / 2 : Math.max(pitches[index - 1]!, pitch);
    return group.map((t) => assign(t, index, groups.length, distance, pitch));
  });
  const local = new Map<string, AssignedTravel[]>();
  assigned.forEach((t) => addTo(local, t.road.id, t));
  return [...local.values()].flatMap((group) =>
    group.map((t, fanIndex) => ({ ...t, fanIndex, fanCount: group.length })),
  );
}
/** Endpoint fan depth is local; continuity slot indices can contain unused intermediate lanes. */
export function terminalFanDistance(t: AssignedTravel): number {
  const pitch = roadLanePitch(t.road);
  return terminalStem(t.road.access ?? undefined, pitch) + (t.fanCount - t.fanIndex - 1) * pitch;
}
/** Compiles retained law assignments once. Fresh indexes make caller-owned reconstruction safe. */
export function allocateNestedLanes(
  wires: readonly NestedWire[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  annotations?: ReadonlyMap<string, LaneAnnotation>,
) {
  const { travels, groups } = continuityGroups(wires, roads);
  const byRoad = new Map<string, Travel[]>();
  travels.forEach((t) => addTo(byRoad, t.road.id, t));
  const compare = laneOrder(wires);
  const assigned = groups.flatMap((group) => assignedComponent(group, compare, annotations));
  const byWire = new Map<string, AssignedTravel[]>();
  assigned.forEach((t) => addTo(byWire, t.wireId, t));
  byWire.forEach((ts, id) =>
    byWire.set(
      id,
      ts.toSorted((a, b) => a.first - b.first),
    ),
  );
  const demand = new Map([...byRoad].map(([id, ts]) => [id, ts.length]));
  const occupied = new Map<string, AssignedTravel[]>();
  assigned.forEach((travel) => addTo(occupied, travel.road.id, travel));
  const transfers = allocateTransfers(wires, byWire, roads, occupied, demand);
  byWire.forEach((travels, id) =>
    byWire.set(
      id,
      travels.map((travel, index) => {
        const next = travels[index + 1];
        const transfer = next === undefined ? undefined : transfers.get(transferKey(travel, next));
        return transfer === undefined ? travel : { ...travel, transfer };
      }),
    ),
  );
  return {
    byWire,
    transfers,
    demand,
    widths: transferWidths(measuredWidths(assigned), transfers, roads),
    lanes: assigned.map((t) => t.lane),
  };
}

/** Both through lanes and reserved transfer lanes contribute their actual outer edges. */
function transferWidths(
  through: ReadonlyMap<string, number>,
  transfers: ReadonlyMap<string, TransferChannel>,
  roads: ReadonlyMap<string, PrototypeRoad>,
): ReadonlyMap<string, number> {
  const widths = new Map(through);
  transfers.forEach((transfer) => {
    const road = roads.get(transfer.roadId)!;
    const a = axes[road.axis],
      pitch = roadLanePitch(road);
    const center = road.bounds[a.across] + road.bounds[a.breadth] / 2;
    const width =
      2 *
      (Math.max(...transfer.coordinates.map((at) => Math.abs(at - center))) + pitch / 2 + pitch);
    widths.set(road.id, Math.max(widths.get(road.id) ?? 0, width));
  });
  return widths;
}

/** A nominal zero-length crossing can become a real transfer after lane offsets.
 * Reserve it with the through population before road capacity is materialized. */
function allocateTransfers(
  wires: readonly NestedWire[],
  byWire: ReadonlyMap<string, readonly AssignedTravel[]>,
  roads: ReadonlyMap<string, PrototypeRoad>,
  through: ReadonlyMap<string, readonly AssignedTravel[]>,
  demand: Map<string, number>,
): ReadonlyMap<string, TransferChannel> {
  const channels = new Map<string, TransferChannel>();
  const ranks = new Map<string, number>();
  wires.forEach((wire) => {
    const travels = byWire.get(wire.id) ?? [];
    travels.slice(0, -1).forEach((t, index) => {
      const next = travels[index + 1]!;
      if (t.road.axis !== next.road.axis) return;
      if (t.at === next.at && !needsMedianBridge(t, next)) return;
      const road = wire.segments
        .slice(t.last + 1, next.first)
        .map((segment) => roads.get(segment.corridorId))
        .find((item) => item?.axis !== t.road.axis);
      if (road === undefined) return;
      const direction = Math.sign(next.at - t.at) || t.direction;
      const key = `${road.id}:${direction}`;
      const outer = Math.max(
        0,
        ...(through.get(road.id) ?? [])
          .filter((visit) => visit.direction === direction)
          .map((visit) => Math.abs(visit.lane.offset) + visit.pitch / 2),
      );
      const first = ranks.get(key) ?? Math.ceil(outer / roadLanePitch(road));
      const count = needsMedianBridge(t, next) ? 2 : 1;
      const a = axes[road.axis],
        pitch = roadLanePitch(road);
      const center = road.bounds[a.across] + road.bounds[a.breadth] / 2;
      const coordinates = Array.from(
        { length: count },
        (_, ordinal) => center + (first + ordinal + 0.5) * pitch * direction * rightHand(road),
      );
      channels.set(transferKey(t, next), { roadId: road.id, coordinates });
      ranks.set(key, first + count);
      demand.set(road.id, (demand.get(road.id) ?? 0) + count);
    });
  });
  return channels;
}

/** Buckets are invocation-local; append avoids copying a growing road population. */
function addTo<T>(
  index: Map<string, T[]>,
  id: string,
  value: T,
): void {
  const bucket = index.get(id) ?? [];
  bucket.push(value);
  index.set(id, bucket);
}

/** Only the chosen endpoint lane receives measured annotation spacing. */
function annotationPitch(
  travel: Travel,
  annotation?: LaneAnnotation,
): number {
  if (annotation?.roadId !== travel.road.id) return roadLanePitch(travel.road);
  const pitch =
    travel.road.axis === 'vertical'
      ? (annotation.verticalPitch ?? annotation.pitch)
      : annotation.pitch;
  return Math.max(roadLanePitch(travel.road), pitch);
}
/** Keep the complete outer annotation band inside the driveway, with one base-pitch border. */
function measuredWidths(travels: readonly AssignedTravel[]): ReadonlyMap<string, number> {
  const widths = new Map<string, number>();
  travels.forEach((travel) => {
    const width =
      2 * (Math.abs(travel.lane.offset) + travel.pitch / 2 + roadLanePitch(travel.road));
    widths.set(travel.road.id, Math.max(widths.get(travel.road.id) ?? 0, width));
  });
  return widths;
}
