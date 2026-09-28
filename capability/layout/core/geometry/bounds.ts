import type { Box, Point } from '../../contract/records/geometry.js';
import { emptyBox } from '../../contract/records/geometry.js';
/** Bounding union preserves negative positions and never mutates its input. */
export function union(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return emptyBox;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
/** Clearance expansion is explicit geometry; callers choose token-derived padding. */
export function expand(
  box: Box,
  padding: number,
): Box {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}
/** Segment/route bounds have a positive footprint even for perfectly horizontal/vertical paths. */
export function pointBounds(points: readonly Point[]): Box {
  return union(points.map((point) => ({ ...point, width: 1, height: 1 })));
}
/** Centre is used for deterministic side/orientation preferences, not semantic order inference. */
export function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
