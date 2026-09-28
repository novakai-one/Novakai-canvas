/*
 * Applying one parsed organisation change. Each change returns a new organisation and never changes the one
 * given. References are checked later, on the final candidate. Pure; Authoring owns the commit
 * and recovery.
 */
import type {
  Organisation,
  OrganisationEntry,
  Folder,
} from '../../contract/records/organisation.js';
import type { OrganisationChange, ChangeOf } from '../../contract/records/change.js';
import type { LibraryResult } from '../../contract/errors.js';
import { failure, success } from '../shared/outcomes.js';
import { entryKey, folderKey, hasEntry, hasFolder } from '../shared/lookups.js';
import { removeFolder } from './removal.js';

/**
 * Applies one parsed organisation change and returns the new organisation.
 *
 * - `create-folder` / `register`: appended; an existing ID is `duplicate-id`.
 * - `replace-folder` / `replace-entry`: replaced in place; a missing ID is `unknown-id`.
 * - `remove-folder`: see `removeFolder` (`unknown-id`, `folder-not-empty`, or rehomed contents).
 * - `unregister`: the entry is removed; a missing one is `unknown-id`.
 *
 * References are not checked here, so a later change in the batch may repair them; planning
 * validates the final organisation. A failure stops the batch.
 */
export function applyOperation(
  organisation: Organisation,
  change: OrganisationChange,
): LibraryResult<Organisation> {
  switch (change.op) {
    case 'create-folder':
      return writeFolder(organisation, change.value, 'create');
    case 'replace-folder':
      return writeFolder(organisation, change.value, 'replace');
    case 'remove-folder':
      return removeFolder(organisation, change);
    case 'register':
      return writeEntry(organisation, change.value, 'create');
    case 'replace-entry':
      return writeEntry(organisation, change.value, 'replace');
    case 'unregister':
      return unregister(organisation, change);
    default:
      return unsupported(change);
  }
}

/** Whether a write creates a record or replaces an existing one. */
type WriteMode = 'create' | 'replace';

/**
 * The failure for a change of no known kind. Parsing makes this unreachable; the `never` type
 * proves every kind above is handled.
 */
function unsupported(change: never): LibraryResult<Organisation> {
  void change;
  return failure({
    code: 'invalid-input',
    path: 'changes',
    message: 'Unsupported organisation operation',
  });
}

/** Creates or replaces a complete folder (covering rename, move and reorder; no field patches). */
function writeFolder(
  organisation: Organisation,
  value: Folder,
  mode: WriteMode,
): LibraryResult<Organisation> {
  const exists = hasFolder(organisation.folders, value.id);
  const identity = checkIdentity(mode, exists, `organisation.folders.${value.id}`);
  if (!identity.ok) {
    return identity;
  }
  const folders = writeList(organisation.folders, value, folderKey, mode);
  return success({ ...organisation, folders });
}

/** Creates or replaces a complete entry (covering move, reorder, archive and restore). */
function writeEntry(
  organisation: Organisation,
  value: OrganisationEntry,
  mode: WriteMode,
): LibraryResult<Organisation> {
  const exists = hasEntry(organisation.entries, value.collection);
  const identity = checkIdentity(mode, exists, `organisation.entries.${value.collection}`);
  if (!identity.ok) {
    return identity;
  }
  const entries = writeList(organisation.entries, value, entryKey, mode);
  return success({ ...organisation, entries });
}

/**
 * Removes a collection's entry. Whether the collection itself is gone is checked on the final
 * candidate, so a deletion can be planned together with its collection's removal.
 */
function unregister(
  organisation: Organisation,
  change: ChangeOf<'unregister'>,
): LibraryResult<Organisation> {
  if (!hasEntry(organisation.entries, change.collection)) {
    return failure({
      code: 'unknown-id',
      path: `organisation.entries.${change.collection}`,
      message: 'Membership must exist',
    });
  }
  const entries = organisation.entries.filter((entry) => entry.collection !== change.collection);
  return success({ ...organisation, entries });
}

/** Create needs an absent ID (`duplicate-id`); replace needs an existing one (`unknown-id`). */
function checkIdentity(
  mode: WriteMode,
  exists: boolean,
  path: string,
): LibraryResult<true> {
  if (mode === 'create') {
    return requireAbsent(exists, path);
  }
  return requirePresent(exists, path);
}

/** Create never silently replaces an existing folder or entry. */
function requireAbsent(
  exists: boolean,
  path: string,
): LibraryResult<true> {
  if (exists) {
    return failure({
      code: 'duplicate-id',
      path,
      message: 'Creation requires an absent identity',
    });
  }
  return success(true);
}

/** Replace never silently creates a missing folder or entry. */
function requirePresent(
  exists: boolean,
  path: string,
): LibraryResult<true> {
  if (!exists) {
    return failure({
      code: 'unknown-id',
      path,
      message: 'Replacement requires an existing identity',
    });
  }
  return success(true);
}

/** A new list: `value` appended (create), or put in place of the item with its key (replace). */
function writeList<T, K extends string>(
  items: readonly T[],
  value: T,
  keyOf: (record: T) => K,
  mode: WriteMode,
): readonly T[] {
  if (mode === 'create') {
    return [...items, value];
  }
  return items.map((item) => replaceMatching(item, value, keyOf));
}

/** `value` when it has the item's key, so a replacement keeps its position; otherwise the item. */
function replaceMatching<T, K extends string>(
  item: T,
  value: T,
  keyOf: (record: T) => K,
): T {
  if (keyOf(item) !== keyOf(value)) {
    return item;
  }
  return value;
}
