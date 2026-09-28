/*
 * Walking the folder tree upward: the ancestry of a folder, and whether one folder is inside
 * another. Loops instead of recursion, so a malformed cyclic tree still ends. Pure; the caller
 * corrects the organisation, and Authoring owns commit and recovery.
 */
import type { FolderId } from '../../contract/brands.js';
import type { Folder } from '../../contract/records/organisation.js';

/** The result of {@link ancestry}. */
export interface Ancestry {
  /** The folders visited, starting folder included. */
  readonly visited: ReadonlySet<FolderId>;
  /** True when the walk stopped at a folder it had already visited. */
  readonly cycle: boolean;
}

/**
 * Walks up from `start` through parent links until it reaches the root, a missing folder, or a
 * folder already visited.
 */
export function ancestry(
  start: FolderId,
  folders: readonly Folder[],
): Ancestry {
  const visited = new Set<FolderId>();
  let current: FolderId | undefined = start;
  while (canVisit(current, visited)) {
    visited.add(current);
    current = parentOf(current, folders);
  }
  return { visited, cycle: current !== undefined };
}

/**
 * True when `folder` is `owner` itself or one of its descendants. Used for searches that include
 * subfolders. An entry at the root (`folder` undefined) is never within a folder.
 */
export function isWithin(
  folder: FolderId | undefined,
  owner: FolderId,
  folders: readonly Folder[],
): boolean {
  if (folder === undefined) {
    return false;
  }
  const walk = ancestry(folder, folders);
  return walk.visited.has(owner);
}

/** Whether the walk may continue: not past the root, and not to a folder already visited. */
function canVisit(
  id: FolderId | undefined,
  visited: ReadonlySet<FolderId>,
): id is FolderId {
  return id !== undefined && !visited.has(id);
}

/** The parent of the folder with this ID; `undefined` at the root or for a missing folder. */
function parentOf(
  id: FolderId,
  folders: readonly Folder[],
): FolderId | undefined {
  const folder = folders.find((candidate) => candidate.id === id);
  return folder?.parent;
}
