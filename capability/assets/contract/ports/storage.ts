import type { Digest, LeaseId } from '../brands.js';
import type { Result } from '../errors.js';
import type { StoredBlob } from '../records/media.js';
import type { LeaseRecord } from '../records/lease.js';

/**
 * Raw reads and writes available inside one storage transaction. Values read are unchecked
 * (`unknown`); core checks them with the record schemas. Methods may throw; the storage adapter
 * turns a throw into a failure and rolls the transaction back.
 */
export interface AssetTransaction {
  /** Reads a blob as `{ descriptor, base64 }`, or `null` when its metadata or bytes are missing. */
  readBlob(digest: Digest): unknown | null;
  /** Writes a blob's bytes, then its descriptor. */
  writeBlob(blob: StoredBlob): void;
  /** Lists every digest that has metadata or a file, sorted, without duplicates. */
  listBlobs(): readonly Digest[];
  /** Deletes a blob's file, then its metadata. */
  deleteBlob(digest: Digest): void;
  /** Reads a stored lease, or `null` when there is none. */
  readLease(id: LeaseId): unknown | null;
  /** Writes a lease, replacing any lease with the same ID. */
  writeLease(lease: LeaseRecord): void;
  /** Lists every stored lease, unchecked. */
  listLeases(): readonly unknown[];
  /** Deletes a lease. Deleting a missing lease is not an error. */
  deleteLease(id: LeaseId): void;
}

/**
 * Transactional storage for blobs and leases. Metadata and lease changes commit only when the
 * transaction's action succeeds. Blob files are immutable and are not rolled back: a failed
 * transaction can leave an unreferenced file, and a file deleted inside it stays deleted.
 * Collection (`collectUnreferenced`) removes such leftover files.
 */
export interface AssetStorage {
  /**
   * Runs `action` in one serialized transaction. A failed result or a throw rolls metadata back.
   *
   * @param action - The work to do with the transaction's reads and writes.
   * @returns The action's result. A throw becomes a failure (a `StorageFault` keeps its code,
   * path and message; anything else is `storage-unavailable`). A failed rollback is
   * `storage-unavailable`.
   * @throws Only when checking a thrown value itself throws (for example a thrown Proxy whose traps
   * throw); then no rollback runs. Otherwise the real adapter returns failures. The Assets facade's
   * `protect` turns such a throw into `storage-unavailable`.
   */
  transact<T>(action: (transaction: AssetTransaction) => Result<T>): Result<T>;
  /**
   * Closes storage. Later transactions fail with `storage-unavailable`.
   *
   * @returns Success, or the close failure.
   * @throws Only when checking a thrown value itself throws, as for `transact`. The Assets facade's
   * `protect` turns such a throw into `storage-unavailable`.
   */
  close(): Result<void>;
}
