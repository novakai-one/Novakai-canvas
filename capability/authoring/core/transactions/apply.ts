import type { Request, ApplyOptions } from '../../contract/records/request.js';
import type { PreparedCandidate } from '../../contract/records/proposal.js';
import type { Receipt } from '../../contract/records/storage.js';
import type { Committer, ReceiptReader } from '../../contract/ports/store.js';
import type { Clock, Cancellation, Notifications } from '../../contract/ports/runtime.js';
import { createJournal } from '../history/journal.js';
import { checkCancellation } from '../admission/pipeline.js';
import { commitAndReconcile } from './commit.js';
import { notifyCommitted } from './notifications.js';
import { reject } from '../validation/outcomes.js';

/** The collaborators needed to commit a prepared candidate. */
export interface CommitDependencies {
  readonly commits: Committer;
  readonly receipts: ReceiptReader;
  readonly clock: Clock;
  readonly cancellation: Cancellation;
  readonly notifications: Notifications;
}

/**
 * Commits a prepared candidate as one atomic storage transaction and returns its receipt.
 *
 * Steps, in order:
 * 1. When the caller passed a `candidateHash`, check it equals the freshly prepared one.
 * 2. Build the history journal for the change.
 * 3. Check for cancellation.
 * 4. Commit, reconciling with the receipt store when the acknowledgement is lost.
 * 5. Publish a change notification. A failed notification does not fail the commit.
 *
 * The resource lease stays held by the caller (`withCandidate`) until this returns.
 *
 * @param request - The checked submitted request.
 * @param candidate - The freshly prepared candidate. Prepared writes are never taken from the caller.
 * @param options - The apply options.
 * @param deps - The commit collaborators.
 * @returns The committed receipt.
 * @throws AuthoringFault `revision-conflict` when the given `candidateHash` differs from the fresh one.
 * @throws AuthoringFault `cancelled` when the request was cancelled before commit.
 * @throws AuthoringFault from journal building.
 * @throws The commit or recovery failure from `commitAndReconcile`, unchanged. A collaborator's own
 *   error can escape here; the public boundary (`protect` in `contract/api.ts`) turns it into a failed `Result`.
 */
export async function applyCandidate(
  request: Request,
  candidate: PreparedCandidate,
  options: ApplyOptions,
  deps: CommitDependencies,
): Promise<Receipt> {
  checkPreparation(candidate, options);
  const journal = createJournal(request, candidate, deps.clock);
  checkCancellation(request, deps.cancellation);

  const commit = {
    workspace: request.workspace,
    request: request.request,
    fingerprint: candidate.preparation.fingerprint,
    ...journal,
  };
  const receipt = await commitAndReconcile(request, commit, deps.commits, deps.receipts);
  await notifyCommitted(request, receipt, deps.notifications);
  return receipt;
}

/**
 * Rejects the commit when the caller's `candidateHash` differs from the freshly prepared one.
 * This is an extra check on top of the client's expected versions, never a replacement for them.
 */
function checkPreparation(
  candidate: PreparedCandidate,
  options: ApplyOptions,
): void {
  if (options.candidateHash === undefined) return;
  if (options.candidateHash !== candidate.preparation.candidateHash)
    reject('revision-conflict', 'candidateHash', 'Prepared candidate or its dependencies changed');
}
