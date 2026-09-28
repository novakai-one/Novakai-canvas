import type { Collection } from '../../contract/records/collection.js';
import type { Result } from '../../contract/errors.js';
import type { ChangePlan } from '../../contract/types.js';
import { validateCollection } from '../invariants/validate.js';
import { failure, success } from '../invariants/issues.js';
import { freeze } from '../invariants/freeze.js';
import { stageChanges } from './stage.js';
import { describeImpact } from './impact.js';

/**
 * Plans an ordered change batch against a snapshot. Published as Model's `plan`. Steps, stopping
 * at the first failure and returning its diagnostics:
 * 1. validate the snapshot as a collection (see `validateCollection`);
 * 2. stage the changes on the validated snapshot (see `stageChanges`: it validates that snapshot
 *    again, then inspects and parses the changes, at most 1,000, then applies them in order);
 * 3. validate the staged candidate as a whole collection.
 *
 * Changes may break references for a while, as long as the final candidate is valid. The
 * revision is never incremented, the inputs are not changed and nothing is written. A throw that
 * escapes these steps (for example from a proxy trap) becomes `shape` at `changes`, "Input could
 * not be read as plain data".
 *
 * Pure: the same inputs give the same plan. Authoring owns admission, the revision increment,
 * commit and crash recovery.
 *
 * @param snapshot - The current collection data.
 * @param changes - The ordered changes.
 * @returns The valid candidate and its net impact (see `describeImpact`), or `validation-failed`.
 * Either outcome is deeply frozen.
 * @throws Never.
 */
export function planChanges(
  snapshot: unknown,
  changes: unknown,
): Result<ChangePlan> {
  try {
    return freeze(validateFinalCandidate(snapshot, changes));
  } catch {
    return freeze(failure('shape', 'changes', 'Input could not be read as plain data'));
  }
}

/**
 * Validates the snapshot, stages the changes, then validates the candidate. Staging uses exactly
 * the same rules as `stage`; only the final check turns a staged candidate into a plan.
 */
function validateFinalCandidate(
  snapshot: unknown,
  changes: unknown,
): Result<ChangePlan> {
  const before = validateCollection(snapshot);
  if (!before.ok) {
    return before;
  }
  const staged = stageChanges(before.value, changes);
  if (!staged.ok) {
    return staged;
  }
  return finalizeCandidate(before.value, staged.value.candidate);
}

/**
 * Validates the staged candidate as a whole collection and, when valid, adds its net impact.
 * Staging success never implies validity.
 */
function finalizeCandidate(
  before: Collection,
  unchecked: Collection,
): Result<ChangePlan> {
  const candidate = validateCollection(unchecked);
  if (!candidate.ok) {
    return candidate;
  }
  return success({ candidate: candidate.value, impact: describeImpact(before, candidate.value) });
}
