/*
 * Fresh request IDs for a write command given no `--request`. Declaration only; compose binds a
 * UUID source, so randomness stays outside core.
 */
import type { RequestId } from '../brands.js';

/** Mints request IDs. */
export interface RequestIds {
  /** A new ID that matches Authoring's request ID grammar. Never fails. */
  next(): RequestId;
}
