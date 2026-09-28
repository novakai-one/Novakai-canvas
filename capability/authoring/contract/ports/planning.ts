import type { PlannerId } from '../brands.js';
import type { Result } from '../errors.js';
import type { Request } from '../records/request.js';
import type { Snapshot, Json, RecordKey, ReadVersion } from '../records/storage.js';
import type { Proposal, FeasibilityReport } from '../records/proposal.js';

/**
 * Plans the writes for one kind of change intent.
 *
 * Planners are registered by trusted composition (for example Model or Library planning).
 * A submitted payload is only data; it never runs code.
 */
export interface IntentPlanner {
  /** The ID a change intent names to select this planner. */
  readonly id: PlannerId;
  /**
   * Proposes the writes for a request.
   *
   * @param request - The checked submitted request.
   * @param snapshot - The current workspace snapshot.
   * @param pins - The resource pins resolved for this request.
   * @returns The proposed writes, reads, diff and warnings, or a failure.
   */
  plan(
    request: Request,
    snapshot: Snapshot,
    pins: Json,
  ): Promise<Result<Proposal>>;
}

/**
 * Validates a whole candidate workspace against the domain rules.
 */
export interface CandidateValidator {
  /**
   * Checks the workspace as it would be after the change.
   *
   * @param before - The workspace before the change.
   * @param after - The workspace after the change.
   * @param changed - The keys of the records the change writes.
   * @returns Every record version the check consulted, including catalog membership, or a failure.
   */
  validate(
    before: Snapshot,
    after: Snapshot,
    changed: readonly RecordKey[],
  ): Promise<Result<readonly ReadVersion[]>>;
}

/**
 * Checks that a candidate's geometry is feasible.
 *
 * Hard constraints are always checked, even when no preview is asked for. Warnings never make
 * invalid geometry acceptable.
 */
export interface Feasibility {
  /**
   * Checks the changed records' geometry.
   *
   * @param candidate - The workspace as it would be after the change.
   * @param changed - The keys of the records the change writes.
   * @param preview - `true` to also return a preview image.
   * @returns Warnings, a geometry diff and an optional preview, or a failure.
   */
  check(
    candidate: Snapshot,
    changed: readonly RecordKey[],
    preview: boolean,
  ): Promise<Result<FeasibilityReport>>;
}
