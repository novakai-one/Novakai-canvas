/*
 * Why this file exists
 *
 * Authoring keeps each undo step as a `history` record, and those records grow with every edit.
 * The browser only needs each record's version, to see that something changed. For example,
 * `GET /api/v1/workspace?history=versions` answers every history record with its contents `null`.
 *
 * This file strips those contents from a snapshot. It keeps the `navigation` record whole, because
 * that one says where undo and redo stand. It never changes what is stored.
 */
import type { Snapshot, StoredRecord } from '../../contract/records/capability-types.js';

/** The ID of Authoring's undo/redo navigation record (kind `history`); its contents are kept. */
const NAVIGATION_HISTORY_ID = 'navigation';

/**
 * Answers the snapshot with every history record's contents set to `null`, except `navigation`.
 * Versions stay as they are. Never fails.
 */
export function stripHistoryContents(snapshot: Snapshot): Snapshot {
  const records = snapshot.records.map(stripUndoStepContents);
  return { ...snapshot, records };
}

/** Sets an undo step's contents to `null`, and keeps any other record whole. */
function stripUndoStepContents(record: StoredRecord): StoredRecord {
  if (isUndoStep(record)) {
    return { ...record, value: null };
  }
  return record;
}

/** Whether the record is one undo step: a `history` record other than `navigation`. */
function isUndoStep(record: StoredRecord): boolean {
  const isHistory = record.key.kind === 'history';
  const isNavigation = record.key.id === NAVIGATION_HISTORY_ID;
  return isHistory && !isNavigation;
}
