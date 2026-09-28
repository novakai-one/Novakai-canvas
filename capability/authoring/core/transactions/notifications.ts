import type { Request } from '../../contract/records/request.js';
import type { Receipt } from '../../contract/records/storage.js';
import type { Notifications } from '../../contract/ports/runtime.js';

/**
 * Publishes a hint that a request committed. Never fails.
 *
 * The notification is only a hint. A failed result or a thrown error is ignored, because the
 * commit is already final. Clients that miss it re-read the workspace or reconcile the receipt.
 *
 * @param request - The committed request.
 * @param receipt - The committed receipt.
 * @param notifications - The notification role.
 * @returns Nothing. It settles once publishing has finished or failed.
 */
export async function notifyCommitted(
  request: Request,
  receipt: Receipt,
  notifications: Notifications,
): Promise<void> {
  try {
    await notifications.publish(request.workspace, receipt);
  } catch {
    // Ignored on purpose; see above.
    return;
  }
}
