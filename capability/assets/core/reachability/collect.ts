import type { Result } from '../../contract/errors.js';
import type { Digest } from '../../contract/brands.js';
import { leaseRecord, digestList } from '../../contract/records/lease.js';
import type { LeaseRecord } from '../../contract/records/lease.js';
import type { AssetTransaction } from '../../contract/ports/storage.js';
import type { IdentityPort } from '../../contract/ports/identity.js';
import type { ReachabilityReader } from '../../contract/ports/reachability.js';
import type { CollectionReport } from '../../contract/types.js';
import { parse, success } from '../validation/outcomes.js';

/**
 * Deletes stored blobs that nothing references or leases. Collection is explicit maintenance;
 * before committing a binding, Authoring acquires existing bytes or stages them under a
 * reservation. Runs inside the caller's storage transaction.
 *
 * Steps, in order:
 * 1. check every stored lease (`corrupt-asset` at the issue's path for a malformed one; nothing
 *    is deleted);
 * 2. read the referenced digests (the reader's failure is returned unchanged) and check them
 *    (`corrupt-asset`);
 * 3. delete the leases whose owner process is gone; the other leases keep their digests;
 * 4. delete every stored blob that is neither referenced nor kept by a lease.
 *
 * @param view - The collection transaction.
 * @param identity - Tells whether a lease owner's process may still be running.
 * @param readReachability - Reads the referenced digests.
 * @returns The removed and retained digests, or the first failure.
 * @throws Whatever the storage calls, the reader or the liveness check throw. It runs inside a
 * storage transaction: the real storage adapter turns the throw into a failure and rolls metadata
 * back; with other storage the facade's `protect` does. Blob files already deleted are not
 * restored by the rollback.
 */
export function collectBlobs(
  view: Pick<AssetTransaction, 'listLeases' | 'deleteLease' | 'listBlobs' | 'deleteBlob'>,
  identity: Pick<IdentityPort, 'ownerAlive'>,
  readReachability: ReachabilityReader,
): Result<CollectionReport> {
  const leases = readLeases(view);
  if (!leases.ok) {
    return leases;
  }
  return collectChecked(view, leases.value, identity, readReachability);
}

/** Checks every stored lease before anything is deleted; one malformed lease fails the whole collection. */
function readLeases(view: Pick<AssetTransaction, 'listLeases'>): Result<readonly LeaseRecord[]> {
  const checked = view.listLeases().map((raw) => parse(leaseRecord, raw, 'corrupt-asset'));
  const failed = checked.find((result) => !result.ok);
  if (failed && !failed.ok) {
    return failed;
  }
  return success(checked.flatMap(parsedValue));
}

/** The parsed value of a successful result as a one-item list, or an empty list for a failure. */
function parsedValue(result: Result<LeaseRecord>): readonly LeaseRecord[] {
  if (result.ok) {
    return [result.value];
  }
  return [];
}

/** Reads and checks the references, recovers dead owners' leases, then removes unreferenced blobs. */
function collectChecked(
  view: Pick<AssetTransaction, 'deleteLease' | 'listBlobs' | 'deleteBlob'>,
  leases: readonly LeaseRecord[],
  identity: Pick<IdentityPort, 'ownerAlive'>,
  readReachability: ReachabilityReader,
): Result<CollectionReport> {
  const references = readReachability();
  if (!references.ok) {
    return references;
  }
  const checked = parse(digestList, references.value, 'corrupt-asset');
  if (!checked.ok) {
    return checked;
  }
  const pins = recoverOwners(view, leases, identity);
  return removeUnreferenced(view, [...checked.value, ...pins]);
}

/**
 * Deletes the leases whose owner process is known to be gone and returns the digests of the
 * others. A reused process ID or a permission error keeps the lease.
 */
function recoverOwners(
  view: Pick<AssetTransaction, 'deleteLease'>,
  leases: readonly LeaseRecord[],
  identity: Pick<IdentityPort, 'ownerAlive'>,
): readonly Digest[] {
  const active = leases.filter((lease) => identity.ownerAlive(lease.ownerPid));
  const activeIds = new Set(active.map((lease) => lease.id));
  leases.filter((lease) => !activeIds.has(lease.id)).forEach((lease) => view.deleteLease(lease.id));
  return active.flatMap((lease) => lease.digests);
}

/**
 * Deletes every listed blob not in `protectedDigests` and reports both lists in listed order. Only
 * checked digests are deleted. A storage failure throws, so no success is reported.
 */
function removeUnreferenced(
  view: Pick<AssetTransaction, 'listBlobs' | 'deleteBlob'>,
  protectedDigests: readonly Digest[],
): Result<CollectionReport> {
  const keep = new Set(protectedDigests);
  const present = view.listBlobs();
  const removed = present.filter((digest) => !keep.has(digest));
  const retained = present.filter((digest) => keep.has(digest));
  removed.forEach((digest) => view.deleteBlob(digest));
  return success({ removed, retained });
}
