import type { Request } from '../../contract/records/request.js';
import type { Receipt } from '../../contract/records/storage.js';
import type { CommitRequest, Committer, ReceiptReader } from '../../contract/ports/store.js';
import { readReceipt } from '../validation/snapshot.js';
import { reconcile } from '../identity/receipts.js';
import { accepted, reject } from '../validation/outcomes.js';

/**
 * Commits a request and returns its checked receipt, recovering when the acknowledgement fails.
 *
 * When the store settles, the storage transaction is final even if the acknowledgement is lost.
 * So after any failure (a failed result, a thrown error, or a receipt that fails its checks),
 * the receipt store is read. A stored receipt wins, but only once it passes its checks and has this
 * request's fingerprint. When no receipt is stored, the original failure is rethrown. When the
 * lookup itself fails, or finds a malformed or foreign receipt, that failure replaces the original one.
 *
 * @param request - The checked submitted request.
 * @param commit - The storage transaction to commit.
 * @param commits - The committing store.
 * @param receipts - The receipt store used for recovery.
 * @returns The committed receipt.
 * @throws The original commit failure (an AuthoringFault or the store's own error) when no receipt is stored.
 * @throws AuthoringFault from the recovery lookup when it returns a failure, or finds a malformed or foreign receipt.
 * @throws The receipt store's own error, unchanged, when the recovery lookup throws. The public boundary
 *   (`protect` in `contract/api.ts`) turns it into a failed `Result`.
 */
export async function commitAndReconcile(
  request: Request,
  commit: CommitRequest,
  commits: Committer,
  receipts: ReceiptReader,
): Promise<Receipt> {
  try {
    const acknowledgement = accepted(await commits.commit(commit));
    return checkCommitted(request, acknowledgement, commit);
  } catch (error) {
    return recoverTerminalCommit(request, commit, receipts, error);
  }
}

/** Checks the store's receipt belongs to this request and has its fingerprint. */
function checkCommitted(
  request: Request,
  input: unknown,
  commit: CommitRequest,
): Receipt {
  const receipt = readReceipt(input, request.request);
  if (receipt.fingerprint !== commit.fingerprint)
    reject('corrupt-record', 'receipt', 'Commit returned a different request fingerprint');
  return receipt;
}

/** Returns the stored receipt after a failed commit, or rethrows the failure when there is none. */
async function recoverTerminalCommit(
  request: Request,
  commit: CommitRequest,
  receipts: ReceiptReader,
  error: unknown,
): Promise<Receipt> {
  const storedReceipt = await reconcile(request, commit.fingerprint, receipts);
  if (storedReceipt !== null) return storedReceipt;
  throw error;
}
