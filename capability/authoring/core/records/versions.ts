import type { Request } from '../../contract/records/request.js';
import type { ReadVersion, RecordKey, Snapshot } from '../../contract/records/storage.js';
import { keyText, versionOf } from './keys.js';
import { reject } from '../validation/outcomes.js';

/**
 * Checks that every given record version still matches the snapshot.
 *
 * One mismatch rejects the whole request. Authoring never refreshes the expected versions for the caller.
 *
 * @param snapshot - The current workspace snapshot.
 * @param expected - The record versions to check against the snapshot.
 * @throws AuthoringFault `revision-conflict` at the first record whose version has changed.
 */
export function compareVersions(
  snapshot: Snapshot,
  expected: readonly ReadVersion[],
): void {
  const staleRead = expected.find((read) => versionOf(snapshot, read.key).version !== read.version);
  if (staleRead === undefined) return;
  reject('revision-conflict', keyText(staleRead.key), 'The observed record version has changed');
}

/**
 * Checks that no record key appears twice in a list.
 *
 * A repeated key is invalid even when both entries carry the same value.
 *
 * @param keys - The record keys to check.
 * @param path - The field name reported in the error.
 * @throws AuthoringFault `invalid-input` when any key repeats.
 */
export function uniqueKeys(
  keys: readonly RecordKey[],
  path: string,
): void {
  const distinctKeys = new Set(keys.map(keyText));
  const hasDuplicates = distinctKeys.size !== keys.length;
  if (hasDuplicates) reject('invalid-input', path, 'Duplicate record identities');
}

/**
 * Checks that the request is allowed to write every given key.
 *
 * A write needs two separate permissions, and neither one can stand in for the other:
 * 1. The key is inside the request's submitted `scope`.
 * 2. The request's `expected` list names a version for the key.
 *
 * @param request - The submitted request.
 * @param keys - The keys the request is about to write.
 * @throws AuthoringFault `permission-denied` when a key is outside the scope. This is checked first.
 * @throws AuthoringFault `invalid-input` when a key has no expected version.
 */
export function checkWriteAuthority(
  request: Request,
  keys: readonly RecordKey[],
): void {
  const scopedKeys = new Set(request.scope.map(keyText));
  const expectedKeys = new Set(request.expected.map((read) => keyText(read.key)));

  const writesOutsideScope = keys.some((key) => !scopedKeys.has(keyText(key)));
  if (writesOutsideScope)
    reject('permission-denied', 'scope', 'A write falls outside submitted scope');

  const writesWithoutVersion = keys.some((key) => !expectedKeys.has(keyText(key)));
  if (writesWithoutVersion)
    reject('invalid-input', 'expected', 'Every write needs an explicit client version');
}

/**
 * Merges several lists of observed record versions into one list with one entry per key.
 *
 * The same key may appear in more than one list, as long as every entry names the same version.
 *
 * @param groups - The version lists to merge, for example client reads and validator reads.
 * @returns One version per key, in the order each key was first seen.
 * @throws AuthoringFault `revision-conflict` when two entries give one key different versions.
 */
export function mergeVersions(groups: readonly (readonly ReadVersion[])[]): readonly ReadVersion[] {
  const allReads = groups.flat();
  // A later entry for the same key replaces an earlier one; the check below proves they agree.
  const readByKey = new Map(allReads.map((read) => [keyText(read.key), read]));
  allReads.forEach((read) => checkMergedVersion(read, readByKey));
  return [...readByKey.values()];
}

/** Rejects a read whose version differs from the merged entry for the same key. */
function checkMergedVersion(
  read: ReadVersion,
  readByKey: ReadonlyMap<string, ReadVersion>,
): void {
  const mergedRead = readByKey.get(keyText(read.key));
  if (mergedRead === undefined)
    reject('invalid-input', 'reads', 'A dependency identity could not be resolved');
  if (mergedRead.version !== read.version)
    reject('revision-conflict', 'reads', 'Dependencies disagree about one record version');
}
