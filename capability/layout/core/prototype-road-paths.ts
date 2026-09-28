import type {
  PrototypeLane,
  PrototypePoint,
  PrototypeJunction,
  PrototypeLaneConnection,
  PrototypeRoad,
  PrototypeCrossingExample,
} from '../contract/records/road-prototype.js';

/** A perpendicular turn follows the two lane axes to their intersection; parallel lanes use the junction centre. */
export function connectionPoints(
  from: PrototypeLane,
  to: PrototypeLane,
  junction: PrototypeJunction | undefined,
): readonly PrototypePoint[] {
  if (junction === undefined) return [from.exit, to.entry];
  if (horizontal(from.direction) !== horizontal(to.direction))
    return [from.exit, corner(from, to), to.entry];
  return parallelPath(from, to, junction);
}
function corner(
  from: PrototypeLane,
  to: PrototypeLane,
): PrototypePoint {
  if (!horizontal(from.direction)) return { x: from.exit.x, y: to.entry.y };
  return { x: to.entry.x, y: from.exit.y };
}
function parallelPath(
  from: PrototypeLane,
  to: PrototypeLane,
  junction: PrototypeJunction,
): readonly PrototypePoint[] {
  if (alignedForward(from, to)) return [from.exit, to.entry];
  if (!horizontal(from.direction)) {
    const y = junction.bounds.y + junction.bounds.height / 2;
    return [from.exit, { x: from.exit.x, y }, { x: to.entry.x, y }, to.entry];
  }
  const x = junction.bounds.x + junction.bounds.width / 2;
  return [from.exit, { x, y: from.exit.y }, { x, y: to.entry.y }, to.entry];
}

interface Segment {
  readonly axis: 'x' | 'y';
  readonly at: number;
  readonly low: number;
  readonly high: number;
}
function line(
  a: PrototypePoint,
  b: PrototypePoint,
): Segment {
  const axis = a.y === b.y ? 'x' : 'y';
  return {
    axis,
    at: axis === 'x' ? a.y : a.x,
    low: Math.min(a[axis], b[axis]),
    high: Math.max(a[axis], b[axis]),
  };
}
function segments(points: readonly PrototypePoint[]): readonly Segment[] {
  return points
    .slice(1)
    .map((b, i) => line(points[i] ?? b, b))
    .filter((s) => s.high > s.low);
}
function cross(
  a: Segment,
  b: Segment,
): readonly PrototypePoint[] {
  if (a.axis === b.axis) return [];
  return crossingPoint(a, b);
}
function crossingPoint(
  a: Segment,
  b: Segment,
): readonly PrototypePoint[] {
  if (!intersects(a, b)) return [];
  return [a.axis === 'x' ? { x: b.at, y: a.at } : { x: a.at, y: b.at }];
}

interface ExampleIndex {
  readonly access: ReadonlyMap<string, PrototypeRoad>;
  readonly firstLane: ReadonlyMap<string, PrototypeLane>;
  readonly lanes: ReadonlyMap<string, PrototypeLane>;
  readonly turns: ReadonlyMap<string | null, readonly PrototypeLaneConnection[]>;
}
function example(
  junction: PrototypeJunction,
  index: ExampleIndex,
): readonly PrototypeCrossingExample[] {
  const road = index.access.get(junction.id);
  if (road?.access === null || road === undefined) return [];
  const driveway = index.firstLane.get(road.id);
  if (driveway === undefined) return [];
  return pairedPaths(junction, road.access.role, driveway, index);
}
function pairedPaths(
  junction: PrototypeJunction,
  role: 'entry' | 'exit',
  driveway: PrototypeLane,
  index: ExampleIndex,
): readonly PrototypeCrossingExample[] {
  const turns = index.turns.get(junction.id) ?? [];
  const primary = turns.filter((link) => [link.fromLaneId, link.toLaneId].includes(driveway.id));
  const through = turns.filter(
    (link) =>
      index.lanes.get(link.fromLaneId)?.direction === index.lanes.get(link.toLaneId)?.direction,
  );
  const cache = new Map<string, readonly Segment[]>();
  return firstCrossing(junction.id, role, primary, through, cache);
}
function firstCrossing(
  junctionId: string,
  role: 'entry' | 'exit',
  primary: readonly PrototypeLaneConnection[],
  through: readonly PrototypeLaneConnection[],
  cache: Map<string, readonly Segment[]>,
): readonly PrototypeCrossingExample[] {
  let selected: PrototypeCrossingExample | undefined;
  primary.some((a) => {
    selected = firstThrough(junctionId, role, a, through, cache);
    return selected !== undefined;
  });
  return selected === undefined ? [] : [selected];
}
function firstThrough(
  junctionId: string,
  role: 'entry' | 'exit',
  a: PrototypeLaneConnection,
  through: readonly PrototypeLaneConnection[],
  cache: Map<string, readonly Segment[]>,
): PrototypeCrossingExample | undefined {
  let selected: PrototypeCrossingExample | undefined;
  through.some((b) => {
    selected = crossingExample(junctionId, role, a, b, cache);
    return selected !== undefined;
  });
  return selected;
}
function crossingExample(
  junctionId: string,
  role: 'entry' | 'exit',
  a: PrototypeLaneConnection,
  b: PrototypeLaneConnection,
  cache: Map<string, readonly Segment[]>,
): PrototypeCrossingExample | undefined {
  const crossings = cachedSegments(cache, a).flatMap((x) =>
    cachedSegments(cache, b).flatMap((y) => cross(x, y)),
  );
  if (crossings.length === 0) return undefined;
  return { junctionId, role, primaryConnectionId: a.id, throughConnectionId: b.id, crossings };
}
/** Each driveway gets an actual crossing example selected from the permitted connection graph. */
export function crossingExamples(
  junctions: readonly PrototypeJunction[],
  access: ReadonlyMap<string, PrototypeRoad>,
  lanes: readonly PrototypeLane[],
  connections: readonly PrototypeLaneConnection[],
): readonly PrototypeCrossingExample[] {
  const firstLane = new Map<string, PrototypeLane>();
  lanes.forEach((l) => {
    if (!firstLane.has(l.roadId)) firstLane.set(l.roadId, l);
  });
  const turns = new Map<string | null, PrototypeLaneConnection[]>();
  connections.forEach((c) => turns.set(c.junctionId, [...(turns.get(c.junctionId) ?? []), c]));
  const index = { access, firstLane, turns, lanes: new Map(lanes.map((l) => [l.id, l])) };
  return junctions.flatMap((junction) => example(junction, index));
}

function alignedForward(
  from: PrototypeLane,
  to: PrototypeLane,
): boolean {
  const across = !horizontal(from.direction) ? 'x' : 'y';
  return from.direction === to.direction && from.exit[across] === to.entry[across];
}

function horizontal(direction: PrototypeLane['direction']): boolean {
  return direction === 'left' || direction === 'right';
}

function cachedSegments(
  cache: Map<string, readonly Segment[]>,
  link: PrototypeLaneConnection,
): readonly Segment[] {
  const known = cache.get(link.id);
  if (known !== undefined) return known;
  const result = segments(link.points);
  cache.set(link.id, result);
  return result;
}

function intersects(
  a: Segment,
  b: Segment,
): boolean {
  return b.at > a.low && b.at < a.high && a.at > b.low && a.at < b.high;
}
