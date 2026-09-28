import type { Result } from './errors.js';
import type { SceneAdmission } from './ports/scene-admission.js';
import type { SessionState, Transition } from './records/state.js';
import type { CanvasView, OutlineSection } from './records/view.js';
import type { InteractionProfile, GestureDecision } from './records/profile.js';
import type { Point } from './records/camera.js';
import type { DropTarget } from './records/intent.js';
export interface Dependencies {
  readonly sceneAdmission: SceneAdmission;
}
/** Pure Canvas operations; host owns rendering diagnostics, effect delivery and retry after rejection. */
export interface Canvas {
  open(input: unknown): Result<SessionState>;
  transition(
    state: SessionState,
    event: unknown,
  ): Result<Transition>;
  present(
    state: SessionState,
    previous?: CanvasView,
  ): Result<CanvasView>;
  describeAccessibility(state: SessionState): Result<readonly OutlineSection[]>;
  gesture(
    input: unknown,
    profile?: InteractionProfile,
  ): Result<GestureDecision>;
  /** The group or section under a world point, for creating an object there. */
  dropTarget(
    state: SessionState,
    point: Point,
  ): Result<DropTarget | null>;
}
