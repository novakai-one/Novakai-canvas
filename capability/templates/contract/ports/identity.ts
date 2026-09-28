import type { Digest } from '../brands.js';
import type { Result } from '../errors.js';

/** Hashes content into a {@link Digest}. The same input always gives the same digest. */
export interface IdentityPort {
  /**
   * Hashes a canonical JSON string as UTF-8. No keys or salts from the environment are used.
   *
   * @param canonical - The canonical JSON text to hash.
   * @returns The digest, or a typed failure; never throws.
   */
  hash(canonical: string): Result<Digest>;
}
