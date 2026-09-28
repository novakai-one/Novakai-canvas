import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { Digest } from '../../contract/brands.js';
import type { BlobRecord } from '../../contract/records/backup.js';
import type { WorkspaceState } from '../../contract/records/storage.js';
import type { VerifyBlob } from '../../contract/ports/resources.js';
import { protectAsync, success } from '../validation/outcomes.js';

/**
 * Lists every asset digest the stored slots still reference.
 *
 * Current records and retained history records count alike. Tombstones have no resources, so
 * deleted records add nothing.
 *
 * @param state - The workspace state.
 * @returns Each referenced digest once, sorted by the default string order.
 */
export function reachableResources(state: WorkspaceState): readonly Digest[] {
  return [...new Set(state.slots.flatMap((slot) => slot.resources))].sort();
}

/**
 * Verifies every blob's bytes against its digest, with all checks running together.
 *
 * Every check settles before this returns, even when one fails early, so no provider work is
 * still running when the caller releases its lease. A throw or rejection from `verify` becomes a
 * `storage-unavailable` failure ({@link protectAsync}).
 *
 * @param blobs - The blobs to verify.
 * @param verify - The Assets verifier.
 * @returns Success, or the first failure in blob order.
 */
export async function verifyResources(
  blobs: readonly BlobRecord[],
  verify: VerifyBlob,
): Promise<Result<void>> {
  const results = await Promise.all(
    blobs.map((blob) => protectAsync(() => verify(blob.digest, blob.base64))),
  );
  const failed = results.find((result) => !result.ok);
  return failed ?? success(undefined);
}

/**
 * Checks that a backup's blobs are exactly the assets its state references.
 *
 * A missing blob, an extra blob or a repeated blob all fail.
 *
 * @param state - The backup's workspace state.
 * @param blobs - The backup's blobs.
 * @returns Success, or `corrupt-record` with path `blobs`.
 */
export function checkCoverage(
  state: WorkspaceState,
  blobs: readonly BlobRecord[],
): Result<void> {
  const expected = reachableResources(state);
  const supplied = blobs.map((blob) => blob.digest).sort();
  if (!sameDigests(expected, supplied)) {
    return fail(
      'corrupt-record',
      'blobs',
      'Backup resources do not exactly match retained references',
    );
  }
  return success(undefined);
}

/**
 * Runs an action while a lease is held, then always releases the lease.
 *
 * The release is attempted after a success, a typed failure, and a throw or rejection from the
 * action. Abandoned leases (for example after a crash) are recovered by Assets.
 *
 * @param lease - The lease to release.
 * @param action - The work to do under the lease.
 * @returns The release failure when the release fails (the action's own result, success or
 * failure, is then not returned); otherwise the action's result. A throw or rejection from either
 * becomes `storage-unavailable` ({@link protectAsync}).
 */
export async function withLease<T>(
  lease: { release(): Promise<Result<void>> },
  action: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const result = await protectAsync(action);
  const released = await protectAsync(() => lease.release());
  if (!released.ok) {
    return released;
  }
  return result;
}

/** True when both sorted digest lists hold the same digests in the same order. */
function sameDigests(
  expected: readonly Digest[],
  supplied: readonly Digest[],
): boolean {
  if (expected.length !== supplied.length) {
    return false;
  }
  return expected.every((digest, index) => digest === supplied[index]);
}
