import type { RequestId } from '../../contract/brands.js';
import type { HistoryNavigation } from '../../contract/records/history.js';
import type { RecordKey, Snapshot } from '../../contract/records/storage.js';
import type { PurgeWrite } from '../../contract/ports/store.js';
import { findRecord, keyText } from '../records/keys.js';
import { navigationKey } from './navigation.js';
import { transactionKey, headKey } from './read.js';

/** Undo steps kept per workspace. Older steps leave navigation and their records are purged. */
export const HISTORY_LIMIT = 100;

/**
 * The largest total size of retained transaction records, so history leaves the rest of storage to content.
 * Sizes are measured as the length of each record's JSON text.
 */
export const HISTORY_BYTES = 16 * 1024 * 1024;

/** The most history records one commit purges, keeping its reads under the dependency limit. Reopening repeats until clean. */
const PURGE_BATCH = 2000;

/** Cache of each stored transaction record's JSON text length. Stored records are frozen, so the length never changes. */
const transactionSizes = new WeakMap<object, number>();

/**
 * Removes undo and redo steps until history fits both the step limit and the size limit.
 *
 * Steps are removed in this order: the oldest undo steps first, then the furthest redo steps.
 * The newest step always stays. The cursor moves so it still points between the same steps.
 *
 * @param snapshot - The workspace snapshot that holds the steps' transaction records.
 * @param history - The history navigation to bound.
 * @returns The same `history` object when nothing needs removing, otherwise a new navigation.
 */
export function boundNavigation(
  snapshot: Snapshot,
  history: HistoryNavigation,
): HistoryNavigation {
  const sizes = history.actions.map((id) => stepSize(snapshot, id));
  const order = removalOrder(sizes.length, history.cursor);
  const removed = order.slice(0, removalCount(sizes, order));
  if (removed.length === 0) return history;

  const removedIndexes = new Set(removed);
  const removedBeforeCursor = removed.filter((index) => index < history.cursor).length;
  return {
    ...history,
    actions: history.actions.filter((_action, index) => !removedIndexes.has(index)),
    cursor: history.cursor - removedBeforeCursor,
  };
}

/**
 * Lists the history records that navigation no longer reaches, as purge writes.
 *
 * Kept: the navigation record, every record this commit writes, and each reachable step's
 * transaction and head. At most `PURGE_BATCH` records are purged per commit.
 *
 * @param snapshot - The current workspace snapshot.
 * @param actions - The steps navigation still reaches.
 * @param written - The keys this commit writes.
 * @returns Purge writes for unreachable history records, in snapshot order.
 */
export function staleHistory(
  snapshot: Snapshot,
  actions: readonly RequestId[],
  written: readonly RecordKey[],
): readonly PurgeWrite[] {
  const reachedKeys = actions.flatMap((id) => [transactionKey(id), headKey(id)]);
  const keptKeys = new Set([navigationKey, ...written, ...reachedKeys].map(keyText));
  const staleRecords = snapshot.records.filter(
    (record) => record.key.kind === 'history' && !keptKeys.has(keyText(record.key)),
  );
  return staleRecords.slice(0, PURGE_BATCH).map((record) => ({ kind: 'purge', key: record.key }));
}

/** Returns the JSON text length of one step's transaction record. A step not yet stored counts as zero. */
function stepSize(
  snapshot: Snapshot,
  id: RequestId,
): number {
  const record = findRecord(snapshot, transactionKey(id));
  if (record === null) return 0;

  const known = transactionSizes.get(record);
  if (known !== undefined) return known;

  const size = JSON.stringify(record.value).length;
  transactionSizes.set(record, size);
  return size;
}

/**
 * Lists step indexes in the order they are removed: oldest undo steps, then the furthest redo steps.
 * The newest step is never listed.
 */
function removalOrder(
  length: number,
  cursor: number,
): readonly number[] {
  const undoIndexes = Array.from({ length: cursor }, (_unused, index) => index);
  const redoIndexes = Array.from(
    { length: length - cursor },
    (_unused, index) => length - 1 - index,
  );
  const removableCount = Math.max(0, length - 1);
  return [...undoIndexes, ...redoIndexes].slice(0, removableCount);
}

/** Counts how many steps, taken in removal order, must go before the rest fit both limits. */
function removalCount(
  sizes: readonly number[],
  order: readonly number[],
): number {
  const bytesLeft = bytesLeftAfterEachRemoval(sizes, order);
  const firstFit = bytesLeft.findIndex((bytes, removed) =>
    fitsLimits(sizes.length - removed, bytes),
  );
  if (firstFit === -1) return order.length;
  return firstFit;
}

/**
 * Returns the total size left after removing 0, 1, 2, … steps in removal order.
 * The list has one more entry than `order`.
 */
function bytesLeftAfterEachRemoval(
  sizes: readonly number[],
  order: readonly number[],
): readonly number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const removedSizes = order.map((index) => sizeAt(sizes, index));
  const running = removedSizes.reduce(
    (state, size) => {
      const bytes = state.bytes - size;
      return { bytes, left: [...state.left, bytes] };
    },
    { bytes: total, left: [total] },
  );
  return running.left;
}

/** Reads one step's size. Every index in a removal order is inside the list. */
function sizeAt(
  sizes: readonly number[],
  index: number,
): number {
  const size = sizes[index];
  if (size === undefined) return Number.NaN;
  return size;
}

/** Tells whether a number of steps with a total size fits both history limits. */
function fitsLimits(
  steps: number,
  bytes: number,
): boolean {
  return steps <= HISTORY_LIMIT && bytes <= HISTORY_BYTES;
}
