/*
 * Why this file exists
 *
 * A change is saved only when Authoring writes a receipt for it. `pnpm canvas receipt req-1`
 * prints `committed: req-1` and `Workspace sequence: 5`, or `No committed receipt found.`
 * `apply` and `retry` end with the same two lines.
 *
 * This file writes that text. First it checks the receipt is for the request asked about: a
 * receipt for another request proves nothing. It never says a change was saved without a receipt.
 */
import type { Receipt } from '../../contract/records/foreign.js';
import type { ReceiptLookup } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Writes what `receipt` prints: the receipt, or `No committed receipt found.` when there is none.
 * Finding none is an answer, not a mistake.
 * The mistake it can find: a receipt for another request (`invalid-response`).
 */
export function formatReceiptLookup(
  lookup: ReceiptLookup,
  request: RequestId,
): Result<string> {
  if (lookup.kind === 'none') return success('No committed receipt found.');
  return formatReceipt(lookup.receipt, request);
}

/**
 * Checks the receipt is for `request`, then writes it as text: `committed: req-1`, then
 * `Workspace sequence: 5`.
 * The mistake it can find: a receipt for another request (`invalid-response`).
 */
export function formatReceipt(
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
