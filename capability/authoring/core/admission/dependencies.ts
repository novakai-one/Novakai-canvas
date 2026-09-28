import type { Request } from '../../contract/records/request.js';
import type { Snapshot, ReadVersion, Write } from '../../contract/records/storage.js';
import {
  uniqueKeys,
  compareVersions,
  checkWriteAuthority,
  mergeVersions,
} from '../records/versions.js';
import { reject } from '../validation/outcomes.js';

/** The largest number of distinct record versions one request may depend on. */
const MAXIMUM_READ_DEPENDENCIES = 10000;

/**
 * Checks a submitted request against the current snapshot, before any planning.
 *
 * Checks, in order:
 * 1. No record key repeats in `scope`, then in `expected`.
 * 2. `scope` does not include history. History is written only by Authoring itself.
 * 3. No asset alias is submitted twice.
 * 4. Every expected version still matches the snapshot.
 *
 * @param request - The checked submitted request.
 * @param snapshot - The current workspace snapshot.
 * @throws AuthoringFault `invalid-input` when a key or asset alias repeats.
 * @throws AuthoringFault `permission-denied` when `scope` includes a history record.
 * @throws AuthoringFault `revision-conflict` when an expected version has changed.
 */
export function checkRequest(
  request: Request,
  snapshot: Snapshot,
): void {
  uniqueKeys(request.scope, 'scope');
  const expectedKeys = request.expected.map((read) => read.key);
  uniqueKeys(expectedKeys, 'expected');

  const scopeIncludesHistory = request.scope.some((key) => key.kind === 'history');
  if (scopeIncludesHistory) reject('permission-denied', 'scope', 'History is engine-owned');

  checkAssetAliases(request);
  compareVersions(snapshot, request.expected);
}

/**
 * Checks that a planner's proposed writes are allowed for the request.
 *
 * Even a trusted planner cannot write history, repeat a key, or write outside what the
 * request authorized.
 *
 * @param request - The checked submitted request.
 * @param writes - The planner's proposed writes.
 * @throws AuthoringFault `invalid-input` when a key repeats or a write has no expected version.
 * @throws AuthoringFault `permission-denied` when a write targets history or falls outside `scope`.
 */
export function checkProposal(
  request: Request,
  writes: readonly Write[],
): void {
  const keys = writes.map((write) => write.key);
  uniqueKeys(keys, 'writes');

  const writesHistory = keys.some((key) => key.kind === 'history');
  if (writesHistory) reject('permission-denied', 'writes', 'Planner cannot mutate engine history');

  checkWriteAuthority(request, keys);
}

/**
 * Merges every group of read dependencies into one list and checks it against the snapshot.
 *
 * The merged list only adds dependencies. It never replaces the versions the client expected.
 *
 * @param snapshot - The current workspace snapshot.
 * @param groups - The read lists to merge, for example client expectations, planner reads and validator reads.
 * @returns One version per record key.
 * @throws AuthoringFault `revision-conflict` when two groups disagree about a version, or a version has changed.
 * @throws AuthoringFault `invalid-input` when there are more than 10,000 distinct dependencies.
 */
export function checkDependencies(
  snapshot: Snapshot,
  groups: readonly (readonly ReadVersion[])[],
): readonly ReadVersion[] {
  const reads = mergeVersions(groups);
  if (reads.length > MAXIMUM_READ_DEPENDENCIES)
    reject('invalid-input', 'reads', 'Read dependency limit exceeded');
  compareVersions(snapshot, reads);
  return reads;
}

/** Rejects a request that submits one asset alias twice, so a retry can never pick between two sources. */
function checkAssetAliases(request: Request): void {
  const aliases = request.assets.map((asset) => asset.alias);
  const distinctAliases = new Set(aliases);
  if (distinctAliases.size !== request.assets.length)
    reject('invalid-input', 'assets', 'Duplicate submitted asset aliases');
}
