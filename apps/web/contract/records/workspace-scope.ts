/*
 * Which workspace a browser store or a captured request belongs to. `unrestored` until the first
 * snapshot restores a workspace (for a store: until its restore succeeds); `restored` names it. No
 * storage key or comparison is ever made against a missing workspace. Declaration only;
 * `core/workspace/workspace-scope.ts` builds and compares it. Nothing to recover.
 */
import type { WorkspaceId } from '../brands.js';

/** No workspace yet, or the one a store restored or a request captured. */
export type WorkspaceScope =
  | { readonly phase: 'unrestored' }
  | { readonly phase: 'restored'; readonly workspace: WorkspaceId };
