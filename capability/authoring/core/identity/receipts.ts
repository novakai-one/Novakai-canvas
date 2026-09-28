import type { Request } from '../../contract/records/request.js';
import type { Digest } from '../../contract/brands.js';
import type { Receipt } from '../../contract/records/storage.js';
import type { ReceiptReader } from '../../contract/ports/store.js';
import { readReceipt } from '../validation/snapshot.js';
import { accepted, reject } from '../validation/outcomes.js';

/**
 * Looks up the stored receipt for a request, so a retried request returns its original result.
 *
 * Authoring calls this before admission, and again to recover after a rejected attempt or a
 * failed commit acknowledgement. It reads only the receipt store: no snapshot, assets or aliases.
 * That way a request that already committed still returns its receipt even after its source
 * files or aliases have changed.
 *
 * @param request - The checked submitted request.
 * @param fingerprint - The fingerprint of the submitted request.
 * @param reader - The receipt store.
 * @returns The stored receipt when this request already committed, or `null` when it has not.
 * @throws AuthoringFault with the store's own diagnostic when the lookup fails.
 * @throws AuthoringFault `corrupt-record` when the stored receipt is malformed or belongs to another request.
 * @throws AuthoringFault `invalid-input` at `receipt.versions` when the stored receipt repeats a record key.
 * @throws AuthoringFault `request-reused` when the request ID was already used for different intent.
 */
export async function reconcile(
  request: Request,
  fingerprint: Digest,
  reader: ReceiptReader,
): Promise<Receipt | null> {
  const storedReceipt = accepted(await reader.find(request.workspace, request.request));
  if (storedReceipt === null) return null;

  const receipt = readReceipt(storedReceipt, request.request);
  if (receipt.fingerprint !== fingerprint)
    reject('request-reused', 'request', 'Request ID already belongs to different submitted intent');
  return receipt;
}
