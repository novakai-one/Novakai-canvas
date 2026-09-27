/*
 * Building and comparing a WorkspaceScope. Pure; never fails. The stores and captures that hold a
 * scope own their recovery.
 */
import type { WorkspaceId } from '../../contract/brands.js';
import type { Snapshot } from '../../contract/records/owners.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';

/** No workspace yet: before a store restores one, or before the first snapshot. */
export const unknownWorkspace: WorkspaceScope = Object.freeze({ phase: 'unknown' });

/** The scope that names `workspace`. */
export function knownWorkspace(workspace: WorkspaceId): WorkspaceScope {
  return { phase: 'known', workspace };
}

/** The checked snapshot's workspace; unknown while there is no snapshot. */
export function snapshotScope(snapshot: Snapshot | null): WorkspaceScope {
  if (snapshot === null) return unknownWorkspace;
  return knownWorkspace(snapshot.workspace);
}

/** Whether `scope` is known and names `workspace`. An unknown scope matches no workspace. */
export function inWorkspace(
  scope: WorkspaceScope,
  workspace: WorkspaceId | undefined,
): boolean {
  return scope.phase === 'known' && scope.workspace === workspace;
}
