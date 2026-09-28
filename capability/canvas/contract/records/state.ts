import type { Diagnostic } from '../errors.js';
import type { GestureId } from '../brands.js';
import type { Scene, SceneIndex, SceneStamp } from './scene.js';
import type { Camera } from './camera.js';
import type { Target } from './selection.js';
import type { InteractionProfile } from './profile.js';
import type { GestureDraft, RecoverableDraft, GeometryPreview } from './draft.js';
import type { Endpoint, CanvasEffect } from './intent.js';
export interface ReadingState {
  readonly savedCamera: Camera;
  readonly savedSelection: readonly Target[];
  readonly sections: readonly string[];
  readonly active: number;
  readonly collapsed: readonly string[];
}
/** Only open/transition construct trusted state; host stores draft/camera DTOs, never this whole object. */
export interface SessionState {
  readonly scene: Scene;
  readonly index: SceneIndex;
  readonly stamp: SceneStamp;
  readonly requested: SceneStamp;
  readonly camera: Camera;
  readonly profile: InteractionProfile;
  readonly readOnly: boolean;
  readonly selection: readonly Target[];
  readonly hover: Target | null;
  readonly tool: 'select' | 'hand' | 'connect';
  readonly connection: Endpoint | null;
  readonly draft: GestureDraft | null;
  readonly routePreview?: (GeometryPreview & { readonly gesture: GestureId }) | null;
  readonly recovery: readonly RecoverableDraft[];
  readonly reading: ReadingState | null;
  readonly treeCollapsed?: readonly string[];
  readonly connected: boolean;
  readonly mutationAvailable: boolean;
}
export interface Transition {
  readonly state: SessionState;
  readonly effects: readonly CanvasEffect[];
  readonly diagnostics: readonly Diagnostic[];
  readonly changed: boolean;
}
