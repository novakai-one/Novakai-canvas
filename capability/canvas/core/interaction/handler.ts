import type { CanvasEvent, EventOf } from '../../contract/events.js';
import type { SessionState, Transition } from '../../contract/records/state.js';
import { reject } from '../validation/outcomes.js';
export interface Handler {
  readonly kind: CanvasEvent['kind'];
  run(
    state: SessionState,
    event: CanvasEvent,
  ): Transition;
}
/** Discriminant check narrows an event without a cast; payload was already parsed at the public boundary. */
function matches<K extends CanvasEvent['kind']>(
  event: CanvasEvent,
  kind: K,
): event is EventOf<K> {
  return event.kind === kind;
}
/** Each policy registers its typed event once; unexpected routing fails explicitly instead of coercing a payload. */
export function handler<K extends CanvasEvent['kind']>(
  kind: K,
  run: (state: SessionState, event: EventOf<K>) => Transition,
): Handler {
  return {
    kind,
    run(state, event): Transition {
      if (!matches(event, kind)) return reject('invalid-input', 'kind', 'Event handler mismatch');
      return run(state, event);
    },
  };
}
