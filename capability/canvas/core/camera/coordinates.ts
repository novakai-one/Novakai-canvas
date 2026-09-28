import type { Point, Camera, Box } from '../../contract/records/camera.js';
/** Pure screen-to-world conversion; callers pass coordinates relative to the canvas element. */
export function toWorld(
  camera: Camera,
  point: Point,
): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
/** Pure world-to-screen conversion; no global screen or panel dimensions are consulted. */
export function toScreen(
  camera: Camera,
  point: Point,
): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}
/** Translate a section-local box once; Layout nodes already include group offsets in section space. */
export function translateBox(
  box: Box,
  origin: Point,
): Box {
  return { ...box, x: box.x + origin.x, y: box.y + origin.y };
}
/** Inclusive intersection supports marquee selection even when a thin object touches its boundary. */
export function intersects(
  left: Box,
  right: Box,
): boolean {
  const horizontal = left.x <= right.x + right.width && left.x + left.width >= right.x;
  const vertical = left.y <= right.y + right.height && left.y + left.height >= right.y;
  return [horizontal, vertical].every(Boolean);
}
