import type { Point, Box } from '../../contract/records/geometry.js';
import { orthogonal, samePoint, segmentHits, overlaps } from '../geometry/intersections.js';
import { expand } from '../geometry/bounds.js';
export interface Segment {
  readonly a: Point;
  readonly b: Point;
}
/** Adjacent pairs preserve authored bends and never invent a missing endpoint. */
export function segments(points: readonly Point[]): readonly Segment[] {
  return points.slice(1).flatMap((b, index) => pair(points[index], b));
}
/** The checked predecessor exists for valid arrays; empty input simply contributes no segment. */
function pair(
  a: Point | undefined,
  b: Point,
): readonly Segment[] {
  if (a === undefined) return [];
  return [{ a, b }];
}
/** A valid corridor is orthogonal, nonzero and clear of every supplied obstacle interior. */
export function clear(
  points: readonly Point[],
  obstacles: readonly Box[],
): boolean {
  return (
    points.length >= 2 && segments(points).every((segment) => clearSegment(segment, obstacles))
  );
}
/** Endpoint/tangent contact is allowed; all actual obstacle interiors remain excluded. */
function clearSegment(
  segment: Segment,
  obstacles: readonly Box[],
): boolean {
  return (
    orthogonal(segment.a, segment.b) &&
    !samePoint(segment.a, segment.b) &&
    !obstacles.some((box) => segmentHits(segment.a, segment.b, box))
  );
}
/** SVG path output is derived only from checked numeric coordinates; labels never enter path syntax. */
export function linePath(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}
/** Move a fixed distance from one point toward another on an already checked orthogonal segment. */
function towards(
  from: Point,
  to: Point,
  distance: number,
): Point {
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  return {
    x: from.x + ((to.x - from.x) * distance) / length,
    y: from.y + ((to.y - from.y) * distance) / length,
  };
}
/** A rounded bend stays inside its local corner square; unsafe squares keep their exact sharp corner. */
function corner(
  previous: Point,
  current: Point,
  next: Point,
  radius: number,
  obstacles: readonly Box[],
): string {
  const before = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
  const after = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
  const size = Math.min(radius, before / 2, after / 2);
  if (obstacles.some((box) => overlaps(box, expand({ ...current, width: 0, height: 0 }, size))))
    return `L ${current.x} ${current.y}`;
  const entry = towards(current, previous, size);
  const exit = towards(current, next, size);
  return `L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
}
/** Endpoints remain exact; only complete interior triples can produce rounded corners. */
function command(
  points: readonly Point[],
  index: number,
  radius: number,
  obstacles: readonly Box[],
): string {
  const current = points[index];
  if (current === undefined) return '';
  return interior(points[index - 1], current, points[index + 1], radius, obstacles);
}
/** Missing neighbours identify path endpoints, not malformed bend data. */
function interior(
  previous: Point | undefined,
  current: Point,
  next: Point | undefined,
  radius: number,
  obstacles: readonly Box[],
): string {
  if (previous === undefined) return `M ${current.x} ${current.y}`;
  if (next === undefined) return `L ${current.x} ${current.y}`;
  return corner(previous, current, next, radius, obstacles);
}
/** Curves are corner-rounding of the inspected orthogonal corridor, never diagonal shortcuts. */
export function curvePath(
  points: readonly Point[],
  radius: number,
  obstacles: readonly Box[],
): string {
  return points.map((_, index) => command(points, index, radius, obstacles)).join(' ');
}
