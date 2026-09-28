import type { Result } from './errors.js';
import type { WorkspaceState, Receipt } from './records/storage.js';
import type { BackupBundle } from './records/backup.js';
import type { BackupResources, RestoreResources, ValidateDomain } from './ports/resources.js';

/**
 * The Persistence service for one workspace, created by `openSqlite` or `createPersistence`.
 *
 * Persistence alone runs physical transactions. Authoring owns admission (what a change may
 * contain) and receipt reconciliation after an uncertain commit. Every method returns a typed
 * result and never throws. Data Persistence produces is detached and frozen; a failure returned
 * by an injected provider is passed on as the same object (frozen in place, not copied).
 */
export interface Persistence {
  /**
   * Reads one consistent, validated workspace state.
   *
   * @returns The frozen state, or a failure (`corrupt-record`, `unsupported-version`,
   * `storage-unavailable`).
   */
  readSnapshot(): Result<WorkspaceState>;
  /**
   * Checks and commits one request atomically.
   *
   * While the request's receipt is kept (the newest 1,000 receipts, see `RECEIPT_LIMIT`), a retry
   * with the same ID and fingerprint returns the original receipt, and the same ID with a
   * different fingerprint is `request-reused`. Once the receipt is dropped, the request is
   * checked as a new one.
   *
   * @param input - The untrusted commit request.
   * @returns The new receipt, the original receipt for a retry, or a failure.
   */
  commit(input: unknown): Result<Receipt>;
  /**
   * Looks up the kept receipt for a request ID.
   *
   * @param request - The untrusted request ID.
   * @returns The receipt, or `null` when none is kept.
   */
  receipt(request: unknown): Result<Receipt | null>;
  /**
   * Copies one consistent state and the asset bytes it references into a verified bundle.
   *
   * @param resources - Leases and verifies the asset bytes.
   * @returns The bundle, or the first failure.
   */
  backup(resources: BackupResources): Promise<Result<BackupBundle>>;
  /**
   * Checks a bundle, validates its documents with `validateDomain`, stages its assets and
   * installs it into this location, which must never have been committed to. The host decides
   * when to switch to the restored location.
   *
   * A reported failure can follow the install (for example, a failed reservation release). After
   * any failure the maintenance host must reopen and inspect the destination before retrying or
   * activating it.
   *
   * @param input - The untrusted backup bundle.
   * @param resources - Reserves, stages and verifies the asset bytes at the destination.
   * @param validateDomain - Validates the restored documents.
   * @returns Success, or the first failure.
   */
  restore(
    input: unknown,
    resources: RestoreResources,
    validateDomain: ValidateDomain,
  ): Promise<Result<void>>;
  /**
   * Closes the database. Later calls that reach storage fail with `storage-unavailable`; input is
   * still checked first, so an invalid request is `invalid-input` even after close.
   */
  close(): Result<void>;
}
