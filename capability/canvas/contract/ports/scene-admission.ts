import type { Result } from '../errors.js';
import type { Scene, SceneStamp } from '../records/scene.js';
/** Host binds owning Layout/Presentation validation; failure keeps current Canvas scene. */
export interface SceneAdmission {
  read(
    payload: unknown,
    expected: Omit<SceneStamp, 'generation'>,
  ): Result<Scene>;
}
