import type { SceneAdmission } from '../../contract/ports/scene-admission.js';
import type { SessionState } from '../../contract/records/state.js';
import { handler, type Handler } from './handler.js';
import { accepted } from '../validation/outcomes.js';
import { changed } from './changes.js';
import { expectScene } from '../scenes/accept.js';
import { receiveScene, retainActive } from '../drafts/reconcile.js';
/** Disconnection preserves geometry recovery; reconnect does not replay or submit it. */
function connectionState(
  state: SessionState,
  connected: boolean,
): SessionState {
  if (connected) return { ...state, connected };
  return {
    ...retainActive(state, 'disconnected', 'Service disconnected during gesture'),
    connected,
    connection: null,
  };
}
/** Requested/committed scene jobs and service gates have separate fields and cannot enable read-only mutation. */
export function sceneHandlers(reader: SceneAdmission): readonly Handler[] {
  return [
    handler('expect-scene', (state, event) => changed(state, expectScene(state, event.stamp))),
    handler('receive-scene', (state, event) => accepted(receiveScene(state, event, reader))),
    handler('connected', (state, event) => changed(state, connectionState(state, event.value))),
    handler('mutation-available', (state, event) =>
      changed(state, { ...state, mutationAvailable: event.value }),
    ),
  ];
}
