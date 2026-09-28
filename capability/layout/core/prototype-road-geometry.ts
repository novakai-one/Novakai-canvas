import type {
  PrototypeBounds,
  PrototypePoint,
  PrototypeDirection,
} from '../contract/records/road-prototype.js';

export const directionVector: Readonly<Record<PrototypeDirection, PrototypePoint>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};
export const axes = {
  horizontal: { along: 'x', across: 'y', length: 'width', breadth: 'height' },
  vertical: { along: 'y', across: 'x', length: 'height', breadth: 'width' },
} as const;

/** Inclusive rectangles also describe shared lane/junction endpoints. NaN fails comparisons. */
export function contains(
  box: PrototypeBounds,
  point: PrototypePoint,
): boolean {
  return [
    point.x >= box.x,
    point.x <= box.x + box.width,
    point.y >= box.y,
    point.y <= box.y + box.height,
  ].every(Boolean);
}
export function samePoint(
  a: PrototypePoint,
  b: PrototypePoint,
): boolean {
  return a.x === b.x && a.y === b.y;
}
export function intersection(
  a: PrototypeBounds,
  b: PrototypeBounds,
): PrototypeBounds {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
}
export function hasArea(box: PrototypeBounds): boolean {
  return box.width > 0 && box.height > 0;
}

/** Positive travel parallel to the lane; lateral movements and stationary points are rejected. */
export function follows(
  direction: PrototypeDirection,
  from: PrototypePoint,
  to: PrototypePoint,
): boolean {
  const vector = directionVector[direction];
  const dx = to.x - from.x,
    dy = to.y - from.y;
  return vector.x * dx + vector.y * dy > 0 && vector.x * dy - vector.y * dx === 0;
}
