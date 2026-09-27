import { createSession } from '@novakai/canvas-canvas';
import type {
  Canvas,
  SessionStore,
  CanvasEffect,
  Result as CanvasResult,
} from '@novakai/canvas-canvas';
import type { RenderDocument } from '@novakai/canvas-service';
import type { CanvasSessions } from '../../contract/ports/workspace.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { canvasFailure } from '../../contract/foreign-failures.js';
/** Effects must be drained after every dispatch, including unchanged state; rendering subscribers never submit them. */
function observed(
  session: SessionStore,
  effects: (effects: readonly CanvasEffect[]) => void,
): SessionStore {
  return {
    ...session,
    dispatch: (event) => {
      const result = session.dispatch(event);
      effects(session.drainEffects());
      return result;
    },
  };
}
/** Initial fit uses the actual available DOM viewport. Later updates use Canvas transitions and retain camera/selection. */
function open(
  document: RenderDocument,
  canvas: Canvas,
  viewport: () => { readonly width: number; readonly height: number },
  effects: (effects: readonly CanvasEffect[]) => void,
): Result<SessionStore> {
  const scene = document.scene;
  const opened = canvas.open({
    scene: document,
    expected: {
      collectionId: scene.collectionId,
      revision: scene.revision,
      inputKey: scene.inputKey,
      generation: 0,
    },
    viewport: viewport(),
  });
  if (!opened.ok) return { ok: false, error: canvasFailure(opened.error) };
  return { ok: true, value: observed(createSession(canvas, opened.value), effects) };
}
/** New generation is requested before delivery; old worker results cannot replace the accepted scene. */
function update(
  session: SessionStore,
  document: RenderDocument,
): Result<void> {
  const current = session.getSnapshot();
  if (document.scene.revision < current.stamp.revision)
    return failure('stale-diagram', 'An older render was ignored');
  const stamp = {
    collectionId: document.scene.collectionId,
    revision: document.scene.revision,
    inputKey: document.scene.inputKey,
    generation: current.requested.generation + 1,
  };
  const requested = accepted(session.dispatch({ kind: 'expect-scene', stamp }));
  if (!requested.ok) return requested;
  return accepted(session.dispatch({ kind: 'receive-scene', stamp, scene: document }));
}
/** Rejected transitions leave the existing Canvas store untouched and preserve their owner diagnostic. */
function accepted(result: CanvasResult<unknown>): Result<void> {
  if (!result.ok) return { ok: false, error: canvasFailure(result.error) };
  return { ok: true, value: undefined };
}
/** One scene-admitted Canvas API serves every collection session; DOM sizing is an explicit host concern. */
export function createCanvasSessions(
  canvas: Canvas,
  viewport: () => { readonly width: number; readonly height: number },
): CanvasSessions {
  return { canvas, open: (document, effects) => open(document, canvas, viewport, effects), update };
}
