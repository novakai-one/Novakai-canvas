import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { Decision } from '../../contract/ports/store.js';
import type { Receipt, WorkspaceState } from '../../contract/records/storage.js';
import type { CommitRequest, Write } from '../../contract/records/transaction.js';
import { protect, success } from '../validation/outcomes.js';
import { validateState } from '../validation/state.js';
import { keyText } from './keys.js';
import { reconcileReceipt } from './receipts.js';
import { RECEIPT_LIMIT } from './limits.js';
import { compareVersions, checkWrites, writeSlot } from './versions.js';
import type { SlotWrite } from './versions.js';

/**
 * Decides what one commit request does to the workspace state, without touching storage.
 *
 * Steps, in order:
 * 1. Receipt check ({@link reconcileReceipt}). A request ID used with a different fingerprint
 *    fails with `request-reused`. A retry of a committed request returns the unchanged state and
 *    its original receipt, before any version check.
 * 2. Gates, in order: observed versions (`revision-conflict`), write rules (`invalid-input`,
 *    path `writes`), and workspace sequence exhaustion (`invalid-input`, path `sequence`).
 * 3. The new state and receipt, built together and validated as a whole ({@link validateState}).
 *    A candidate that fails validation returns that validation failure (for example
 *    `corrupt-record`). A candidate that throws while being validated fails with `invalid-input`.
 *
 * A failure never returns a partial state and never allocates a receipt. The SQLite adapter
 * installs a successful decision atomically; Authoring owns reconciliation when the outcome of a
 * commit is uncertain.
 *
 * @param state - The parsed workspace state read inside the storage transaction.
 * @param request - The parsed commit request.
 * @returns The state to install and the receipt to return, or the first failure.
 */
export function planCommit(
  state: WorkspaceState,
  request: CommitRequest,
): Result<Decision<Receipt>> {
  const reconciled = reconcileReceipt(state, request);
  if (!reconciled.ok) {
    return reconciled;
  }
  if (reconciled.value) {
    return success({ state, value: reconciled.value });
  }
  return admitCommit(state, request);
}

/**
 * The checks a new request must pass before its commit is built, in reporting order.
 * Every gate runs; the first failure is reported. A new independent check is added here.
 */
const commitGates: readonly ((state: WorkspaceState, request: CommitRequest) => Result<void>)[] = [
  (state, request) => compareVersions(state, request.expected),
  (state, request) => checkWrites(state, request.writes),
  (state) => checkSequence(state),
];

/** Runs every gate, returns the first failure, and otherwise builds the commit. */
function admitCommit(
  state: WorkspaceState,
  request: CommitRequest,
): Result<Decision<Receipt>> {
  const results = commitGates.map((gate) => gate(state, request));
  const failure = results.find(isFailure);
  if (failure !== undefined) {
    return failure;
  }
  return createCommit(state, request);
}

/** Fails once the workspace sequence cannot count another commit. */
function checkSequence(state: WorkspaceState): Result<void> {
  if (state.sequence === Number.MAX_SAFE_INTEGER) {
    return fail('invalid-input', 'sequence', 'Workspace sequence exhausted');
  }
  return success(undefined);
}

/**
 * Builds the new state and the receipt together, then validates the new state. A validation
 * failure is returned as is; a throw during validation becomes `invalid-input`.
 *
 * - Puts and deletes get a new slot each; purges get none.
 * - Every written record's old slot is removed. Untouched slots keep their order, and new slots
 *   are added at the end.
 * - The receipt lists each new slot's version, then `'absent'` for each purged record.
 * - Only the newest {@link RECEIPT_LIMIT} receipts are kept.
 */
function createCommit(
  state: WorkspaceState,
  request: CommitRequest,
): Result<Decision<Receipt>> {
  const kept = request.writes.filter(createsSlot);
  const replacements = kept.map((write) => writeSlot(state, write));
  const removed = new Set(request.writes.map((write) => keyText(write.key)));
  const retained = state.slots.filter((slot) => !removed.has(keyText(slot.key)));
  const purged = request.writes.filter((write) => write.kind === 'purge');
  const receipt: Receipt = {
    request: request.request,
    fingerprint: request.fingerprint,
    sequence: state.sequence + 1,
    versions: [
      ...replacements.map((slot) => ({ key: slot.key, version: slot.version })),
      ...purged.map((write) => ({ key: write.key, version: 'absent' as const })),
    ],
    outcome: request.outcome,
  };
  const candidate = {
    ...state,
    sequence: receipt.sequence,
    slots: [...retained, ...replacements],
    receipts: [...state.receipts, receipt].slice(-RECEIPT_LIMIT),
  };
  const validated = protect(() => validateState(candidate), 'invalid-input');
  if (!validated.ok) {
    return validated;
  }
  return success({ state: validated.value, value: receipt });
}

/** True for a put or a delete: the writes that get a new slot. */
function createsSlot(write: Write): write is SlotWrite {
  return write.kind !== 'purge';
}

/** True for a failed result. */
function isFailure(result: Result<void>): result is Extract<Result<void>, { ok: false }> {
  return !result.ok;
}
