import type { Camera, Viewport } from '../../contract/records/camera.js';
/** A docked panel changes usable size; preserve the world point under its new center, never fit. */
export function resizeCamera(
  camera: Camera,
  viewport: Viewport,
): Camera {
  return {
    ...camera,
    viewport,
    x: camera.x + (viewport.width - camera.viewport.width) / 2,
    y: camera.y + (viewport.height - camera.viewport.height) / 2,
  };
}
