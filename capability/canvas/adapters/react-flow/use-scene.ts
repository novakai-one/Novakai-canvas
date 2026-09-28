import { useMemo, useSyncExternalStore } from 'react';
import type { SurfaceSession, ViewReader, ViewSnapshot } from '../../contract/react-types.js';
import type { Result } from '../../contract/errors.js';
import type { CanvasView, OutlineSection } from '../../contract/records/view.js';
import type { SessionState } from '../../contract/records/state.js';
/** Cache selector results between unchanged immutable snapshots; host owns diagnostics and recovery. */
function createSelector(reader: ViewReader): (state: SessionState) => Result<ViewSnapshot> {
  let previous: CanvasView | undefined;
  let scene: SessionState['scene'] | null = null;
  let outline: readonly OutlineSection[] = [];
  /** Only changed scene content recomputes accessibility rows; pointer moves reuse the readable outline. */
  function select(state: SessionState): Result<ViewSnapshot> {
    const view = reader.present(state, previous);
    if (!view.ok) return view;
    const result = readOutline(state);
    if (!result.ok) return result;
    previous = view.value;
    return { ok: true, value: { state, view: view.value, outline: result.value } };
  }
  /** Store the last accepted outline only; failed selection retains its prior cached content. */
  function readOutline(state: SessionState): Result<readonly OutlineSection[]> {
    if (state.scene === scene) return { ok: true, value: outline };
    const result = reader.describeAccessibility(state);
    if (!result.ok) return result;
    scene = state.scene;
    outline = result.value;
    return result;
  }
  return select;
}
/** Subscribe to the Canvas store, never React Flow's internal node array; cleanup is supplied by the store. */
export function useScene(
  session: SurfaceSession,
  reader: ViewReader,
): Result<ViewSnapshot> {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const select = useMemo(() => createSelector(reader), [reader]);
  return useMemo(() => select(state), [select, state]);
}
