import type { NestedWire, NestedWireSegment } from '../contract/records/nested-wires.js';
import type { PrototypePortLocation, PrototypeRoad } from '../contract/records/road-prototype.js';
import type { AssignedTravel } from './nested-travel.js';
import { axes, contains } from './prototype-road-geometry.js';
import { reject, required } from './nested-support-graph.js';

/** Consume materialized support: every piece is orthogonal and owned; every retained gate
 * has a straight, gate-owned crossing at its solved plane and assigned tangential offset.
 * Missing support is final infeasibility, never another expansion or ownership search.
 * Builder/embedding Result boundaries own typed rejection; recovery is caller reconstruction.
 */
export function validateSupportedProjection(
  wires: readonly NestedWire[],
  assignments: ReadonlyMap<string, readonly AssignedTravel[]>,
  roads: ReadonlyMap<string, PrototypeRoad>,
  ports: readonly PrototypePortLocation[],
): void {
  const byPort = new Map(ports.map((port) => [port.portId, port]));
  wires.forEach((wire) => validateWire(wire, required(assignments, wire.id), roads, byPort));
}
function validateWire(
  wire: NestedWire,
  travels: readonly AssignedTravel[],
  roads: ReadonlyMap<string, PrototypeRoad>,
  ports: ReadonlyMap<string, PrototypePortLocation>,
): void {
  const segments = new Map<string, NestedWireSegment[]>();
  wire.segments.forEach((segment, ordinal) => {
    supportedSegment(wire.id, ordinal, segment, required(roads, segment.corridorId));
    const group = segments.get(segment.corridorId) ?? [];
    group.push(segment);
    segments.set(segment.corridorId, group);
  });
  const visits = new Map(travels.map((travel) => [travel.road.id, travel]));
  wire.gates.forEach((id) => {
    const travel = required(visits, `drive:${id}`),
      port = required(ports, id);
    const owned = segments.get(travel.road.id) ?? [];
    if (!owned.some((segment) => crossing(segment, travel, port)))
      reject(
        'unsupported-support',
        [wire.id, id, 'owned-normal-crossing'],
        [
          port.point[axes[travel.road.axis].along],
          port.point[axes[travel.road.axis].across] + travel.lane.offset,
        ],
        owned.flatMap((segment) => [segment.from.x, segment.from.y, segment.to.x, segment.to.y]),
      );
  });
}
function supportedSegment(
  wireId: string,
  ordinal: number,
  segment: NestedWireSegment,
  road: PrototypeRoad,
): void {
  const orthogonal = segment.from.x === segment.to.x || segment.from.y === segment.to.y;
  const contained = [segment.from, segment.to].every((point) => contains(road.bounds, point));
  if (![orthogonal, contained].every(Boolean))
    reject(
      'unsupported-support',
      [wireId, String(ordinal + 1), road.id, 'final-footprint-gap'],
      [segment.from.x, segment.from.y, segment.to.x, segment.to.y],
      [road.bounds.x, road.bounds.y, road.bounds.width, road.bounds.height],
    );
}
function crossing(
  segment: NestedWireSegment,
  travel: AssignedTravel,
  port: PrototypePortLocation,
): boolean {
  const a = axes[travel.road.axis],
    plane = port.point[a.along],
    at = port.point[a.across] + travel.lane.offset;
  return [
    segment.from[a.along] !== segment.to[a.along],
    segment.from[a.across] === at,
    segment.to[a.across] === at,
    Math.min(segment.from[a.along], segment.to[a.along]) <= plane,
    Math.max(segment.from[a.along], segment.to[a.along]) >= plane,
  ].every(Boolean);
}
