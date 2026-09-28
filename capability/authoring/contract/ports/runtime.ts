import type { Digest, Timestamp, RequestId, WorkspaceId } from '../brands.js';
import type { Result } from '../errors.js';
import type { Receipt } from '../records/storage.js';

/** Hashes text deterministically. Each host chooses its own implementation. */
export interface Hasher {
  /**
   * Hashes canonical text.
   *
   * @param canonical - The canonical text to hash.
   * @returns The digest, or a failure.
   */
  digest(canonical: string): Result<Digest>;
}

/** Reads the current time. Each host chooses its own implementation. */
export interface Clock {
  /**
   * Reads the current time.
   *
   * @returns The current time in milliseconds, or a failure.
   */
  now(): Result<Timestamp>;
}

/**
 * Tells whether the caller has cancelled a request.
 *
 * Authoring asks only before commit. A stored receipt always wins over a cancellation.
 */
export interface Cancellation {
  /**
   * Tells whether a request was cancelled.
   *
   * @param request - The request to ask about.
   * @returns `true` when the request was cancelled.
   */
  cancelled(request: RequestId): boolean;
}

/**
 * Publishes a hint after a commit.
 *
 * Delivery is only a hint: Authoring returns the successful receipt even when publishing fails.
 */
export interface Notifications {
  /**
   * Publishes that a workspace changed.
   *
   * @param workspace - The workspace that changed.
   * @param receipt - The committed receipt.
   * @returns Success, or a failure that Authoring ignores.
   */
  publish(
    workspace: WorkspaceId,
    receipt: Receipt,
  ): Promise<Result<void>>;
}
