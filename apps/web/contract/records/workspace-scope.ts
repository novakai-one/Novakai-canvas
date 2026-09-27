/*
 * Which workspace a browser store or a captured request belongs to. `unknown` before a store has
 * restored a workspace, or when a request was captured before the first snapshot; `known` names
 * it. No storage key or comparison is ever made against a missing workspace. Declaration only;
 * `core/workspace/workspace-scope.ts` builds and compares it. Nothing to recover.
 */
import type { WorkspaceId } from '../brands.js';

/** No workspace yet, or the one a store restored or a request captured. */
export type WorkspaceScope =
  { readonly phase: 'unknown' } | { readonly phase: 'known'; readonly workspace: WorkspaceId };
