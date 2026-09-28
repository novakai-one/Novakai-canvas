import type {
  PrototypeJunction,
  PrototypeBounds,
  PrototypeRoad,
} from '../contract/records/road-prototype.js';
import { axes } from './prototype-road-geometry.js';

function union(
  a: PrototypeBounds,
  b: PrototypeBounds,
): PrototypeBounds {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
function joined(
  a: PrototypeJunction,
  b: PrototypeJunction,
): PrototypeJunction {
  return {
    ...a,
    id: `${a.id}|${b.id}`,
    bounds: union(a.bounds, b.bounds),
    roadIds: [...new Set([...a.roadIds, ...b.roadIds])],
  };
}
interface Event {
  readonly index: number;
  readonly low: number;
  readonly high: number;
}
function root(
  parents: Map<number, number>,
  id: number,
): number {
  const parent = parents.get(id);
  if (parent === undefined) return id;
  const value = root(parents, parent);
  parents.set(id, value);
  return value;
}
function connect(
  parents: Map<number, number>,
  a: number,
  b: number,
): void {
  const first = root(parents, a),
    second = root(parents, b);
  if (first !== second) parents.set(first, second);
}
function sweep(
  events: readonly Event[],
  parents: Map<number, number>,
): void {
  events
    .toSorted((a, b) => a.low - b.low)
    .reduce<Event | undefined>((previous, next) => {
      if (previous === undefined) return next;
      return overlap(previous, next, parents);
    }, undefined);
}
function overlap(
  previous: Event,
  next: Event,
  parents: Map<number, number>,
): Event {
  if (next.low >= previous.high) return next;
  connect(parents, previous.index, next.index);
  return { ...next, high: Math.max(previous.high, next.high) };
}
/** Merge neighboring construction events on their owning roads; no geometric scene-wide discovery. */
export function mergePrototypeJunctions(
  items: readonly PrototypeJunction[],
  roads: readonly PrototypeRoad[],
): readonly PrototypeJunction[] {
  const roadById = new Map(roads.map((r) => [r.id, r]));
  const events = new Map<string, Event[]>();
  items.forEach((j, index) =>
    j.roadIds.forEach((id) => {
      const a = axes[roadById.get(id)?.axis ?? 'horizontal'];
      events.set(id, [
        ...(events.get(id) ?? []),
        { index, low: j.bounds[a.along], high: j.bounds[a.along] + j.bounds[a.length] },
      ]);
    }),
  );
  const parents = new Map<number, number>();
  events.forEach((e) => sweep(e, parents));
  const groups = new Map<number, { readonly last: number; readonly junction: PrototypeJunction }>();
  items.forEach((j, i) => {
    const key = root(parents, i),
      previous = groups.get(key);
    groups.set(key, {
      last: i,
      junction: previous === undefined ? j : joined(previous.junction, j),
    });
  });
  return [...groups.values()].toSorted((a, b) => a.last - b.last).map((g) => g.junction);
}
