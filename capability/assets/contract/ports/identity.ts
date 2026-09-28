import type { Digest, LeaseId } from '../brands.js';
import type { Result } from '../errors.js';

/**
 * Hashing, lease IDs and process ownership, injected so Assets never touches crypto or processes
 * directly. The built-in adapter is adapters/identity.ts.
 */
export interface IdentityPort {
  /**
   * Hashes base64-encoded bytes.
   *
   * @param base64 - The bytes, base64 encoded.
   * @returns The SHA-256 digest of the decoded bytes, or a failure (the built-in adapter returns
   * `invalid-input` for base64 that is invalid or not in canonical form).
   * @throws The built-in adapter never throws; a throw from another one is caught by the calling
   * boundary.
   */
  digest(base64: string): Result<Digest>;
  /**
   * Creates a new lease ID.
   *
   * @returns The new ID.
   * @throws When no valid ID can be made. It is called inside the storage transaction, so the
   * real storage adapter reports the throw (a `StorageFault` keeps its code; anything else is
   * `storage-unavailable`); with other storage, the facade reports it as `storage-unavailable`.
   */
  newLease(): LeaseId;
  /** The process ID recorded as the owner of new leases. */
  readonly ownerPid: number;
  /**
   * Tells whether a lease owner's process may still be running. When unsure (for example on a
   * permission error), it must return `true` so the lease is kept.
   *
   * @param pid - The owner's process ID.
   * @returns `false` only when the process is known to be gone.
   * @throws The built-in adapter never throws; a throw fails the collection.
   */
  ownerAlive(pid: number): boolean;
}
