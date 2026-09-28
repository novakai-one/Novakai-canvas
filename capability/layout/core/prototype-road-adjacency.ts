import type {
  PrototypeRoad,
  PrototypeLane,
  PrototypeJunction,
} from '../contract/records/road-prototype.js';
import { axes } from './prototype-road-geometry.js';

/** Road ownership supplies the index: no lane has to rediscover every junction geometrically. */
export function roadJunctionIndex(junctions: readonly PrototypeJunction[]) {
  const index = new Map<string, PrototypeJunction[]>();
  junctions.forEach((j) => j.roadIds.forEach((id) => index.set(id, [...(index.get(id) ?? []), j])));
  return index;
}
function attach(
  index: Map<string, PrototypeLane[]>,
  id: string | undefined,
  lane: PrototypeLane,
) {
  if (id === undefined) return;
  index.set(id, [...(index.get(id) ?? []), lane]);
}
export function laneAdjacency(
  roads: readonly PrototypeRoad[],
  ends: ReadonlyMap<string, string>,
  lanes: readonly PrototypeLane[],
) {
  const incoming = new Map<string, PrototypeLane[]>(),
    outgoing = new Map<string, PrototypeLane[]>();
  const axisByRoad = new Map(roads.map((r) => [r.id, axes[r.axis].along]));
  lanes.forEach((l) => {
    const axis = axisByRoad.get(l.roadId) ?? 'x';
    attach(incoming, ends.get(`${l.roadId}:${l.exit[axis]}`), l);
    attach(outgoing, ends.get(`${l.roadId}:${l.entry[axis]}`), l);
  });
  return { incoming, outgoing };
}

/** The first driveway in construction order owns each junction's access description. */
export function junctionAccess(
  roads: readonly PrototypeRoad[],
  ownership: ReadonlyMap<string, readonly PrototypeJunction[]>,
) {
  const index = new Map<string, PrototypeRoad>();
  roads
    .filter((r) => r.access !== null)
    .forEach((r) =>
      (ownership.get(r.id) ?? []).forEach((j) => {
        if (!index.has(j.id)) index.set(j.id, r);
      }),
    );
  return index;
}
