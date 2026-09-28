import type { Point, Box, ResolvedEndpoint, RoutedWire } from '../../contract/records/geometry.js';
import type { VisualWire } from '../../contract/records/input.js';
import type { SupplementalMeasurements } from '../../contract/types.js';
import { samePoint, overlaps } from '../geometry/intersections.js';
import { approach } from './endpoints.js';
import { clear, segments } from './paths.js';
import type { Segment } from './paths.js';
import { reject } from '../validation/outcomes.js';
/** Determine whether the first/last segment extends outward along the resolved named side. */
function outward(
  endpoint: ResolvedEndpoint,
  adjacent: Point | undefined,
  advance: number,
): boolean {
  if (adjacent === undefined) return false;
  const expected = approach(endpoint, Math.max(advance, 0.000001));
  return inDirection(endpoint.point, expected, adjacent);
}
/** The adjacent point must be beyond the marker's reserved length on the exact departure ray. */
function inDirection(
  origin: Point,
  expected: Point,
  actual: Point,
): boolean {
  if (origin.x === expected.x)
    return followsRay(origin.y, expected.y, actual.y, actual.x - origin.x);
  return followsRay(origin.x, expected.x, actual.x, actual.y - origin.y);
}
/** Ray distance is signed; the perpendicular coordinate must remain on the attachment axis. */
function followsRay(
  origin: number,
  expected: number,
  actual: number,
  perpendicular: number,
): boolean {
  return (
    Math.abs(perpendicular) < 0.000001 &&
    (actual - origin) * (expected - origin) >= (expected - origin) ** 2 - 0.000001
  );
}
/** Marker bounds use supplied Presentation metrics, oriented along the endpoint ray. Layout execute catches structured faults; Authoring retains the scene and owns correction. */
export function markerBox(
  endpoint: ResolvedEndpoint,
  metric: { readonly advance: number; readonly halfHeight: number },
): Box {
  const end = approach(endpoint, metric.advance);
  const horizontal = endpoint.side === 'left' || endpoint.side === 'right';
  if (horizontal)
    return {
      x: Math.min(endpoint.point.x, end.x),
      y: endpoint.point.y - metric.halfHeight,
      width: Math.max(0.000001, metric.advance),
      height: Math.max(0.000001, metric.halfHeight * 2),
    };
  return {
    x: endpoint.point.x - metric.halfHeight,
    y: Math.min(endpoint.point.y, end.y),
    width: Math.max(0.000001, metric.halfHeight * 2),
    height: Math.max(0.000001, metric.advance),
  };
}
/** Route checking is reused after native routing and by independent candidate inspection. Layout execute catches structured faults; Authoring retains the scene and owns correction. */
export function validRoute(
  points: readonly Point[],
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
  obstacles: readonly Box[],
  wire: VisualWire,
  metrics: SupplementalMeasurements,
): boolean {
  return (
    endpointsMatch(points, source, target) &&
    clear(points, obstacles) &&
    markersClear(source, target, wire, metrics, obstacles) &&
    outward(source, points[1], metrics.markers[wire.sourceMarker].advance) &&
    outward(target, points.at(-2), metrics.markers[wire.targetMarker].advance)
  );
}
/** The path begins and ends at the resolved ports, including exact measured member row heights. */
function endpointsMatch(
  points: readonly Point[],
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return false;
  return samePoint(first, source.point) && samePoint(last, target.point);
}
/** Labels reserve measured dimensions and avoid both content and previously accepted label/marker regions. Layout execute catches structured faults; Authoring retains the scene and owns correction. */
export function checkLabel(
  box: Box,
  wire: VisualWire,
  occupied: readonly Box[],
): void {
  if (box.width !== wire.label.width || box.height !== wire.label.height)
    reject('invalid-input', wire.id, 'Wire label dimensions differ from measured content');
  if (occupied.some((other) => overlaps(box, other)))
    reject('constraint-conflict', wire.id, 'Wire label overlaps reserved content');
}
/** Crossings are warnings rather than silently classified as a semantic invalidity. Layout execute catches structured faults; Authoring retains the scene and owns correction. */
export function crosses(
  a: RoutedWire,
  b: RoutedWire,
): boolean {
  return crossesSegments(segments(a.points), segments(b.points));
}
/** Reuse each wire's segment list throughout an inspection without storing derived geometry. */
export function crossesSegments(
  a: readonly Segment[],
  b: readonly Segment[],
): boolean {
  return a.some((left) => b.some((right) => crossing(left.a, left.b, right.a, right.b)));
}
/** Strict interior intersection excludes shared endpoints and collinear overlap. */
function crossing(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  if (a.y === b.y) return horizontalCrossing(a, b, c, d);
  return horizontalCrossing(c, d, a, b);
}
/** Check a horizontal/vertical pair using strict interior intervals; same-axis lines do not count. */
function horizontalCrossing(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  return a.y === b.y && c.x === d.x && inside(c.x, a.x, b.x) && inside(a.y, c.y, d.y);
}
/** Open intervals exclude shared ports and bends from crossing warnings. */
function inside(
  value: number,
  a: number,
  b: number,
): boolean {
  return value > Math.min(a, b) && value < Math.max(a, b);
}

/** Full measured marker rectangles must clear content; Layout's protected boundary owns correction after rejection. */
function markersClear(
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
  wire: VisualWire,
  metrics: SupplementalMeasurements,
  obstacles: readonly Box[],
): boolean {
  const boxes = [
    markerBox(source, metrics.markers[wire.sourceMarker]),
    markerBox(target, metrics.markers[wire.targetMarker]),
  ];
  return boxes.every((box): boolean =>
    obstacles.every((obstacle): boolean => !overlaps(box, obstacle)),
  );
}
