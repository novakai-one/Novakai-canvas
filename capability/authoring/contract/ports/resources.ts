import type { Digest } from '../brands.js';
import type { Result } from '../errors.js';
import type { Request } from '../records/request.js';
import type { Snapshot, Json, ReadVersion } from '../records/storage.js';

/**
 * Protection on the exact resource bytes and pins a request uses. Authoring holds it while it prepares
 * the request and, for apply, undo and redo, commits it; it is released afterwards, whatever the outcome.
 *
 * A failed release leaves the protection in place, which asset maintenance recovers later.
 * Committed bytes are never lost.
 */
export interface ResourceLease {
  /** The resolved resource pins, passed to the planner. */
  readonly pins: Json;
  /** The record versions the resolution depended on. */
  readonly reads: readonly ReadVersion[];
  /** The digests of every protected resource. */
  readonly covered: readonly Digest[];
  /**
   * Releases the protection.
   *
   * @returns Success, or a failure that Authoring ignores.
   */
  release(): Promise<Result<void>>;
}

/**
 * Resolves and protects the resources a request needs, before planning.
 *
 * This covers the current and historical resources, the submitted ones and resolved presets.
 * It never writes binding records itself.
 */
export interface ResourceAdmission {
  /**
   * Takes a lease on every resource the request needs.
   *
   * @param request - The checked submitted request.
   * @param snapshot - The current workspace snapshot.
   * @returns The held lease, or a failure.
   */
  acquire(
    request: Request,
    snapshot: Snapshot,
  ): Promise<Result<ResourceLease>>;
}
