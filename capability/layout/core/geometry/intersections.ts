import type { Box, Point } from '../../contract/records/geometry.js';
const tolerance = 0.000001;
/** Shared borders are not interior overlap; explicit clearance is applied before this predicate. */
export function overlaps(
  a: Box,
  b: Box,
): boolean {
  return (
    a.x < b.x + b.width - tolerance &&
    a.x + a.width > b.x + tolerance &&
    a.y < b.y + b.height - tolerance &&
    a.y + a.height > b.y + tolerance
  );
}
/** Inclusive containment permits points on a frame/port boundary. */
export function contains(
  outer: Box,
  inner: Box,
): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}
/** Axis-aligned segment intersection tests interior crossing; diagonal segments are rejected upstream. */
export function segmentHits(
  a: Point,
  b: Point,
  box: Box,
): boolean {
  if (Math.abs(a.y - b.y) < tolerance) return horizontalHits(a, b, box);
  return verticalHits(a, b, box);
}
/** Endpoint tangency at the outer edge remains allowed; unrelated content interiors remain forbidden. */
function horizontalHits(
  a: Point,
  b: Point,
  box: Box,
): boolean {
  return (
    a.y > box.y + tolerance &&
    a.y < box.y + box.height - tolerance &&
    Math.max(a.x, b.x) > box.x + tolerance &&
    Math.min(a.x, b.x) < box.x + box.width - tolerance
  );
}
/** Vertical counterpart uses the same strict-interior rule. */
function verticalHits(
  a: Point,
  b: Point,
  box: Box,
): boolean {
  return (
    a.x > box.x + tolerance &&
    a.x < box.x + box.width - tolerance &&
    Math.max(a.y, b.y) > box.y + tolerance &&
    Math.min(a.y, b.y) < box.y + box.height - tolerance
  );
}
/** Exact side-aligned routing tolerates only native floating-point noise. */
export function orthogonal(
  a: Point,
  b: Point,
): boolean {
  return Math.abs(a.x - b.x) < tolerance || Math.abs(a.y - b.y) < tolerance;
}
/** Named point equality centralizes the native geometry tolerance. */
export function samePoint(
  a: Point,
  b: Point,
): boolean {
  return Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance;
}
