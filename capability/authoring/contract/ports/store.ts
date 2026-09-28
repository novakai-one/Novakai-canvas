import type { WorkspaceId, RequestId, Digest } from '../brands.js';
import type { Result } from '../errors.js';
import type { Receipt, Write, ReadVersion, CommitOutcome, RecordKey } from '../records/storage.js';

/** Reads raw workspace snapshots. Authoring alone checks their shape, identities and invariants. */
export interface SnapshotReader {
  /**
   * Reads the current snapshot of a workspace.
   *
   * Report expected problems as a failed `Result`. A thrown error or rejected promise is an
   * unexpected fault: the Authoring facade reports it as `storage-unavailable`.
   *
   * @param workspace - The workspace to read.
   * @returns One consistent, unchecked snapshot, or a failure.
   */
  read(workspace: WorkspaceId): Promise<Result<unknown>>;
}

/** Looks up stored receipts. A receipt stays valid after its source files are deleted or its aliases change. */
export interface ReceiptReader {
  /**
   * Looks up the receipt stored for a request.
   *
   * Report expected problems as a failed `Result`. A thrown error or rejected promise is an
   * unexpected fault: the Authoring facade reports it as `storage-unavailable`.
   *
   * @param workspace - The workspace the request belongs to.
   * @param request - The request ID.
   * @returns The stored receipt, `null` when the request has not committed, or a failure.
   */
  find(
    workspace: WorkspaceId,
    request: RequestId,
  ): Promise<Result<Receipt | null>>;
}

/**
 * Permanently removes a history record. Only Authoring writes these, and a purged record's key
 * is never used again.
 */
export interface PurgeWrite {
  readonly kind: 'purge';
  readonly key: RecordKey;
}

/** One storage transaction: conditional writes plus the request's receipt. */
export interface CommitRequest {
  /** The workspace to write. */
  readonly workspace: WorkspaceId;
  /** The request ID the receipt is stored under. */
  readonly request: RequestId;
  /** The request fingerprint stored in the receipt. */
  readonly fingerprint: Digest;
  /** Every record version that must still hold for the transaction to commit. */
  readonly expected: readonly ReadVersion[];
  /** The writes, applied together or not at all. */
  readonly writes: readonly (Write | PurgeWrite)[];
  /** The outcome stored in the receipt. */
  readonly outcome: CommitOutcome;
}

/**
 * Commits a storage transaction: compare versions, write, and store the receipt, all as one.
 *
 * When the promise settles, or the call throws, the transaction is final: an implementation must
 * never leave a remote write running after a timeout. The local service runs Persistence
 * synchronously behind this. When the acknowledgement is uncertain, Authoring reconciles through
 * the receipt store while resource leases are still held.
 */
export interface Committer {
  /**
   * Commits one storage transaction.
   *
   * After any failure (a failed `Result`, a thrown error or a rejected promise), Authoring looks up
   * the request's receipt. A stored receipt means the commit happened, and it is returned.
   * Otherwise the original failure is reported; the facade reports a thrown error as
   * `storage-unavailable`.
   *
   * @param request - The transaction to commit.
   * @returns The stored receipt, or a failure.
   */
  commit(request: CommitRequest): Promise<Result<Receipt>>;
}
