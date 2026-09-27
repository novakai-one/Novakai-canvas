import type { NestedWire, NestedWireSegment } from '../contract/records/nested-wires.js';
import type { PrototypeRoad, PrototypePortLocation } from '../contract/records/road-prototype.js';
import type { AssignedTravel } from './nested-travel.js';
import { axes } from './prototype-road-geometry.js';
import { reject, required } from './nested-support-graph.js';

function assigned(
  travel: AssignedTravel,
  roads: ReadonlyMap<string, PrototypeRoad>,
): AssignedTravel {
  const road = required(roads, travel.road.id),
    a = axes[road.axis];
  return {
    ...travel,
    road,
    at: road.bounds[a.across] + road.bounds[a.breadth] / 2 + travel.lane.offset,
    lane: { ...travel.lane, roadId: road.id },
  };
}
function gatePlane(
  t: AssignedTravel,
  next: AssignedTravel,
  wire: NestedWire,
  ports: ReadonlyMap<string, PrototypePortLocation>,
): number {
  const access = [t.road.access, next.road.access].find((port) =>
    wire.gates.includes(port?.portId ?? ''),
  );
  if (access === undefined || access === null)
    return reject('missing-contact', [wire.id, t.road.id, next.road.id]);
  return required(ports, access.portId).point[axes[t.road.axis].along];
}
function joinPlane(
  t: AssignedTravel,
  next: AssignedTravel | undefined,
  wire: NestedWire,
  roads: ReadonlyMap<string, PrototypeRoad>,
  ports: ReadonlyMap<string, PrototypePortLocation>,
  planes: Map<number, number>,
): void {
  if (next === undefined || t.road.axis !== next.road.axis) return;
  const crossing = wire.segments
    .slice(t.last + 1, next.first)
    .some((s) => required(roads, s.corridorId).axis !== t.road.axis);
  if (!crossing) planes.set(t.last, gatePlane(t, next, wire, ports));
}
function segment(
  s: NestedWireSegment,
  ordinal: number,
  planes: ReadonlyMap<number, number>,
  roads: ReadonlyMap<string, PrototypeRoad>,
): NestedWireSegment {
  const road = required(roads, s.corridorId),
    along = axes[road.axis].along;
  const at = planes.get(ordinal);
  const to = at === undefined ? s.to : { ...s.to, [along]: at };
  return { ...s, corridorId: road.id, to };
}
function endpoints(
  segments: readonly NestedWireSegment[],
  wire: NestedWire,
  ports: ReadonlyMap<string, PrototypePortLocation>,
) {
  return segments.map((s, i) => endpoint(s, i, segments.length, wire, ports));
}
function endpoint(
  segment: NestedWireSegment,
  ordinal: number,
  count: number,
  wire: NestedWire,
  ports: ReadonlyMap<string, PrototypePortLocation>,
): NestedWireSegment {
  let from = segment.from,
    to = segment.to;
  if (ordinal === 0) from = required(ports, wire.sourcePortId).point;
  if (ordinal === count - 1) to = required(ports, wire.targetPortId).point;
  return { ...segment, from, to };
}

/** Rebind every projector-consumed coordinate and reference while freezing visits, ordinals and ranks.
 * Provisional segment interiors retain only topology; projection consumes endpoints and gate planes.
 * Pure reconstruction owns recovery.
 */
export function embedNestedPlan(
  wires: readonly NestedWire[],
  byWire: ReadonlyMap<string, readonly AssignedTravel[]>,
  roads: ReadonlyMap<string, PrototypeRoad>,
  ports: readonly PrototypePortLocation[],
) {
  const byPort = new Map(ports.map((port) => [port.portId, port]));
  const assignments = new Map(
    [...byWire].map(([id, travels]) => [id, travels.map((t) => assigned(t, roads))]),
  );
  const moved = wires.map((wire) => {
    const travels = required(byWire, wire.id),
      planes = new Map<number, number>();
    travels.forEach((t, i) => joinPlane(t, travels[i + 1], wire, roads, byPort, planes));
    const segments = wire.segments.map((s, i) => segment(s, i, planes, roads));
    return { ...wire, segments: endpoints(segments, wire, byPort) };
  });
  return { wires: moved, byWire: assignments };
}
