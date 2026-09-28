import {
  requestSchema,
  requestId,
  actorId,
  type Snapshot,
  type Request,
  type RecordKey,
  type StoredRecord,
} from '../contract/index.js';
import { observed, workspace, record } from './fixtures.js';
import { z } from 'zod';

/**
 * Builds an undo or redo request for an earlier change.
 *
 * An inverse is a new request that expects the records' current versions; it never rewinds the
 * database.
 *
 * @param snapshot - The current snapshot, read for each key's current version.
 * @param id - The new request's ID.
 * @param original - The ID of the change to undo or redo.
 * @param kind - `undo` or `redo`.
 * @param keys - The records the inverse touches, used for both `expected` and `scope`.
 * @returns The checked request.
 * @throws ZodError when an ID or the request is invalid.
 */
export function inverse(
  snapshot: Snapshot,
  id: string,
  original: string,
  kind: 'undo' | 'redo',
  keys: readonly RecordKey[],
): Request {
  return requestSchema.parse({
    workspace,
    request: requestId.parse(id),
    actor: { id: actorId.parse('human'), kind: 'human' },
    version: 1,
    expected: keys.map((key) => observed(snapshot, key)),
    scope: keys,
    assets: [],
    intent: { kind, transaction: requestId.parse(original) },
  });
}

/**
 * Returns a copy of a snapshot in which one history transaction's before-images are replaced
 * by another record. Used to test corrupt history; it never changes storage.
 *
 * @param snapshot - The snapshot to copy.
 * @param transaction - The ID of the history transaction to corrupt.
 * @param other - The key of the record whose stored form becomes every before-image.
 * @returns The altered copy. The input snapshot is not changed.
 * @throws AssertionError when `other` is not in the snapshot.
 * @throws ZodError when the transaction record is not in the expected shape.
 */
export function replaceHistoryBefore(
  snapshot: Snapshot,
  transaction: string,
  other: RecordKey,
): Snapshot {
  const donor = record(snapshot, other);
  const records = snapshot.records.map((item) => withDonorBefore(item, transaction, donor));
  return { ...snapshot, records };
}

/** Replaces every transition's `before` with the donor when `item` is the named transaction. */
function withDonorBefore(
  item: StoredRecord,
  transaction: string,
  donor: StoredRecord,
): StoredRecord {
  const isTarget = item.key.id === `tx:${transaction}`;
  if (!isTarget) return item;

  const fields = z.record(z.string(), z.json()).parse(item.value);
  const transitions = z.array(z.record(z.string(), z.json())).parse(fields.transitions);
  const altered = transitions.map((transition) => ({
    ...transition,
    before: z.json().parse(donor),
  }));
  return { ...item, value: { ...fields, transitions: altered } };
}
