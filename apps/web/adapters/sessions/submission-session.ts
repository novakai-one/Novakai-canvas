import type {
  CarriedSnapshot,
  Submission,
  SubmissionBindings,
  SubmissionSession,
} from '../../contract/records/submission.js';
import type { Receipt } from '../../contract/records/owners.js';
import type { WorkspaceScope } from '../../contract/records/workspace-scope.js';
import type { TransportGeneration, WorkspaceId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import type { Diagnostic } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { wireOutcome } from '../../contract/foreign-failures.js';
import {
  blocksSubmission,
  submissionStatus,
  refused,
  inWorkspace,
  restoredWorkspace,
  unrestoredWorkspace,
} from '../../contract/api.js';

/** Durable browser recovery coordinates transmission only; Authoring remains the sole commit/idempotency authority.
 * Consumers keep drafts on every failure and call reconcile before an explicit retry.
 */
export function createSubmissionSession(bindings: SubmissionBindings): SubmissionSession {
  let scope: WorkspaceScope = unrestoredWorkspace;
  let pending: readonly Submission[] = [];
  const recovering = new Set<string>();
  /**
   * Save the recovery journal before publishing its immutable view. A proven refusal changed
   * nothing, so it is not kept across reload. With no restored workspace nothing is kept
   * (`recovery-unavailable`).
   */
  function retain(next: readonly Submission[]): Result<void> {
    if (scope.phase === 'unrestored')
      return failure('recovery-unavailable', 'No workspace is restored; the request was not kept');
    const stored = bindings.retention.write(
      `pending.${scope.workspace}`,
      next.filter((item) => item.state !== 'rejected'),
    );
    if (!stored.ok) return stored;
    publish(next);
    return { ok: true, value: undefined };
  }
  /** Status is ephemeral if storage fails after transmission; memory still retains the exact request. */
  function publish(next: readonly Submission[]): void {
    pending = next;
    bindings.changed(next);
  }
  /** Restore is read-only with respect to the service; interrupted sending is uncertain, never automatically replayed. */
  function restore(id: WorkspaceId): void {
    scope = restoredWorkspace(id);
    const stored = bindings.retention.read(`pending.${id}`);
    if (!stored.ok) {
      bindings.report(stored.error);
      return;
    }
    if (stored.value === null) return;
    restoreChecked(stored.value);
  }
  /** A recovery file for another workspace cannot gain access to this session's transport. */
  function restoreChecked(input: unknown): void {
    const result = bindings.readers.pending(input);
    if (!result.ok) {
      bindings.report(result.error);
      return;
    }
    const own = result.value.filter(
      (item) => inWorkspace(scope, item.request.workspace) && item.state !== 'rejected',
    );
    publish(own.map(recovered));
  }
  /** Reject overlapping work before writing or sending; creating another collection may proceed independently. */
  async function submit(input: Omit<Submission, 'state'>): Promise<Result<Receipt>> {
    if (!inWorkspace(scope, input.request.workspace))
      return failure('wrong-workspace', 'The request belongs to another workspace');
    if (blocksSubmission(pending, input.request))
      return failure(
        'pending-request',
        'Reconcile the pending edit before applying another edit to this collection',
      );
    return begin({ ...input, state: 'sending' });
  }
  /** The request journal is the prerequisite for transmission, including first-time creates. */
  async function begin(item: Submission): Promise<Result<Receipt>> {
    const retained = retain([...pending, item]);
    if (!retained.ok) return retained;
    return transmit(item, item.generation);
  }
  /** A transport failure or malformed success is uncertain. Neither permits clearing the journal or draft. */
  async function transmit(
    item: Submission,
    generation: TransportGeneration,
  ): Promise<Result<Receipt>> {
    const response = await bindings.client.post('/api/v1/authoring/apply', {
      version: 1,
      generation,
      request: item.request,
    });
    if (!response.ok) {
      mark(item, 'uncertain');
      return response;
    }
    return received(wireOutcome('authoring', response.value.outcome), item);
  }
  /** Even a typed rejection is reconciled before releasing its slot; a receipt may already exist after a lost earlier response. */
  function received(
    outcome: Result<unknown>,
    item: Submission,
  ): Result<Receipt> {
    if (!outcome.ok) {
      rejectOutcome(item, outcome.error);
      return outcome;
    }
    return readAppliedReceipt(outcome.value, item);
  }
  /** Proven owner refusal releases the collection slot; infrastructure uncertainty retains it. */
  function rejectOutcome(
    item: Submission,
    problem: Diagnostic,
  ): void {
    const status = refused(problem) ? 'rejected' : 'uncertain';
    mark(item, status);
  }
  /** Decode a claimed success through Authoring before clearing any local state; it must carry its receipt and workspace. */
  function readAppliedReceipt(
    input: unknown,
    item: Submission,
  ): Result<Receipt> {
    const appliedCommit = bindings.readers.applied(input, item.request);
    if (!appliedCommit.ok) {
      mark(item, 'uncertain');
      return appliedCommit;
    }
    complete(item, appliedCommit.value.receipt, appliedCommit.value.carried);
    return { ok: true, value: appliedCommit.value.receipt };
  }
  /** Confirmation releases its slot even when journal cleanup fails; a later recovery lookup is idempotent. */
  function complete(
    item: Submission,
    receipt: Receipt,
    carriedSnapshot?: CarriedSnapshot,
  ): void {
    const remaining = pending.filter((other) => other.request.request !== item.request.request);
    const saved = retain(remaining);
    if (!saved.ok) {
      publish(remaining);
      bindings.report(saved.error);
    }
    bindings.confirmed(item, receipt, carriedSnapshot);
  }
  /** Persist status transitions without changing the immutable semantic request. */
  function mark(
    item: Submission,
    state: Submission['state'],
  ): void {
    const next = submissionStatus(pending, item.request.request, state);
    const saved = retain(next);
    if (!saved.ok) {
      publish(next);
      bindings.report(saved.error);
    }
  }
  /** Lookup is scoped to a retained request; arbitrary receipt IDs cannot clear another draft. */
  async function reconcile(id: string): Promise<Result<Receipt | null>> {
    const item = pending.find((item) => item.request.request === id);
    if (!item) return failure('unknown-request', 'There is no retained request with this ID');
    if (occupied(item)) return failure('pending-request', 'Wait for the current request to settle');
    return lookup(item);
  }
  /** Receipt lookup never sends a mutation. A missing receipt leaves an explicit retry/correction choice. */
  async function lookup(item: Submission): Promise<Result<Receipt | null>> {
    const response = await bindings.client.get(
      `/api/v1/receipt?id=${encodeURIComponent(item.request.request)}`,
    );
    if (!response.ok) return response;
    const outcome = wireOutcome('authoring', response.value.outcome);
    if (!outcome.ok) return outcome;
    return lookedUp(outcome.value, item);
  }
  /** Confirmed and absent outcomes are distinct; absence cannot be called Saved. */
  function lookedUp(
    input: unknown,
    item: Submission,
  ): Result<Receipt | null> {
    const receipt = bindings.readers.receipt(input, item.request);
    if (!receipt.ok) return receipt;
    if (receipt.value === null) {
      markAbsentReceipt(item);
      return receipt;
    }
    complete(item, receipt.value);
    return receipt;
  }
  /** Receipt absence does not turn a proven refusal back into a blocking uncertain operation. */
  function markAbsentReceipt(item: Submission): void {
    if (item.state !== 'rejected') mark(item, 'retryable');
  }
  /** Explicit retry rechecks the receipt first, then resends the exact body under the current transport generation. */
  async function retry(
    id: string,
    generation: TransportGeneration,
  ): Promise<Result<Receipt>> {
    const item = pending.find((item) => item.request.request === id);
    if (!item) return failure('unknown-request', 'There is no retained request with this ID');
    if (occupied(item))
      return failure('pending-request', 'This request is still being transmitted');
    return recoverExclusively(item, generation);
  }
  /** Reconnect changes authentication generation, never the semantic request's identity or captured preconditions. */
  async function retryChecked(
    item: Submission,
    generation: TransportGeneration,
  ): Promise<Result<Receipt>> {
    const receipt = await lookup(item);
    if (!receipt.ok) return receipt;
    if (receipt.value !== null) return { ok: true, value: receipt.value };
    mark(item, 'sending');
    return transmit(item, generation);
  }
  /** Hold the recovery slot across lookup and transmission; rapid retry clicks cannot start a second request. */
  async function recoverExclusively(
    item: Submission,
    generation: TransportGeneration,
  ): Promise<Result<Receipt>> {
    recovering.add(item.request.request);
    try {
      return await retryChecked(item, generation);
    } finally {
      recovering.delete(item.request.request);
    }
  }
  /** A lookup in progress is still active recovery, even before transmission starts. */
  function occupied(item: Submission): boolean {
    return item.state === 'sending' || recovering.has(item.request.request);
  }
  /** Only a proven refusal can be dismissed. Uncertain edits retain their request and recovery path. */
  function dismiss(id: string): Result<void> {
    const item = pending.find((entry) => entry.request.request === id);
    if (!item) return failure('unknown-request', 'There is no retained request with this ID');
    if (item.state !== 'rejected')
      return failure('confirmation-required', 'Reconcile this edit before clearing it');
    return retain(pending.filter((entry) => entry.request.request !== id));
  }
  return { restore, submit, reconcile, retry, dismiss };
}

/** Interrupted states need a receipt lookup; proven refusals were already dropped from the journal. */
function recovered(item: Submission): Submission {
  return { ...item, state: 'uncertain' };
}
