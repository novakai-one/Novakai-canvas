import type { Digest } from '../brands.js';
import type { Result } from '../errors.js';

/**
 * Reads every digest still referenced by current documents, retained history and presets.
 * Collection calls it inside its storage transaction, so no lease or deletion runs in between.
 *
 * @returns The referenced digests (collection checks them; a bad list is `corrupt-asset`), or a
 * failure. Collection then deletes nothing and returns the failure unchanged, unless rolling back
 * the transaction also fails, which is reported as `storage-unavailable` instead.
 * @throws A throw fails the collection like a returned failure (`storage-unavailable` unless it
 * is a `StorageFault`).
 */
export type ReachabilityReader = () => Result<readonly Digest[]>;
