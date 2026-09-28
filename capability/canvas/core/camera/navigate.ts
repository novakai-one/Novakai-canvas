import type { Camera, Point, Box } from '../../contract/records/camera.js';
import type { InteractionProfile } from '../../contract/records/profile.js';
import { toWorld } from './coordinates.js';
/** Zoom is bounded by the admitted product profile; pure replay is safe. */
export function clampZoom(
  value: number,
  profile: InteractionProfile,
): number {
  return Math.min(profile.zoomMax, Math.max(profile.zoomMin, value));
}
/** Pointer anchoring keeps the same world point beneath a pinch or explicit zoom control. */
export function zoomAt(
  camera: Camera,
  factor: number,
  pointer: Point,
  profile: InteractionProfile,
): Camera {
  const world = toWorld(camera, pointer);
  const zoom = clampZoom(camera.zoom * factor, profile);
  return { ...camera, zoom, x: pointer.x - world.x * zoom, y: pointer.y - world.y * zoom };
}
/** The tool rail covers the canvas's left edge (12px inset, 58px wide); fit keeps content clear of it. */
const TOOL_RAIL = 72;
/** Explicit fit uses measured bounds and viewport dimensions; data updates never call this operation. */
export function fitBounds(
  camera: Camera,
  bounds: Box,
  profile: InteractionProfile,
): Camera {
  const left = profile.fitPadding + TOOL_RAIL;
  const availableWidth = Math.max(1, camera.viewport.width - left - profile.fitPadding);
  const availableHeight = Math.max(1, camera.viewport.height - profile.fitPadding * 2);
  const zoom = clampZoom(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
    profile,
  );
  return {
    ...camera,
    zoom,
    x: left + availableWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: camera.viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}
/** Locate centers one explicit target at current zoom; it does not select or open panels. */
export function locateBounds(
  camera: Camera,
  bounds: Box,
): Camera {
  return {
    ...camera,
    x: camera.viewport.width / 2 - (bounds.x + bounds.width / 2) * camera.zoom,
    y: camera.viewport.height / 2 - (bounds.y + bounds.height / 2) * camera.zoom,
  };
}
