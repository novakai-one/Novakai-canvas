/*
 * Fresh request IDs for a write command given no `--request`. Declaration only; compose binds a
 * UUID source, so randomness stays outside core.
 */
import type { RequestId } from '../brands.js';
import type { Result } from '../errors.js';

/** Mints request IDs. */
export interface RequestIds {
  /**
   * A new ID checked against Authoring's request ID grammar. Fails with `cli-unavailable` when it
   * does not match; nothing has been sent, so `--request` with a valid ID is the way on.
   */
  next(): Result<RequestId>;
}
