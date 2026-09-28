import type { Box, Point } from '../../contract/records/geometry.js';
/** Stored node/route coordinates are section-local; host camera never participates in conversion. */
export function toCollection(
  point: Point,
  origin: Point,
): Point {
  return { x: point.x + origin.x, y: point.y + origin.y };
}
/** UI authoring records section-local geometry by undoing only the section placement. */
export function toSection(
  point: Point,
  origin: Point,
): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}
/** Group parenting is visual; ReactFlow relative coordinates derive from the section-local parent box. */
export function toParent(
  point: Point,
  parent: Box,
): Point {
  return { x: point.x - parent.x, y: point.y - parent.y };
}
