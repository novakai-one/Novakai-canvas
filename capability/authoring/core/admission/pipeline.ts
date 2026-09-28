import { jsonSchema } from '../../contract/records/storage.js';
import type { Request } from '../../contract/records/request.js';
import type { RecordKey, Snapshot } from '../../contract/records/storage.js';
import type { Digest } from '../../contract/brands.js';
import { digest } from '../../contract/brands.js';
import type { PlanningDependencies } from '../../contract/types.js';
import type { ResourceLease } from '../../contract/ports/resources.js';
import {
  proposalSchema,
  leaseDataSchema,
  feasibilitySchema,
} from '../../contract/records/proposal.js';
import type {
  PreparedCandidate,
  FeasibilityReport,
  Preparation,
} from '../../contract/records/proposal.js';
import { navigationDependencies } from '../history/navigation.js';
import { planIntent } from './registry.js';
import { createCandidate } from './candidate.js';
import type { Candidate } from './candidate.js';
import { checkDependencies } from './dependencies.js';
import { checkCoverage } from './resources.js';
import { readShape } from '../validation/input.js';
import { accepted, freeze, reject } from '../validation/outcomes.js';
import { canonical } from '../identity/canonical.js';

/** The data a resource lease provides, without its `release` method. */
type LeaseData = Pick<ResourceLease, 'pins' | 'reads' | 'covered'>;

/** The parts of a preparation that the candidate hash covers. */
type HashedPreparation = Omit<Preparation, 'candidateHash' | 'preview'>;

/**
 * Rejects the request when the caller has cancelled it.
 *
 * Authoring checks this only before admission and before commit. A committed or recovered
 * receipt always wins over a cancellation.
 *
 * @param request - The checked submitted request.
 * @param cancellation - The cancellation role.
 * @returns Nothing when the request is not cancelled.
 * @throws AuthoringFault `cancelled` when the request was cancelled.
 * @throws The cancellation role's own error, unchanged, when it throws. The public boundary
 *   (`protect` in `contract/api.ts`) turns it into a failed `Result`.
 */
export function checkCancellation(
  request: Request,
  cancellation: PlanningDependencies['cancellation'],
): void {
  if (cancellation.cancelled(request.request))
    reject('cancelled', 'request', 'Request was cancelled before commit');
}

/**
 * Plans a request and runs every admission check on the result, producing a commit-ready candidate.
 *
 * Steps, in order:
 * 1. Check for cancellation.
 * 2. Read the lease's pins, reads and protected resources.
 * 3. Plan the intent and check the proposal's shape.
 * 4. Apply and validate the proposed writes (`createCandidate`).
 * 5. Merge every read dependency and check it against the snapshot.
 * 6. Check the lease protects every resource the writes need.
 * 7. Check geometry feasibility.
 * 8. Check for cancellation again.
 * 9. Hash the preparation, so `apply` can later confirm nothing changed.
 *
 * Planners cannot skip steps 4 to 7.
 *
 * @param request - The checked submitted request.
 * @param fingerprint - The fingerprint of the submitted request.
 * @param before - The current, checked workspace snapshot.
 * @param lease - The held resource lease.
 * @param preview - `true` to ask the feasibility check for a preview.
 * @param deps - The planning collaborators.
 * @returns The deeply frozen candidate: snapshots before and after, and the preparation to return or commit.
 * @throws AuthoringFault from any step above.
 * @throws A collaborator's own error, unchanged, when the cancellation role, a planner, validator,
 *   feasibility check or hasher
 *   throws. The public boundary (`protect` in `contract/api.ts`) turns it into a failed `Result`.
 */
export async function buildCandidate(
  request: Request,
  fingerprint: Digest,
  before: Snapshot,
  lease: LeaseData,
  preview: boolean,
  deps: PlanningDependencies,
): Promise<PreparedCandidate> {
  checkCancellation(request, deps.cancellation);
  const leaseData = readLeaseData(lease);
  const planned = await planIntent(request, before, leaseData.pins, deps.planners);
  const proposal = readShape(proposalSchema, planned, 'corrupt-record');
  const candidate = await createCandidate(request, before, proposal, deps.validation);

  const reads = checkDependencies(before, [
    request.expected,
    navigationDependencies(before),
    leaseData.reads,
    proposal.reads,
    candidate.reads,
  ]);
  checkCoverage(before, candidate.changes, leaseData.covered);
  const geometry = await checkFeasibility(candidate, preview, deps.feasibility);
  checkCancellation(request, deps.cancellation);

  // `preparation` below copies these fields, so this key order is the order callers see.
  const hashed: HashedPreparation = {
    fingerprint,
    reads,
    changes: candidate.changes,
    pins: leaseData.pins,
    diff: { semantic: proposal.diff, geometry: geometry.diff },
    warnings: [...proposal.warnings, ...geometry.warnings],
  };
  const candidateHash = hashPreparation(hashed, deps);
  const preparation: Preparation = { ...hashed, candidateHash, preview: geometry.preview };
  return freeze({ before, after: candidate.after, preparation });
}

/** Copies and checks the lease's data. */
function readLeaseData(lease: LeaseData): LeaseData {
  const leaseFields = { pins: lease.pins, reads: lease.reads, covered: lease.covered };
  return readShape(leaseDataSchema, leaseFields, 'corrupt-record');
}

/**
 * Checks geometry feasibility of the changed records. Hard constraints are always checked.
 * A candidate with no changes has no new geometry, so it gets an empty report without a check.
 */
async function checkFeasibility(
  candidate: Candidate,
  preview: boolean,
  feasibility: PlanningDependencies['feasibility'],
): Promise<FeasibilityReport> {
  if (candidate.changes.length === 0) return { warnings: [], diff: [], preview: null };

  const report = accepted(
    await feasibility.check(candidate.after, changedKeysOf(candidate), preview),
  );
  return readShape(feasibilitySchema, report, 'corrupt-record');
}

/**
 * Hashes the canonical text of the preparation's hashed parts.
 * The hashed parts are checked and written as text before the hasher is looked up on `deps`.
 */
function hashPreparation(
  hashed: HashedPreparation,
  deps: PlanningDependencies,
): Digest {
  const hashInput = readShape(jsonSchema, hashed, 'corrupt-record');
  const canonicalText = canonical(hashInput);
  const hashedText = accepted(deps.hash.digest(canonicalText));
  return readShape(digest, hashedText, 'corrupt-record');
}

/** Lists the keys of the records a candidate changes. */
function changedKeysOf(candidate: Candidate): RecordKey[] {
  return candidate.changes.map((write) => write.key);
}
