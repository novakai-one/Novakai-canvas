import type { SessionState } from '../../contract/records/state.js';
import type { EventOf } from '../../contract/events.js';
import type { Camera } from '../../contract/records/camera.js';
import { camera } from '../../contract/records/camera.js';
import { handler, type Handler } from './handler.js';
import { changed } from './changes.js';
import { fitBounds, locateBounds, zoomAt } from '../camera/navigate.js';
import { resizeCamera } from '../camera/resize.js';
import { previewBox } from '../scenes/preview.js';
import { targetInfo } from '../scenes/address.js';
import { parse } from '../validation/outcomes.js';
/** Explicit fit chooses admitted collection/target bounds; selection updates cannot enter this handler. */
function fitted(
  state: SessionState,
  event: EventOf<'fit'>,
): Camera {
  const bounds =
    event.target === null
      ? (state.routePreview?.bounds ?? state.scene.bounds)
      : previewBox(state, targetInfo(state.index, event.target));
  return fitBounds(state.camera, bounds, state.profile);
}
/** Camera handlers validate final arithmetic as well as input, rejecting nonfinite/out-of-range positions. */
export function cameraHandlers(): readonly Handler[] {
  return [
    handler('pan', (state, event) =>
      changed(state, {
        ...state,
        camera: parse(camera, {
          ...state.camera,
          x: state.camera.x + event.delta.x,
          y: state.camera.y + event.delta.y,
        }),
      }),
    ),
    handler('viewport', (state, event) => changed(state, { ...state, camera: event.camera })),
    handler('zoom', (state, event) =>
      changed(state, {
        ...state,
        camera: parse(camera, zoomAt(state.camera, event.factor, event.pointer, state.profile)),
      }),
    ),
    handler('fit', (state, event) =>
      changed(state, { ...state, camera: parse(camera, fitted(state, event)) }),
    ),
    handler('locate', (state, event) =>
      changed(state, {
        ...state,
        camera: parse(
          camera,
          locateBounds(state.camera, targetInfo(state.index, event.target).box),
        ),
      }),
    ),
    handler('resize-viewport', (state, event) =>
      changed(state, {
        ...state,
        camera: parse(camera, resizeCamera(state.camera, event.viewport)),
      }),
    ),
  ];
}
