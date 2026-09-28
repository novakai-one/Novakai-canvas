/*
 * Building and comparing a WorkspaceScope. Pure; never fails. The stores and captures that hold a
 * scope own their recovery.
 */
import type { WorkspaceId } from '../../contract/brands.js';
import type { Snapshot } from '../../contract/records/owners.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';

/** No workspace yet: before a store restores one, or before the first snapshot. */
export const unrestoredWorkspace: WorkspaceScope = Object.freeze({ phase: 'unrestored' });

/** The scope that names `workspace`. */
export function restoredWorkspace(workspace: WorkspaceId): WorkspaceScope {
  return { phase: 'restored', workspace };
}

/** The checked snapshot's workspace; unrestored while there is no snapshot. */
export function snapshotScope(snapshot: Snapshot | null): WorkspaceScope {
  if (snapshot === null) return unrestoredWorkspace;
  return restoredWorkspace(snapshot.workspace);
}

/** Whether `scope` is restored and names `workspace`. An unrestored scope matches no workspace. */
export function inWorkspace(
  scope: WorkspaceScope,
  workspace: WorkspaceId | undefined,
): boolean {
  return scope.phase === 'restored' && scope.workspace === workspace;
}
