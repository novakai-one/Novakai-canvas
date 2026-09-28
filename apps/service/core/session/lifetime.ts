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
   * the same answer. Fails as `closeWorkspace` fails, or with `unavailable` if `closeWorkspace` throws.
   */
  close(): Promise<Result<void>>;
}

/** `open` admits work; `closing` holds the one shutdown answer every `close` call shares. */
type LifetimePhase =
  { readonly kind: 'open' } | { readonly kind: 'closing'; readonly closed: Promise<Result<void>> };

/** The phase once `close` has been called. */
type ClosingPhase = Extract<LifetimePhase, { readonly kind: 'closing' }>;

/** The phase a new session starts in. */
const OPEN: LifetimePhase = Object.freeze({ kind: 'open' });

/**
 * Makes the lifetime of one session. `closeWorkspace` runs once, after every running call has
 * finished. Never fails.
 */
export function createSessionLifetime(
  closeWorkspace: () => Promise<Result<void>>,
): SessionLifetime {
  const runningCalls = new Set<Promise<unknown>>();
  let phase: LifetimePhase = OPEN;
  return {
    async run<T>(operation: () => Promise<T>, closedAnswer: () => T): Promise<T> {
      if (phase.kind === 'closing') {
        return closedAnswer();
      }
      return trackRunningCall(runningCalls, operation);
    },
    close(): Promise<Result<void>> {
      const startShutdown = () => shutdown([...runningCalls], closeWorkspace);
      const closing = enterClosingPhase(phase, startShutdown);
      phase = closing;
      return closing.closed;
    },
  };
}

/** Runs one call and holds it in `runningCalls` until it settles; a throw is passed on. */
async function trackRunningCall<T>(
  runningCalls: Set<Promise<unknown>>,
  operation: () => Promise<T>,
): Promise<T> {
  const call = Promise.resolve().then(operation);
  runningCalls.add(call);
  try {
    return await call;
  } finally {
    runningCalls.delete(call);
  }
}

/** Starts shutdown on the first `close`, and hands later calls the same closing phase. */
function enterClosingPhase(
  phase: LifetimePhase,
  startShutdown: () => Promise<Result<void>>,
): ClosingPhase {
  if (phase.kind === 'closing') {
    return phase;
  }
  const closed = startShutdown();
  return { kind: 'closing', closed };
}

/** Waits for every running call to settle, then closes the workspace. */
async function shutdown(
  runningCalls: readonly Promise<unknown>[],
  closeWorkspace: () => Promise<Result<void>>,
): Promise<Result<void>> {
  await Promise.allSettled(runningCalls);
  return tryCloseWorkspace(closeWorkspace);
}

/** Closes the workspace, and turns a thrown close into the `unavailable` mistake. */
async function tryCloseWorkspace(
  closeWorkspace: () => Promise<Result<void>>,
): Promise<Result<void>> {
  try {
    return await closeWorkspace();
  } catch {
    return closeThrewFailure();
  }
}

/** Makes the mistake for a workspace close that threw (`unavailable` at `shutdown`). */
function closeThrewFailure(): Result<never> {
  return failure('unavailable', 'shutdown', 'Workspace owners could not close cleanly');
}
