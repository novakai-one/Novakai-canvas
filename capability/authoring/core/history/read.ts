import { recordId } from '../../contract/brands.js';
import type { RequestId } from '../../contract/brands.js';
import { transactionSchema, headSchema } from '../../contract/records/history.js';
import type { Transaction, HistoryHead } from '../../contract/records/history.js';
import type { RecordKey, Snapshot, StoredRecord } from '../../contract/records/storage.js';
import { findRecord } from '../records/keys.js';
import { readShape } from '../validation/input.js';
import { storedLimits } from '../validation/plain-data.js';
import { reject } from '../validation/outcomes.js';

/**
 * Builds the key of the history record that stores a request's transaction.
 *
 * Request IDs are limited in length, so the `tx:` prefix always fits. Collisions are caught by
 * the conditional commit.
 *
 * @param request - The request whose transaction is stored.
 * @returns The key `history/tx:<request>`.
 * @throws AuthoringFault `invalid-input` when the resulting ID is not a valid record ID.
 */
export function transactionKey(request: RequestId): RecordKey {
  const id = readShape(recordId, `tx:${request}`);
  return { kind: 'history', id };
}

/**
 * Builds the key of the history head for an original change.
 * The head tracks the current versions of the records that its undo and redo touch.
 *
 * @param request - The request of the original change.
 * @returns The key `history/head:<request>`.
 * @throws AuthoringFault `invalid-input` when the resulting ID is not a valid record ID.
 */
export function headKey(request: RequestId): RecordKey {
  const id = readShape(recordId, `head:${request}`);
  return { kind: 'history', id };
}

/**
 * Reads and checks the stored transaction of an original change, for undo or redo.
 *
 * Only original changes can be undone or redone. An undo or redo transaction cannot start a new branch.
 *
 * @param snapshot - The current workspace snapshot.
 * @param request - The request of the original change.
 * @returns The checked transaction.
 * @throws AuthoringFault `unknown-reference` when no transaction is stored for the request.
 * @throws AuthoringFault `corrupt-record` when the record is deleted, does not match the transaction shape, or has a different ID.
 * @throws AuthoringFault `invalid-input` when the stored value is not plain JSON or is over the stored size limits
 *   (at `$`, or at the property name for an accessor property).
 * @throws AuthoringFault `invalid-input` at `history` when the transaction is itself an undo or redo.
 */
export function readTransaction(
  snapshot: Snapshot,
  request: RequestId,
): Transaction {
  const record = retainedRecord(snapshot, transactionKey(request));
  const transaction = readShape(transactionSchema, record.value, 'corrupt-record', storedLimits);
  if (transaction.id !== request)
    reject('corrupt-record', 'history', 'Transaction identity differs from its key');
  if (transaction.mode !== 'change')
    reject('invalid-input', 'history', 'Undo/redo targets an original change transaction');
  return transaction;
}

/**
 * Reads and checks the history head of an original change, before its versions are trusted.
 *
 * @param snapshot - The current workspace snapshot.
 * @param request - The request of the original change.
 * @returns The checked history head.
 * @throws AuthoringFault `unknown-reference` when no head is stored for the request.
 * @throws AuthoringFault `corrupt-record` when the record is deleted, does not match the head shape, or belongs to another change.
 * @throws AuthoringFault `invalid-input` when the stored value is not plain JSON or is over the stored size limits
 *   (at `$`, or at the property name for an accessor property).
 */
export function readHead(
  snapshot: Snapshot,
  request: RequestId,
): HistoryHead {
  const record = retainedRecord(snapshot, headKey(request));
  const head = readShape(headSchema, record.value, 'corrupt-record', storedLimits);
  if (head.original !== request)
    reject('corrupt-record', 'history', 'History head identity differs from its key');
  return head;
}

/** Finds a live history record. A missing or deleted record is an error, never an empty undo. */
function retainedRecord(
  snapshot: Snapshot,
  key: RecordKey,
): StoredRecord {
  const record = findRecord(snapshot, key);
  if (record === null) reject('unknown-reference', 'history', 'Retained transaction was not found');
  if (record.deleted) reject('corrupt-record', 'history', 'History cannot be tombstoned');
  return record;
}
