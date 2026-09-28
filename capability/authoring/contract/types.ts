import type { Result } from './errors.js';
import type { Snapshot, Receipt } from './records/storage.js';
import type { Preparation } from './records/proposal.js';
import type { HistoryStatus } from './records/history.js';
import type { SnapshotReader, ReceiptReader, Committer } from './ports/store.js';
import type { IntentPlanner, CandidateValidator, Feasibility } from './ports/planning.js';
import type { ResourceAdmission } from './ports/resources.js';
import type { Hasher, Clock, Cancellation, Notifications } from './ports/runtime.js';

/**
 * The Authoring facade: the only way to change a workspace.
 *
 * Every method takes untrusted input, never throws, and returns a deeply frozen `Result`.
 * Consumers that only read never receive commit authority through a storage object.
 */
export interface Authoring {
  /**
   * Returns the workspace's undo/redo status.
   *
   * @param workspace - The untrusted workspace ID.
   * @returns The navigation version and the next undo and redo actions, or a failure:
   *   `invalid-input` for a malformed ID, or `corrupt-record` when stored history fails its checks.
   */
  history(workspace: unknown): Promise<Result<HistoryStatus>>;

  /**
   * Adds history to a workspace that has none, or checks and trims existing history.
   * Content records are never rewritten.
   *
   * @param workspace - The untrusted workspace ID.
   * @returns The undo/redo status, or a failure: `invalid-input` for a malformed ID, or
   *   `corrupt-record` when the adoption receipt and navigation disagree.
   */
  initializeHistory(workspace: unknown): Promise<Result<HistoryStatus>>;

  /**
   * Reads one checked, consistent workspace snapshot. Changes nothing.
   *
   * @param workspace - The untrusted workspace ID.
   * @returns The deeply frozen snapshot, or a failure: `invalid-input` for a malformed ID, or
   *   `corrupt-record` when the stored snapshot fails its checks.
   */
  read(workspace: unknown): Promise<Result<Snapshot>>;

  /**
   * Looks up a request's checked receipt. Needs no source files, aliases or draft.
   *
   * @param workspace - The untrusted workspace ID.
   * @param request - The untrusted request ID.
   * @returns The receipt, or `null` when no receipt is stored (the request has not committed, or its
   *   receipt has aged out of the bounded receipt log), or a failure: `invalid-input` for a malformed
   *   ID, or `corrupt-record` for a malformed or foreign receipt.
   */
  receipt(
    workspace: unknown,
    request: unknown,
  ): Promise<Result<Receipt | null>>;

  /**
   * Prepares a request without committing it, for review. Uses no revision.
   *
   * @param request - The untrusted request.
   * @param preview - `true` to ask the feasibility check for a preview. Defaults to `false`.
   * @returns The preparation, or the original receipt when the request already committed, or a
   *   failure: for example `invalid-input` when `preview` is not a boolean, `unsupported-version`,
   *   `permission-denied`, `revision-conflict`, `request-reused` or `cancelled`.
   */
  prepare(
    request: unknown,
    preview?: boolean,
  ): Promise<Result<Preparation | Receipt>>;

  /**
   * Commits a request of any intent kind as one atomic transaction.
   * A retry returns the original receipt; a lost acknowledgement is reconciled before returning.
   *
   * @param request - The untrusted request.
   * @param options - Untrusted apply options, for example the `candidateHash` from `prepare`.
   * @returns The receipt, or a failure: for example `revision-conflict` when a version or the
   *   candidate hash changed, `request-reused`, `permission-denied` or `cancelled`.
   */
  apply(
    request: unknown,
    options?: unknown,
  ): Promise<Result<Receipt>>;

  /**
   * Commits an undo request. Works like `apply`, but the intent must be `undo`.
   *
   * @param request - The untrusted undo request.
   * @param options - Untrusted apply options.
   * @returns The receipt, or a failure: `invalid-input` when the intent is not `undo`, or any `apply` failure.
   */
  undo(
    request: unknown,
    options?: unknown,
  ): Promise<Result<Receipt>>;

  /**
   * Commits a redo request. Works like `apply`, but the intent must be `redo`.
   *
   * @param request - The untrusted redo request.
   * @param options - Untrusted apply options.
   * @returns The receipt, or a failure: `invalid-input` when the intent is not `redo`, or any `apply` failure.
   */
  redo(
    request: unknown,
    options?: unknown,
  ): Promise<Result<Receipt>>;
}

/** The collaborators needed to plan and check a candidate. */
export interface PlanningDependencies {
  /** The registered change planners. */
  readonly planners: readonly IntentPlanner[];
  /** Validates the whole candidate workspace. */
  readonly validation: CandidateValidator;
  /** Checks the candidate's geometry. */
  readonly feasibility: Feasibility;
  /** Hashes request fingerprints and candidate hashes. */
  readonly hash: Hasher;
  /** Tells whether the caller cancelled a request. */
  readonly cancellation: Cancellation;
}

/** The collaborators needed to admit a request: planning, plus storage reads and resource leases. */
export interface AdmissionDependencies extends PlanningDependencies {
  /** Reads workspace snapshots. */
  readonly snapshots: SnapshotReader;
  /** Looks up stored receipts. */
  readonly receipts: ReceiptReader;
  /** Resolves and protects the resources a request needs. */
  readonly resources: ResourceAdmission;
}

/** Every collaborator Authoring needs: admission, plus committing, time and notifications. */
export interface Dependencies extends AdmissionDependencies {
  /** Commits storage transactions. */
  readonly commits: Committer;
  /** Timestamps transactions. */
  readonly clock: Clock;
  /** Publishes a hint after each commit. */
  readonly notifications: Notifications;
}
