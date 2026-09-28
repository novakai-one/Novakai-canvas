import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { Receipt, WorkspaceState } from '../../contract/records/storage.js';
import type { CommitRequest } from '../../contract/records/transaction.js';
import { success } from '../validation/outcomes.js';

/**
 * Looks for an earlier receipt with the same request ID.
 *
 * The commit runs this before any version check. A retry of a request that already committed
 * therefore gets its original receipt back, even though its expected versions are now stale.
 *
 * @param state - The current workspace state, holding the kept receipts.
 * @param request - The parsed commit request.
 * @returns
 * - Success with `null` when no kept receipt has this request ID.
 * - Success with the stored receipt when the request ID and fingerprint both match.
 * - `request-reused` (path `request`) when the ID matches but the fingerprint does not: the ID
 *   was already used for a different change.
 */
export function reconcileReceipt(
  state: WorkspaceState,
  request: CommitRequest,
): Result<Receipt | null> {
  const receipt = state.receipts.find((stored) => stored.request === request.request);
  if (!receipt) {
    return success(null);
  }
  if (receipt.fingerprint !== request.fingerprint) {
    return fail(
      'request-reused',
      'request',
      'Request ID already belongs to different submitted intent',
    );
  }
  return success(receipt);
}
