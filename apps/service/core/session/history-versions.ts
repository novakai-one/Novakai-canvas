/*
 * Strips history contents from a snapshot, keeping navigation. Pure. Used by apply's post-commit
 * read and by the workspace route's `?history=versions`.
 */
import type { Snapshot, StoredRecord } from '../../contract/records/capabilities.js';

/** The ID of Authoring's undo/redo navigation record (kind `history`); its contents are kept. */
const NAVIGATION_HISTORY_ID = 'navigation';

/**
 * The snapshot with every history record's contents set to `null`, except navigation. The browser
 * needs history versions, not history contents (which grow with every edit). Never fails.
 */
export function historyVersionsOnly(snapshot: Snapshot): Snapshot {
  return { ...snapshot, records: snapshot.records.map(versionOnly) };
}

/** The record with its contents set to `null` when it is a history record other than navigation. */
function versionOnly(record: StoredRecord): StoredRecord {
  if (record.key.kind !== 'history') return record;
  if (record.key.id === NAVIGATION_HISTORY_ID) return record;
  return { ...record, value: null };
}
