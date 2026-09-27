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
/** Physical owner shutdown is terminal before the returned result; caller retains the workspace on any failed close. */
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
/** Session-local operation tracking is lifecycle state, never canonical diagram data or a second admission mechanism. */
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
