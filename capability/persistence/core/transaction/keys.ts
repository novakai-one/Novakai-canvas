import type { RecordKey, Slot, WorkspaceState } from '../../contract/records/storage.js';

/**
 * Turns a record key into one comparable string, `kind/id`.
 *
 * The text is unambiguous because the record ID grammar does not allow a slash.
 *
 * @param key - The record's kind and ID.
 * @returns The key as `kind/id`, for equality checks and duplicate detection.
 */
export function keyText(key: RecordKey): string {
  return `${key.kind}/${key.id}`;
}

/**
 * Finds the stored slot for one record key.
 *
 * Tombstones (deleted records) are slots too, so a deleted record is still found. `undefined`
 * means the record was never stored, or was purged.
 *
 * @param state - The workspace state to search.
 * @param key - The record to find.
 * @returns The slot, live or tombstoned, or `undefined` when there is none.
 */
export function findSlot(
  state: WorkspaceState,
  key: RecordKey,
): Slot | undefined {
  return state.slots.find((slot) => keyText(slot.key) === keyText(key));
}

/**
 * Reports whether any value appears more than once.
 *
 * Shared by the request checks and the stored-state checks. Nothing is indexed or stored; the
 * check is recomputed each time.
 *
 * @param values - The values to check, for example `kind/id` texts, request IDs or resource digests.
 * @returns `true` when at least one value repeats.
 */
export function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
