import type { Request } from '../../contract/records/request.js';
import type { Snapshot, Write, ReadVersion } from '../../contract/records/storage.js';
import type { Proposal } from '../../contract/records/proposal.js';
import type { CandidateValidator } from '../../contract/ports/planning.js';
import { versionSchema } from '../../contract/records/storage.js';
import { checkProposal } from './dependencies.js';
import { netWrite, installWrites } from '../records/changes.js';
import { accepted, freeze } from '../validation/outcomes.js';
import { readShape } from '../validation/input.js';

/** A planned change, applied in memory and fully validated, but not yet stored. */
export interface Candidate {
  /** The workspace snapshot as it would be after the change. */
  readonly after: Snapshot;
  /** The normalized writes that produce `after`. Writes that change nothing are left out. */
  readonly changes: readonly Write[];
  /** The record versions the validator consulted while checking the change. */
  readonly reads: readonly ReadVersion[];
}

/**
 * Turns a planner's proposal into a validated candidate.
 *
 * Steps, in order:
 * 1. Check the proposal's writes are allowed for this request.
 * 2. Normalize each write (stamping document revisions) and drop writes that change nothing.
 * 3. Apply the writes to a copy of the snapshot.
 * 4. Validate the whole resulting snapshot, so validation sees exactly what would be stored.
 *
 * @param request - The checked submitted request.
 * @param before - The current workspace snapshot.
 * @param proposal - The planner's proposed writes.
 * @param validation - The domain validator for the whole candidate.
 * @returns The candidate snapshot, its writes, and the record versions the validator read.
 * @throws AuthoringFault `invalid-input` or `permission-denied` when the proposal's writes are not allowed.
 * @throws AuthoringFault `invalid-input` or `invariant-violation` when a write cannot be normalized.
 * @throws AuthoringFault with the validator's own diagnostic when validation fails.
 * @throws AuthoringFault `corrupt-record` when the validator returns a malformed record version.
 */
export async function createCandidate(
  request: Request,
  before: Snapshot,
  proposal: Proposal,
  validation: CandidateValidator,
): Promise<Candidate> {
  checkProposal(request, proposal.writes);
  const changes = proposal.writes.flatMap((write) => netWrite(before, write));
  const after = freeze(installWrites(before, changes));

  const validatorReads = accepted(
    await validation.validate(
      before,
      after,
      changes.map((write) => write.key),
    ),
  );
  const reads = validatorReads.map((read) => readShape(versionSchema, read, 'corrupt-record'));
  return { after, changes, reads };
}
