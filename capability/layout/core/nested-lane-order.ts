import type { NestedWire } from '../contract/records/nested-wires.js';
import type { PrototypePoint } from '../contract/records/road-prototype.js';
import type { Travel } from './nested-travel.js';
import { reject } from './validation/outcomes.js';

interface Step {
  readonly from: PrototypePoint;
  readonly to: PrototypePoint;
  readonly dx: number;
  readonly dy: number;
}
interface Path {
  readonly id: string;
  readonly forward: readonly Step[];
  readonly backward: readonly Step[];
  readonly indices: readonly number[];
}
interface Fork {
  readonly point: PrototypePoint;
  readonly order: number;
}
function step(
  from: PrototypePoint,
  to: PrototypePoint,
): Step {
  return { from, to, dx: Math.sign(to.x - from.x), dy: Math.sign(to.y - from.y) };
}
function append(
  steps: Step[],
  next: Step,
): void {
  const previous = steps.at(-1);
  if (previous?.dx === next.dx && previous.dy === next.dy) {
    steps[steps.length - 1] = { ...previous, to: next.to };
    return;
  }
  steps.push(next);
}
function path(wire: NestedWire): Path {
  const steps: Step[] = [];
  const indices = wire.segments.map((segment) => {
    append(steps, step(segment.from, segment.to));
    return steps.length - 1;
  });
  return { id: wire.id, forward: steps, backward: steps.map(reverseStep), indices };
}
type Direction = 'forward' | 'backward';
const increments = { forward: 1, backward: -1 };
function reverseStep(current: Step): Step {
  return { from: current.to, to: current.from, dx: -current.dx, dy: -current.dy };
}
function at(
  path: Path,
  index: number,
  direction: Direction,
): Step | undefined {
  return path[direction][index];
}
function turn(
  current: Step,
  next: Step | undefined,
): number {
  if (!next) return 0;
  return current.dx * next.dy - current.dy * next.dx;
}
function separation(
  a: Step,
  b: Step,
): number {
  const axis = a.dx ? 'x' : 'y';
  return (a.to[axis] - b.to[axis]) * (a.dx || a.dy);
}
function branch(
  a: Step,
  b: Step,
  nextA: Step | undefined,
  nextB: Step | undefined,
): Fork | undefined {
  const progress = separation(a, b);
  if (progress < 0) return { point: a.to, order: turn(a, nextA) };
  if (progress > 0) return { point: b.to, order: -turn(b, nextB) };
  return commonFork(a, b, nextA, nextB);
}
function commonFork(
  a: Step,
  b: Step,
  nextA: Step | undefined,
  nextB: Step | undefined,
): Fork | undefined {
  const order = turn(a, nextA) - turn(b, nextB);
  return order === 0 ? undefined : { point: a.to, order };
}
function split(
  cache: Map<string, Fork | undefined>,
  a: Path,
  b: Path,
  i: number,
  j: number,
  direction: Direction,
): Fork | undefined {
  const key = `${a.id}/${b.id}/${i}/${j}/${direction}`;
  if (cache.has(key)) return cache.get(key);
  const result = splitAt(cache, a, b, i, j, direction);
  cache.set(key, result);
  return result;
}
function splitAt(
  cache: Map<string, Fork | undefined>,
  a: Path,
  b: Path,
  i: number,
  j: number,
  direction: Direction,
): Fork | undefined {
  const first = at(a, i, direction),
    second = at(b, j, direction);
  if (!first || !second) return undefined;
  return advance(
    cache,
    a,
    b,
    i + increments[direction],
    j + increments[direction],
    direction,
    first,
    second,
  );
}
function advance(
  cache: Map<string, Fork | undefined>,
  a: Path,
  b: Path,
  i: number,
  j: number,
  direction: Direction,
  first: Step,
  second: Step,
): Fork | undefined {
  const fork = branch(first, second, at(a, i, direction), at(b, j, direction));
  if (fork) return { ...fork, order: fork.order * increments[direction] };
  return split(cache, a, b, i, j, direction);
}
function earlier(
  a: Fork,
  b: Fork,
): Fork {
  const axis = a.point.y === b.point.y ? 'x' : 'y';
  return a.point[axis] < b.point[axis] ? a : b;
}
function choose(
  a: Fork | undefined,
  b: Fork | undefined,
): number {
  if (!a) return b?.order ?? 0;
  if (!b) return a.order;
  return earlier(a, b).order;
}
function identity(
  a: Travel,
  b: Travel,
): number {
  if (a.wireId === b.wireId) return 0;
  return a.wireId < b.wireId ? -1 : 1;
}
function representative(group: readonly Travel[]): Travel {
  const first = group[0];
  if (first === undefined)
    reject('engine-failed', 'lanes.population', 'Cannot order an empty lane population');
  return first;
}
function rankGroups(
  groups: readonly (readonly Travel[])[],
  preference: (a: Travel, b: Travel) => number,
): readonly (readonly Travel[])[] {
  const ranked = groups.map((group) => ({ group, head: representative(group), predecessors: 0 }));
  ranked.forEach((a, index) => {
    ranked.slice(index + 1).forEach((b) => {
      const order = preference(a.head, b.head);
      if (order < 0) b.predecessors += 1;
      else a.predecessors += 1;
    });
  });
  return ranked
    .toSorted((a, b) => a.predecessors - b.predecessors || identity(a.head, b.head))
    .map(({ group }) => group);
}
/** Fork preferences can cycle. Rank the whole component by predecessor count, then
 * codepoint identity, instead of passing cyclic preferences to runtime sorting.
 * Transitive preferences retain their unique ranks; conflicts have a total order.
 * Each unordered pair is evaluated once; path/fork caches are invocation-local.
 */
export function laneOrder(wires: readonly NestedWire[]) {
  const paths = new Map(wires.map((wire) => [wire.id, path(wire)]));
  const cache = new Map<string, Fork | undefined>();
  const compare = (a: Travel, b: Travel): number => {
    const first = paths.get(a.wireId),
      second = paths.get(b.wireId);
    if (!first || !second) return identity(a, b);
    const i = first.indices[a.first] ?? 0,
      j = second.indices[b.first] ?? 0;
    const order = choose(
      split(cache, first, second, i, j, 'forward'),
      split(cache, first, second, i, j, 'backward'),
    );
    return order || identity(a, b);
  };
  const preference = (a: Travel, b: Travel) =>
    a.wireId < b.wireId ? compare(a, b) : -compare(b, a);
  return (groups: readonly (readonly Travel[])[]) => rankGroups(groups, preference);
}
