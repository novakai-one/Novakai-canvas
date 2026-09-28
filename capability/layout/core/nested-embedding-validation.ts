import type { PrototypeRoad } from '../contract/records/road-prototype.js';
import type { RoadContact } from './prototype-road-registry.js';
import { reject } from './nested-support-graph.js';

function intersection(
  a: PrototypeRoad,
  b: PrototypeRoad,
): readonly number[] {
  return [
    Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) -
      Math.max(a.bounds.x, b.bounds.x),
    Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) -
      Math.max(a.bounds.y, b.bounds.y),
  ];
}
function contact(c: RoadContact): void {
  const overlap = intersection(c.a, c.b);
  if (overlap.some((length) => length < 0))
    reject('mismatched-contact', [c.a.id, c.b.id], [0, 0], overlap);
}
function finite(road: PrototypeRoad): void {
  const values = Object.values(road.bounds);
  if (!values.every(Number.isFinite)) reject('unsupported-support', [road.id], [], values);
  if (road.bounds.width < 0 || road.bounds.height < 0)
    reject('unsupported-support', [road.id], [0, 0], [road.bounds.width, road.bounds.height]);
}

/** Replay retained contact incidence in bounded time before network/projection; no pair discovery.
 * Typed rejection is converted by the public embedding boundary; callers reconstruct to recover.
 */
export function validateNestedEmbedding(
  roads: readonly PrototypeRoad[],
  contacts: readonly RoadContact[],
): void {
  roads.forEach(finite);
  contacts.forEach(contact);
}
