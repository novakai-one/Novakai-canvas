/*
 * Receipt text: a receipt lookup, and the committed receipt an apply or retry must end with. Pure.
 * A receipt reports the confirmed request and workspace sequence, never an optimistic saved
 * status.
 */
import type { Receipt } from '../../contract/records/foreign.js';
import type { ReceiptLookup } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * `receipt`'s text: no commit is information, not a failure. Fails with `invalid-response` when
 * the receipt names another request.
 */
export function lookedUpReceipt(
  lookup: ReceiptLookup,
  request: RequestId,
): Result<string> {
  if (lookup.kind === 'none') return success('No committed receipt found.');
  return matchedReceipt(lookup.receipt, request);
}

/**
 * The receipt's outcome, request and workspace sequence. Fails with `invalid-response` when the
 * receipt names another request: it cannot confirm this one.
 */
export function matchedReceipt(
  receipt: Receipt,
  request: RequestId,
): Result<string> {
  if (receipt.request !== request)
    return failure({
      code: 'invalid-response',
      message: 'Service returned a receipt for another request',
    });
  return success(
    `${receipt.outcome.status}: ${receipt.request}\nWorkspace sequence: ${receipt.sequence}`,
  );
}
