/*
 * Why this file exists
 *
 * When the server stops, a save may still be running, and closing the database under it would
 * break that save. For example, if `pnpm dev` gets Ctrl-C while `pnpm canvas apply` is saving, the
 * save must finish before the workspace files close.
 *
 * This file keeps track of running calls. Once closing starts, new calls get the "closed" answer,
 * running ones finish, and then the workspace closes, once. It never cancels a running call.
 */
import { failure, type Result } from '../../contract/errors.js';

/** Runs calls only while the session is open, then closes the workspace once they finish. */
export interface SessionLifetime {
  /**
   * Runs `operation` while the session is open and answers what it answers (a throw is passed on).
   * Once closing has started, answers `closedAnswer()` instead.
   */
  run<T>(
    operation: () => Promise<T>,
    closedAnswer: () => T,
  ): Promise<T>;
  /**
   * Stops new calls, waits for running ones, then closes the workspace once; calling it again gets
   * the same answer. Fails with the close's own failure, or `unavailable` at `shutdown` if it throws.
   */
  close(): Promise<Result<void>>;
}

/** `open` admits work; `closing` holds the one shutdown answer every `close` call shares. */
type LifetimePhase =
  { readonly kind: 'open' } | { readonly kind: 'closing'; readonly closed: Promise<Result<void>> };

/** The phase once `close` has been called. */
type ClosingPhase = Extract<LifetimePhase, { readonly kind: 'closing' }>;

const OPEN: LifetimePhase = Object.freeze({ kind: 'open' });

/**
 * Makes the lifetime of one session. `closeWorkspace` runs once, after every running call has
 * finished. Never fails.
 */
export function createSessionLifetime(
  closeWorkspace: () => Promise<Result<void>>,
): SessionLifetime {
  const active = new Set<Promise<unknown>>();
  let phase = OPEN;
  return {
    async run<T>(operation: () => Promise<T>, closedAnswer: () => T): Promise<T> {
      if (phase.kind === 'closing') return closedAnswer();
      return track(active, operation);
    },
    close(): Promise<Result<void>> {
      const closing = closingPhase(phase, () => shutdown([...active], closeWorkspace));
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
