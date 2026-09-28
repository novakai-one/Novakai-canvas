import type {
  SessionReducer,
  SessionStore,
  PointerGesture,
  DragPreview,
} from '../../contract/ports/session.js';
import type { SessionState, Transition } from '../../contract/records/state.js';
import type { CanvasEffect } from '../../contract/records/intent.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
/** Notification failure does not roll back an accepted transition; host repairs the failed subscriber. */
function notify(listener: () => void): readonly Diagnostic[] {
  try {
    listener();
    return [];
  } catch {
    return [
      {
        code: 'listener-failure',
        path: 'subscription',
        targets: [],
        message: 'Canvas subscriber failed after the state changed',
        recovery:
          'Host reads current snapshot and repairs the subscriber; do not replay the event.',
      },
    ];
  }
}
/** Explicit store lifecycle failure is typed; a closed session never accepts another mutation. */
function disposed(): Result<never> {
  return {
    ok: false,
    error: {
      code: 'disposed',
      path: 'session',
      targets: [],
      message: 'Canvas session is closed',
      recovery: 'Host opens a new session; retained snapshot remains readable.',
    },
  };
}
/** Session owns ephemeral state and subscriptions. Repeated edit IDs replay without effects; conflicting reuse rejects.
 * Host drains effects, reconciles durable Authoring receipts, and persists recoverable drafts before closing.
 */
export function createStore(
  reducer: SessionReducer,
  initial: SessionState,
): SessionStore {
  let state = initial;
  let pointer: PointerGesture | null = null;
  let preview: DragPreview | null = null;
  const previewListeners = new Set<() => void>();
  let acceptedIntents: ReadonlyMap<string, string> = new Map();
  let closed = false;
  let effects: readonly CanvasEffect[] = [];
  const listeners = new Set<() => void>();
  /** Notify a captured subscriber list so unsubscribe during notification cannot skip another listener. */
  function publish(): readonly Diagnostic[] {
    return [...listeners].flatMap(notify);
  }
  /** Unchanged transitions retain diagnostics without waking subscribers. */
  function notifyChange(transition: Transition): readonly Diagnostic[] {
    if (!transition.changed) return [];
    return publish();
  }
  /** Escape, a foreign update or drop ends the draft; the live offset goes with it. */
  function dropStalePreview(): void {
    if (preview === null || state.draft?.id === preview.id) return;
    preview = null;
    [...previewListeners].forEach(notify);
  }
  /** Successful dispatch commits local state and queues effects before notifications; diagnostics do not imply retry. */
  function commit(transition: Transition): Result<Transition> {
    const admission = admitEffects(transition.effects, acceptedIntents);
    if (!admission.ok) return admission;
    if (admission.value.replay)
      return {
        ok: true,
        value: { state, effects: [], diagnostics: transition.diagnostics, changed: false },
      };
    acceptedIntents = admission.value.accepted;
    state = transition.state;
    dropStalePreview();
    effects = [...effects, ...transition.effects];
    const notifications = notifyChange(transition);
    const diagnostics = [...transition.diagnostics, ...notifications];
    return { ok: true, value: { ...transition, diagnostics } };
  }
  return {
    /** Immutable rendering snapshot; transient pointer bookkeeping does not publish a new scene. */
    getSnapshot: () => state,
    /** Adapter gestures read their session-owned identity before accepting a delayed callback. */
    readPointer: () => pointer,
    /** Detached pointer metadata is ephemeral; closed sessions cannot start a new gesture. */
    writePointer(next): void {
      if (closed) return;
      pointer = copyPointer(next);
    },
    readPreview: () => preview,
    /** Wakes only preview subscribers; the scene snapshot is untouched until drop. */
    writePreview(next): void {
      if (closed || next === preview) return;
      preview = next;
      [...previewListeners].forEach(notify);
    },
    subscribePreview(listener): () => void {
      if (!closed) previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    },
    /** Each live listener has idempotent cleanup; closed sessions never subscribe. */
    subscribe(listener): () => void {
      if (!closed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Invalid transitions leave state intact; repeated accepted edit IDs never requeue their effects. */
    dispatch(event): Result<Transition> {
      if (closed) return disposed();
      const result = reducer.transition(state, event);
      if (!result.ok) return result;
      return commit(result.value);
    },
    /** Host consumes the queued effects once and owns durable receipt reconciliation. */
    drainEffects(): readonly CanvasEffect[] {
      const pending = effects;
      effects = [];
      return pending;
    },
    /** Host persists recovery first; disposal is idempotent and closes all ephemeral resources. */
    dispose(): void {
      closed = true;
      pointer = null;
      preview = null;
      previewListeners.clear();
      acceptedIntents = new Map();
      listeners.clear();
      effects = [];
    },
  };
}

interface EffectAdmission {
  readonly replay: boolean;
  readonly accepted: ReadonlyMap<string, string>;
}
/** Detach mutable caller records; pointer coordinates cannot change behind the session's back. */
function copyPointer(pointer: PointerGesture | null): PointerGesture | null {
  if (pointer === null) return null;
  return Object.freeze({
    ...pointer,
    target: Object.freeze({ ...pointer.target }),
    start: Object.freeze({ ...pointer.start }),
  });
}
/** Bounded identities protect the non-idempotent edit boundary; ordinary pan/select events intentionally remain repeatable. */
function admitEffects(
  effects: readonly CanvasEffect[],
  accepted: ReadonlyMap<string, string>,
): Result<EffectAdmission> {
  const intents = effects
    .filter((effect) => effect.kind === 'edit-intent')
    .map((effect) => [effect.intent.id, JSON.stringify(effect.intent)] as const);
  const conflict = intents.some(([id, fingerprint]) => conflicts(accepted, id, fingerprint));
  if (conflict) return invalidIntent('An accepted edit identity was reused for different content');
  return admitFreshIntents(intents, accepted);
}
/** A repeated identity is safe only when its complete typed intent matches the first accepted one. */
function conflicts(
  accepted: ReadonlyMap<string, string>,
  id: string,
  fingerprint: string,
): boolean {
  const prior = accepted.get(id);
  return prior !== undefined && prior !== fingerprint;
}
/** Batched effects must be entirely new or entirely replayed; a partial replay cannot silently drop a new edit. */
function admitFreshIntents(
  intents: readonly (readonly [string, string])[],
  accepted: ReadonlyMap<string, string>,
): Result<EffectAdmission> {
  const repeated = intents.filter(([id]) => accepted.has(id)).length;
  if (repeated > 0) return repeatedIntents(intents, repeated, accepted);
  const next = new Map([...accepted, ...intents]);
  if (next.size > 10000)
    return invalidIntent(
      'Session edit identity limit reached; preserve drafts and open a new session',
    );
  return { ok: true, value: { replay: false, accepted: next } };
}
/** Replay preserves the current snapshot; prior effects belong to the existing queue or the host receipt lifecycle. */
function repeatedIntents(
  intents: readonly (readonly [string, string])[],
  repeated: number,
  accepted: ReadonlyMap<string, string>,
): Result<EffectAdmission> {
  if (repeated !== intents.length)
    return invalidIntent('An edit batch mixes previously accepted and new identities');
  return { ok: true, value: { replay: true, accepted } };
}
/** Host corrects a reused identity or safely reopens a bounded session; no partial local state was committed. */
function invalidIntent(message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'invalid-gesture',
      path: 'intent.id',
      targets: [],
      message,
      recovery:
        'Host retains current state, reconciles existing receipts and uses a fresh identity for new work.',
    },
  };
}
