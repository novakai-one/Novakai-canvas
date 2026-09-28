import type { Collection } from '../../contract/records/collection.js';
import { changesSchema, type Change } from '../../contract/records/change.js';
import type { Result } from '../../contract/errors.js';
import type { ChangeStage } from '../../contract/types.js';
import { validateCollection } from '../invariants/validate.js';
import { shapeErrors } from '../invariants/shape-diagnostics.js';
import { inspectInput } from '../invariants/input.js';
import { failure, success, rejected } from '../invariants/issues.js';
import { freeze } from '../invariants/freeze.js';
import { applyOperation } from './operations.js';

/**
 * Stages a change batch without the final validity check, for the language compiler. Published
 * as Model's `stage`. Steps, stopping at the first failure and returning its diagnostics:
 * 1. validate the snapshot as a collection (see `validateCollection`); a valid snapshot is
 *    always required;
 * 2. inspect the changes as plain JSON data (see `inspectInput`);
 * 3. parse them with the changes schema (at most 1,000 changes; every schema issue is reported,
 *    see `shapeErrors`);
 * 4. apply them in order (see `applyOperation`), stopping at the first failing change; later
 *    changes are not applied to a failed prefix.
 *
 * The candidate's references may be unresolved; only `plan` proves validity. Steps 1 and 2 turn
 * their own throws into failures and reject accessors before they run; a throw that still
 * escapes (for example from a proxy trap during parsing or applying) becomes `shape` at
 * `changes`, "Input could not be read as plain data".
 *
 * Pure: no revision is allocated and nothing is written. Language owns correcting syntax;
 * Authoring owns final admission, commit and crash recovery.
 *
 * @param snapshot - The current collection data.
 * @param changes - The ordered changes.
 * @returns `{ validity: 'unchecked', candidate, changes }` with the candidate and the parsed
 * (detached) changes, or `validation-failed`. Either outcome is deeply frozen.
 * @throws Never.
 */
export function stageChanges(
  snapshot: unknown,
  changes: unknown,
): Result<ChangeStage> {
  try {
    return freeze(inspectStageInputs(snapshot, changes));
  } catch {
    return freeze(failure('shape', 'changes', 'Input could not be read as plain data'));
  }
}

/** Validates the snapshot, then inspects the changes as plain data, then applies them. */
function inspectStageInputs(
  snapshot: unknown,
  changes: unknown,
): Result<ChangeStage> {
  const before = validateCollection(snapshot);
  if (!before.ok) {
    return before;
  }
  const inspected = inspectInput(changes);
  if (!inspected.ok) {
    return inspected;
  }
  return applyCheckedChanges(before.value, changes);
}

/**
 * Parses the changes once with the changes schema, then applies them in order to the snapshot.
 * Returns the unchecked candidate with the parsed changes.
 */
function applyCheckedChanges(
  before: Collection,
  changes: unknown,
): Result<ChangeStage> {
  const parsed = changesSchema.safeParse(changes);
  if (!parsed.success) {
    return rejected(shapeErrors(parsed.error.issues));
  }
  const applied = parsed.data.reduce(applyNextOperation, success(before));
  if (!applied.ok) {
    return applied;
  }
  return success({ validity: 'unchecked', candidate: applied.value, changes: parsed.data });
}

/** Applies one change to the result so far; once a change has failed, keeps that failure. */
function applyNextOperation(
  current: Result<Collection>,
  change: Change,
): Result<Collection> {
  if (!current.ok) {
    return current;
  }
  return applyOperation(current.value, change);
}
