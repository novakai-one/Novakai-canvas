import type { Result } from '../../contract/errors.js';
import type { BackupResources, ResourceLease, VerifyBlob } from '../../contract/ports/resources.js';
import { backupBundle, blob } from '../../contract/records/backup.js';
import type { BackupBundle, BlobRecord } from '../../contract/records/backup.js';
import type { WorkspaceState } from '../../contract/records/storage.js';
import type { Digest } from '../../contract/brands.js';
import {
  BACKUP_JSON_LIMIT,
  boundedClone,
  parse,
  protect,
  protectAsync,
  success,
} from '../validation/outcomes.js';
import { reachableResources, verifyResources, withLease } from './resources.js';

/**
 * Builds a backup bundle from one consistent workspace state and the asset bytes it references.
 *
 * Steps, in order:
 * 1. Acquire a lease on every referenced asset, so garbage collection cannot remove them. A
 *    failed acquire (for example, collection removed an asset first) is returned as is; retry
 *    the backup.
 * 2. Under the lease, read every asset. All reads settle; the first failure in digest order is
 *    returned.
 * 3. Verify every asset's bytes against its digest. All checks settle; the first failure is
 *    returned.
 * 4. Pack and check the whole bundle against the backup schema and {@link BACKUP_JSON_LIMIT}.
 *    Nothing is ever truncated; a bundle that fails is `corrupt-record`.
 * 5. Release the lease, whatever happened. A failed release replaces the result.
 *
 * A successful result is never an incomplete backup. A throw or rejection from `acquire` is
 * not caught here; the public `backup` method's `protectAsync` turns it into
 * `storage-unavailable`. After any failure the maintenance host owns recovery: retry the backup.
 *
 * @param state - The workspace state, read in its own transaction.
 * @param resources - The Assets lease provider and verifier.
 * @returns The bundle; or the first failure of steps 1–4; or, when the release fails, the release
 * failure (it replaces a successful bundle or an earlier failure).
 */
export async function createBackup(
  state: WorkspaceState,
  resources: BackupResources,
): Promise<Result<BackupBundle>> {
  const acquired = await resources.acquire(reachableResources(state));
  if (!acquired.ok) {
    return acquired;
  }
  return withLease(acquired.value, () => copyUnderLease(state, acquired.value, resources.verify));
}

/** Reads, verifies and packs every referenced asset while the lease is held. */
async function copyUnderLease(
  state: WorkspaceState,
  lease: ResourceLease,
  verify: VerifyBlob,
): Promise<Result<BackupBundle>> {
  const collected = await collectBlobs(lease, reachableResources(state));
  if (!collected.ok) {
    return collected;
  }
  return verifyAndPack(state, collected.value, verify);
}

/**
 * Reads every digest, with all reads running together. Every read settles, even after one
 * fails, and the first failure in digest order is returned.
 */
async function collectBlobs(
  lease: ResourceLease,
  digests: readonly Digest[],
): Promise<Result<readonly BlobRecord[]>> {
  const results = await Promise.all(
    digests.map((digest) => protectAsync(() => readBlob(lease, digest))),
  );
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) {
    return failed;
  }
  return success(results.flatMap(blobOf));
}

/**
 * Reads one asset and checks it as a blob record (digest plus bounded base64). A failed read
 * is returned with its own recovery; a malformed record is `corrupt-record`.
 */
async function readBlob(
  lease: ResourceLease,
  digest: Digest,
): Promise<Result<BlobRecord>> {
  const bytes = await lease.read(digest);
  if (!bytes.ok) {
    return bytes;
  }
  return parse(blob, { digest, base64: bytes.value }, 'corrupt-record');
}

/** Verifies every blob, then packs the bundle. The caller releases the lease afterwards. */
async function verifyAndPack(
  state: WorkspaceState,
  blobs: readonly BlobRecord[],
  verify: VerifyBlob,
): Promise<Result<BackupBundle>> {
  const checked = await verifyResources(blobs, verify);
  if (!checked.ok) {
    return checked;
  }
  return packBackup(state, blobs);
}

/**
 * Copies and checks the whole bundle against the backup schema and {@link BACKUP_JSON_LIMIT}.
 * Any failure, including a throw, is `corrupt-record`.
 */
function packBackup(
  state: WorkspaceState,
  blobs: readonly BlobRecord[],
): Result<BackupBundle> {
  return protect(
    () =>
      parse(
        backupBundle,
        boundedClone({ schemaVersion: 1, state, blobs }, BACKUP_JSON_LIMIT),
        'corrupt-record',
      ),
    'corrupt-record',
  );
}

/** The blob of a successful read as a one-item list; a failed read gives an empty list. */
function blobOf(result: Result<BlobRecord>): readonly BlobRecord[] {
  if (result.ok) {
    return [result.value];
  }
  return [];
}
