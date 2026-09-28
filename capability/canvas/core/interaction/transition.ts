import type { SessionState, Transition } from '../../contract/records/state.js';
import type { CanvasEvent } from '../../contract/events.js';
import type { SceneAdmission } from '../../contract/ports/scene-admission.js';
import { cameraHandlers } from './camera-events.js';
import { selectionHandlers } from './selection-events.js';
import { draftHandlers } from './draft-events.js';
import { sceneHandlers } from './scene-events.js';
import { commandHandlers } from './commands.js';
import { keyboardEvent, type Dispatch } from './keyboard.js';
import { handler } from './handler.js';
import { reject } from '../validation/outcomes.js';
/** Assemble typed event policies once; framework details and persistence never enter this dispatch registry. */
export function createTransition(reader: SceneAdmission): Dispatch {
  const handlers = [
    ...cameraHandlers(),
    ...selectionHandlers(),
    ...draftHandlers(),
    ...sceneHandlers(reader),
    ...commandHandlers(),
  ];
  const registry = new Map(handlers.map((entry) => [entry.kind, entry]));
  /** Dispatch already-parsed immutable events; public facade catches policy/provider failures. */
  function dispatch(
    state: SessionState,
    event: CanvasEvent,
  ): Transition {
    const selected = registry.get(event.kind);
    if (!selected) return reject('invalid-input', 'kind', 'Unsupported Canvas event');
    return selected.run(state, event);
  }
  registry.set(
    'keyboard',
    handler('keyboard', (state, event) => keyboardEvent(state, event, dispatch)),
  );
  return dispatch;
}
