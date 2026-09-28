import type { Box } from '../../contract/records/geometry.js';
import { overlaps } from './intersections.js';
import { union } from './bounds.js';
interface Branch {
  readonly bounds: Box;
  readonly boxes: readonly Box[];
  readonly children: readonly Branch[];
}
/** Invocation-local bounds tree prunes distant obstacles; it retains no calculated diagram between jobs. */
function branch(boxes: readonly Box[]): Branch {
  const bounds = union(boxes);
  if (boxes.length <= 8) return { bounds, boxes, children: [] };
  const axis = bounds.width >= bounds.height ? 'x' : 'y';
  const ordered = boxes.toSorted((a, b) => a[axis] - b[axis]);
  const middle = Math.floor(ordered.length / 2);
  return {
    bounds,
    boxes: [],
    children: [branch(ordered.slice(0, middle)), branch(ordered.slice(middle))],
  };
}
function hit(
  node: Branch,
  box: Box,
): boolean {
  if (!overlaps(node.bounds, box)) return false;
  return (
    node.boxes.some((item) => overlaps(item, box)) || node.children.some((child) => hit(child, box))
  );
}
/** All candidates use the same overlap predicate as the unindexed inspector. */
export function obstacleQuery(boxes: readonly Box[]): (box: Box) => boolean {
  if (boxes.length === 0) return () => false;
  const tree = branch(boxes);
  return (box) => hit(tree, box);
}
