/** Sole Canvas public surface; pure imports do not load browser, React Flow or CSS bindings. */
export { createCanvas } from './api.js';
export { defaultProfile, profile } from './records/profile.js';
export { gestureId } from './brands.js';
export type { GestureId } from './brands.js';
export type { Canvas, Dependencies } from './types.js';
export type { Result, Diagnostic, ErrorCode } from './errors.js';
export type { SessionState, Transition, ReadingState } from './records/state.js';
export type { CanvasEvent, EventOf } from './events.js';
export type { Target, NodeTarget, WireTarget } from './records/selection.js';
export type { DetailTier, Emphasis, FocusProjection, FocusSource } from './records/focus.js';
export type { Camera, Point, Box, Viewport } from './records/camera.js';
export type { InteractionProfile, GestureInput, GestureDecision } from './records/profile.js';
export type { Scene, SceneStamp, SceneIndex, TargetInfo } from './records/scene.js';
export type {
  GestureDraft,
  RecoverableDraft,
  RouteGeometry,
  GeometryEntry,
  WireRoutePreview,
  GeometryPreview,
  AttachmentSide,
} from './records/draft.js';
export type { EditIntent, CanvasEffect, Endpoint, LocalPlacement } from './records/intent.js';
export type { PlacementIntent, RegroupIntent, RouteIntent, DropTarget } from './records/intent.js';
export type {
  CanvasView,
  ViewNode,
  ViewWire,
  ViewSection,
  OutlineSection,
  OutlineEntry,
} from './records/view.js';
export type { SceneAdmission } from './ports/scene-admission.js';
export type { SessionStore, SessionReducer, DragPreview } from './ports/session.js';

export { composeCanvas, createSession } from './compose.js';

export { createReactBindings } from './compose.js';
export type {
  RenderSlots,
  ReactBindings,
  SurfaceProps,
  ViewActions,
  ViewReader,
  PaletteItem,
  SurfaceSession,
  CanvasChromeVisibility,
} from './react-types.js';

export type { FlowNode, FlowEdge } from './react-types.js';
