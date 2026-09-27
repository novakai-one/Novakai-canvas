/*
 * The session's lifetime: admit work while open, then drain it and close the owners once. Pure
 * promise bookkeeping; the owners' close is injected by compose. A failed close is returned, and
 * the caller keeps the workspace.
 */
import { failure, type Result } from '../../contract/errors.js';

/** Shutdown rejects new work, drains every admitted operation and closes owners only after physical settlement. */
export interface SessionLifetime {
  /** Runs `operation` while open (rethrowing what it throws), or answers `unavailable()` once closing. */
  run<T>(
    operation: () => Promise<T>,
    unavailable: () => T,
  ): Promise<T>;
  close(): Promise<Result<void>>;
}

/** `open` admits work; `closing` holds the one shutdown answer every `close` call shares. */
type LifetimePhase =
  { readonly kind: 'open' } | { readonly kind: 'closing'; readonly closed: Promise<Result<void>> };

/** The phase once `close` has been called. */
type ClosingPhase = Extract<LifetimePhase, { readonly kind: 'closing' }>;

const OPEN: LifetimePhase = Object.freeze({ kind: 'open' });

/**
 * Tracks the session's admitted work. `run` answers the caller's `unavailable()` once closing has
 * begun. `close` drains admitted work, then closes the owners once; every later call gets the same
 * answer. The owners' own close failure is returned as-is; a thrown close is `unavailable` (path
 * `shutdown`).
 */
export function createSessionLifetime(close: () => Promise<Result<void>>): SessionLifetime {
  const active = new Set<Promise<unknown>>();
  let phase = OPEN;
  return {
    async run<T>(operation: () => Promise<T>, unavailable: () => T): Promise<T> {
      if (phase.kind === 'closing') return unavailable();
      return track(active, operation);
    },
    close(): Promise<Result<void>> {
      const closing = closingPhase(phase, () => shutdown([...active], close));
      phase = closing;
      return closing.closed;
    },
  };
}

/** Runs one admitted operation, holding it in `active` until it settles. Rethrows what it throws. */
async function track<T>(
  active: Set<Promise<unknown>>,
  operation: () => Promise<T>,
): Promise<T> {
  const pending = Promise.resolve().then(operation);
  active.add(pending);
  try {
    return await pending;
  } finally {
    active.delete(pending);
  }
}

/** The current closing phase, or a new one whose shutdown `start` begins now. Never fails. */
function closingPhase(
  phase: LifetimePhase,
  start: () => Promise<Result<void>>,
): ClosingPhase {
  if (phase.kind === 'closing') return phase;
  return { kind: 'closing', closed: start() };
}

/** Waits for every admitted operation to settle, then closes the owners; a thrown close is `unavailable` (path `shutdown`). */
async function shutdown(
  active: readonly Promise<unknown>[],
  close: () => Promise<Result<void>>,
): Promise<Result<void>> {
  await Promise.allSettled(active);
  try {
    return await close();
  } catch {
    return failure('unavailable', 'shutdown', 'Workspace owners could not close cleanly');
  }
}
