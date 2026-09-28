/**
 * How many receipts the workspace keeps for retry reconciliation.
 *
 * A retried request is matched to its original outcome through its receipt. Each commit adds one
 * receipt; once there are more than this many, the oldest are dropped so the stored state stays
 * bounded. After its receipt is dropped, a retry of that request is checked as a new request.
 * Stored-state validation also uses it: a state must keep at least `min(sequence, RECEIPT_LIMIT)`
 * receipts.
 */
export const RECEIPT_LIMIT = 1000;
