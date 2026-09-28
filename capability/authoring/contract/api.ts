import { workspaceId, requestId } from './brands.js';
import type { Request } from './records/request.js';
import type { Authoring, Dependencies } from './types.js';
import type { Result } from './errors.js';
import type { Snapshot, Receipt } from './records/storage.js';
import type { Preparation } from './records/proposal.js';
import type { HistoryStatus } from './records/history.js';
import { readShape, readRequest, readOptions } from '../core/validation/input.js';
import { readSnapshot, readReceipt } from '../core/validation/snapshot.js';
import { accepted, protect, reject } from '../core/validation/outcomes.js';
import { validateRegistry } from '../core/admission/registry.js';
import { withCandidate } from '../core/admission/prepare.js';
import { historyStatus } from '../core/history/navigation.js';
import { initializeHistory as adoptHistory } from '../core/history/adoption.js';
import { applyCandidate } from '../core/transactions/apply.js';

/** The intent kind an operation requires, or `null` when any kind is accepted. */
type RequiredKind = Request['intent']['kind'] | null;

/**
 * Creates the Authoring facade: the only way to read, prepare, apply, undo and redo workspace changes.
 *
 * Creating it does no I/O. The planner registrations are checked once here; when they are invalid,
 * every operation returns that failure.
 *
 * Every operation takes untrusted input and returns a deeply frozen `Result`; it never throws.
 * Authoring owns receipt reconciliation, atomic admission and undo/redo. The caller owns
 * transport authentication, a durable outbox, and keeping drafts it can recover.
 *
 * @param deps - Authoring's collaborators.
 * @returns The frozen facade.
 * @throws Any error thrown while reading `deps.planners` or a planner's `id` during creation (for
 *   example from a getter), unchanged. This is the only error creation can throw: malformed or
 *   repeated planner IDs do not throw, and every operation returns that failure instead.
 */
export function createAuthoring(deps: Dependencies): Authoring {
  const registration = validateRegistry(deps.planners);

  /** Reads one checked, consistent workspace snapshot. Changes nothing. */
  function read(workspace: unknown): Promise<Result<Snapshot>> {
    // Check the registration and ID, then read and check the snapshot.
    return protect(async () => {
      accepted(registration);
      const id = readShape(workspaceId, workspace);
      const storedSnapshot = accepted(await deps.snapshots.read(id));
      return readSnapshot(storedSnapshot, id);
    }, 'authoring-read');
  }

  /** Looks up a request's checked receipt, or `null`. Needs no source files, aliases or draft. */
  function receipt(
    workspace: unknown,
    request: unknown,
  ): Promise<Result<Receipt | null>> {
    // Check the registration and both IDs, then look up and check the receipt.
    return protect(async () => {
      accepted(registration);
      const id = readShape(workspaceId, workspace);
      const transaction = readShape(requestId, request);
      const storedReceipt = accepted(await deps.receipts.find(id, transaction));
      if (storedReceipt === null) return null;
      return readReceipt(storedReceipt, transaction);
    }, 'authoring-receipt');
  }

  /**
   * Prepares a request without committing it, and returns the preparation to review.
   * Uses no revision. When the request already committed, returns its original receipt instead.
   */
  function prepare(
    input: unknown,
    preview = false,
  ): Promise<Result<Preparation | Receipt>> {
    // Check the registration, request and flag, then build the candidate and return its preparation.
    return protect(async () => {
      accepted(registration);
      const request = readRequest(input);
      if (typeof preview !== 'boolean')
        reject('invalid-input', 'preview', 'Preview flag must be boolean');
      // Preparing commits nothing: the candidate's preparation is the answer.
      return withCandidate(request, preview, deps, async (candidate) => candidate.preparation);
    }, 'authoring-prepare');
  }

  /** Commits a request's intent. A lost acknowledgement is reconciled before resources are released. */
  function apply(
    input: unknown,
    options: unknown = {},
  ): Promise<Result<Receipt>> {
    return submit(input, options, null);
  }

  /** Undoes an original change with new validated writes. Storage is never rewound. */
  function undo(
    input: unknown,
    options: unknown = {},
  ): Promise<Result<Receipt>> {
    return submit(input, options, 'undo');
  }

  /** Redoes an undone change. An edit made in between is a conflict that needs a new request. */
  function redo(
    input: unknown,
    options: unknown = {},
  ): Promise<Result<Receipt>> {
    return submit(input, options, 'redo');
  }

  /** Returns the workspace's undo/redo status. */
  function history(workspace: unknown): Promise<Result<HistoryStatus>> {
    // Read through the facade's own `read`, then summarise the history in the snapshot.
    return protect(async () => {
      const snapshot = accepted(await read(workspace));
      return historyStatus(snapshot);
    }, 'authoring-history');
  }

  /** Adds history to a workspace that has none, or checks and trims existing history. */
  function initializeHistory(workspace: unknown): Promise<Result<HistoryStatus>> {
    // Check the registration and ID, then adopt or check the history.
    return protect(async () => {
      accepted(registration);
      const id = readShape(workspaceId, workspace);
      return adoptHistory(id, deps);
    }, 'authoring-history-adoption');
  }

  /**
   * Shared path for `apply`, `undo` and `redo`: decode the request and options, check the intent
   * kind, then admit and commit in one continuation.
   */
  function submit(
    input: unknown,
    options: unknown,
    kind: RequiredKind,
  ): Promise<Result<Receipt>> {
    // Check the registration, request, options and intent kind, then admit and commit.
    return protect(async () => {
      accepted(registration);
      const request = readRequest(input);
      const checkedOptions = readOptions(options);
      requireKind(request, kind);
      // Commit the admitted candidate while its resources are still held.
      return withCandidate(request, false, deps, (candidate) =>
        applyCandidate(request, candidate, checkedOptions, deps),
      );
    }, 'authoring-apply');
  }

  return Object.freeze({ read, receipt, prepare, apply, undo, redo, history, initializeHistory });
}

/**
 * Rejects a request whose intent kind does not match the operation, for example a change sent to `undo`.
 * The request keeps one envelope and one fingerprint whichever operation receives it.
 */
function requireKind(
  request: Request,
  kind: RequiredKind,
): void {
  if (kind === null) return;
  if (request.intent.kind !== kind)
    reject('invalid-input', 'intent', 'Intent does not match the selected authoring operation');
}
