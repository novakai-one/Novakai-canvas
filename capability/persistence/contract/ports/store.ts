import type { Result } from '../errors.js';
import type { WorkspaceState } from '../records/storage.js';

/**
 * A successful decision: the state to install and the value to return to the caller.
 * Only a successful decision is installed, atomically; for everything else the adapter attempts a
 * rollback.
 */
export interface Decision<T> {
  /** The state to install. Handing back the state that was read installs nothing. */
  readonly state: WorkspaceState;
  /** The value returned to the caller once the state is committed. */
  readonly value: T;
}

/**
 * The narrow storage seam the Persistence service runs on (implemented by the SQLite adapter).
 */
export interface StorePort {
  /**
   * Runs one synchronous decision inside one storage transaction.
   *
   * `decide` receives the raw stored value, which may be damaged, and must validate it before
   * use. A successful decision's state is installed and its value returned; after a failure a
   * rollback is attempted and the failure returned.
   *
   * The outcome can be uncertain: a rollback that fails replaces the failure with
   * `storage-unavailable`, and a COMMIT whose acknowledgement fails may still have been installed.
   * Authoring owns reconciliation: reopen and look up the request's receipt.
   *
   * @param decide - Validates the raw state and returns the decision.
   * @returns The decision's value, or a typed failure. Never throws.
   */
  transact<T>(decide: (raw: unknown) => Result<Decision<T>>): Result<T>;
  /**
   * Closes the underlying database.
   *
   * @returns Success, or `storage-unavailable` when the close failed.
   */
  close(): Result<void>;
}
