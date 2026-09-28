/*
 * Why this file exists
 *
 * `pnpm canvas list` shows what the workspace holds, one collection per line:
 * `my-diagram  r3  My diagram  4 sections`. The service sends saved collections as plain data, and
 * one may not be valid. An invalid one must still show, or a broken library could look empty.
 *
 * This file writes those lines, asking Model to check each collection first. It never hides or
 * repairs a collection.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type {
  Collection,
  WorkspaceSnapshot,
  StoredRecord,
} from '../../contract/records/foreign.js';

/** What `list` prints when the workspace holds no live collection. */
const emptyLibrary = 'No collections yet. Use canvas create diagram.canvas.';

/**
 * Writes one line per saved collection, as `list` prints: ID, revision, title and section count,
 * separated by tabs. Deleted collections are left out. A collection that Model rejects shows as
 * `Invalid collection`. With none, it writes `No collections yet. Use canvas create diagram.canvas.`
 */
export function formatCollectionList(
  snapshot: WorkspaceSnapshot,
  validator: CollectionValidator,
): string {
  const collectionRecords = snapshot.records.filter(isLiveCollection);
  if (collectionRecords.length === 0) {
    return emptyLibrary;
  }
  const lines = collectionRecords.map((record) => collectionLine(record, validator));
  return lines.join('\n');
}

/** Whether the saved record is a collection that hasn't been deleted. */
function isLiveCollection(record: StoredRecord): boolean {
  return record.key.kind === 'collection' && !record.deleted;
}

/** Asks Model to check one saved collection, then writes its line: valid or invalid. */
function collectionLine(
  record: StoredRecord,
  validator: CollectionValidator,
): string {
  const collection = validator.validate(record.value);
  if (!collection.ok) {
    return invalidCollectionLine(record);
  }
  return validCollectionLine(collection.value);
}

/** Writes the line for a collection Model rejects: its saved ID, then `Invalid collection`. */
function invalidCollectionLine(record: StoredRecord): string {
  return `${record.key.id}\tInvalid collection — inspect service diagnostics`;
}

/** Writes the line for a checked collection: its ID, revision, title and section count. */
function validCollectionLine(collection: Collection): string {
  const sectionCount = collection.sections.length;
  return `${collection.id}\tr${collection.revision}\t${collection.title}\t${sectionCount} sections`;
}
