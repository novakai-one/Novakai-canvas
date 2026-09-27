/*
 * The session's lifetime: admit work while open, then drain it and close the owners once. Pure
 * promise bookkeeping; the owners' close is injected by compose. A failed close is returned, and
 * the caller keeps the workspace.
 */
import { failure, type Result } from '../../contract/errors.js';
/** Shutdown rejects new work, drains every admitted operation and closes owners only after physical settlement. */
export interface SessionLifetime {
  run<T>(
    operation: () => Promise<T>,
    unavailable: () => T,
  ): Promise<T>;
  close(): Promise<Result<void>>;
}
/**
 * Tracks the session's admitted work. `run` answers the caller's `unavailable()` once closing has
 * begun. `close` drains admitted work, then closes the owners once; every later call gets the same
 * answer. The owners' own close failure is returned as-is; a thrown close is `unavailable` (path
 * `shutdown`).
 */
export function createSessionLifetime(close: () => Promise<Result<void>>): SessionLifetime {
  const active = new Set<Promise<unknown>>();
  let closing: Promise<Result<void>> | null = null;
  return {
    async run<T>(operation: () => Promise<T>, unavailable: () => T): Promise<T> {
      if (closing !== null) return unavailable();
      const pending = Promise.resolve().then(operation);
      active.add(pending);
      try {
        return await pending;
      } finally {
        active.delete(pending);
      }
    },
    close(): Promise<Result<void>> {
      if (closing === null) closing = shutdown([...active], close);
      return closing;
    },
  };
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
