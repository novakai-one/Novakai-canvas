/*
 * The transport generation of the latest accepted workspace read. `unread` until the first read
 * answers; `read` names the generation. No send and no comparison is ever made against a missing
 * generation. Declaration only; `core/workspace/read-generation.ts` builds and compares it.
 * Nothing to recover.
 */
import type { TransportGeneration } from '../brands.js';

/** No read yet, or the generation the latest accepted read came from. */
export type ReadGeneration =
  { readonly kind: 'unread' } | { readonly kind: 'read'; readonly generation: TransportGeneration };
