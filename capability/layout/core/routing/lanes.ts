import type { Point } from '../../contract/records/geometry.js';
import { segments } from './paths.js';
import type { Segment } from './paths.js';

interface Ends {
  readonly source: { readonly node: string; readonly member: string | null };
  readonly target: { readonly node: string; readonly member: string | null };
}
/** Endpoint identity is direction independent. Pure replay is safe; Layout owns retries after failed lane selection. */
export function sameEndpoints(
  a: Ends,
  b: Ends,
): boolean {
  return key(a) === key(b);
}
/** Sorting the two endpoint identities makes reciprocal edges members of the same local family. */
function key(wire: Ends): string {
  return JSON.stringify(
    [wire.source, wire.target]
      .map((end): string => JSON.stringify([end.node, end.member]))
      .toSorted(),
  );
}
interface PreparedLane {
  readonly segments: readonly Segment[];
  readonly ends: readonly Segment[];
  readonly horizontal: ReadonlyMap<number, readonly Segment[]>;
  readonly vertical: ReadonlyMap<number, readonly Segment[]>;
}
/** Per-inspection working data indexes exact collinear axes; it never survives the calculation. */
export function prepareLane(points: readonly Point[]): PreparedLane {
  const lines = segments(points);
  return {
    segments: lines,
    ends: endpointSegments(points),
    horizontal: axisIndex(lines.filter(horizontal), (line) => line.a.y),
    vertical: axisIndex(
      lines.filter((line) => line.a.x === line.b.x),
      (line) => line.a.x,
    ),
  };
}
function axisIndex(
  lines: readonly Segment[],
  coordinate: (line: Segment) => number,
) {
  const indexed = new Map<number, Segment[]>();
  lines.forEach((line) => {
    const at = coordinate(line);
    indexed.set(at, [...(indexed.get(at) ?? []), line]);
  });
  return indexed;
}
/** Reject shared interior lanes, allowing only coincident endpoint stubs. */
export function distinctLane(
  a: readonly Point[],
  b: readonly Point[],
): boolean {
  return distinctPreparedLane(prepareLane(a), prepareLane(b));
}
/** Only segments on the same exact axis can share an interior run. */
export function distinctPreparedLane(
  a: PreparedLane,
  b: PreparedLane,
): boolean {
  const stubs = sharedStubs(a.ends, b.ends);
  return a.segments.every((left) =>
    parallel(left, b).every((right) => clearPair(left, right, stubs)),
  );
}
function parallel(
  line: Segment,
  prepared: PreparedLane,
): readonly Segment[] {
  if (horizontal(line)) return prepared.horizontal.get(line.a.y) ?? [];
  if (line.a.x === line.b.x) return prepared.vertical.get(line.a.x) ?? [];
  return [];
}
/** Shared endpoint rays permit only the longer of the two explicit endpoint stubs. */
function sharedStubs(
  a: readonly Segment[],
  b: readonly Segment[],
): readonly Segment[] {
  return a.flatMap((left): readonly Segment[] =>
    b
      .filter((right): boolean => left.a.x === right.a.x && left.a.y === right.a.y)
      .flatMap((right): readonly Segment[] => [left, right]),
  );
}
/** Native approach vertices bound the exception; a complete direct path cannot exempt itself. */
function endpointSegments(points: readonly Point[]): readonly Segment[] {
  if (points.length < 3) return [];
  return [points, points.toReversed()].flatMap((ends): readonly Segment[] => firstSegment(ends));
}
/** Missing endpoint vertices cannot grant shared travel. */
function firstSegment(points: readonly Point[]): readonly Segment[] {
  const a = points[0];
  const b = points[1];
  if (a === undefined || b === undefined) return [];
  return [{ a, b }];
}
/** Positive shared travel is legal only when completely contained in a shared endpoint stub. */
function clearPair(
  a: Segment,
  b: Segment,
  stubs: readonly Segment[],
): boolean {
  if (!collinearOverlap(a, b)) return true;
  const shared = {
    a: {
      x: Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)),
      y: Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)),
    },
    b: {
      x: Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x)),
      y: Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)),
    },
  };
  return stubs.some((stub): boolean => contains(stub, shared.a) && contains(stub, shared.b));
}
/** Inclusive bounds preserve shared stub borders without permitting an interior lane. */
function contains(
  segment: Segment,
  point: Point,
): boolean {
  return (
    point.x >= Math.min(segment.a.x, segment.b.x) &&
    point.x <= Math.max(segment.a.x, segment.b.x) &&
    point.y >= Math.min(segment.a.y, segment.b.y) &&
    point.y <= Math.max(segment.a.y, segment.b.y)
  );
}
/** Orthogonal interval intersection counts travel shared in either direction, excluding point crossings. */
function collinearOverlap(
  a: Segment,
  b: Segment,
): boolean {
  if (horizontal(a) && horizontal(b)) return horizontalOverlap(a, b);
  return verticalOverlap(a, b);
}
/** Vertical segments need the same x coordinate and positive shared y extent. */
function verticalOverlap(
  a: Segment,
  b: Segment,
): boolean {
  return (
    a.a.x === a.b.x && b.a.x === b.b.x && a.a.x === b.a.x && overlap(a.a.y, a.b.y, b.a.y, b.b.y)
  );
}
/** Boundary tangencies and crossings have zero shared travel. */
function overlap(
  a: number,
  b: number,
  c: number,
  d: number,
): boolean {
  return Math.min(Math.max(a, b), Math.max(c, d)) > Math.max(Math.min(a, b), Math.min(c, d));
}

/** Horizontal classification is independent of travel direction. */
function horizontal(segment: Segment): boolean {
  return segment.a.y === segment.b.y;
}

/** Parallel horizontal intervals share travel only on the same row. */
function horizontalOverlap(
  a: Segment,
  b: Segment,
): boolean {
  return a.a.y === b.a.y && overlap(a.a.x, a.b.x, b.a.x, b.b.x);
}
