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
import type { WorkspaceSnapshot, StoredRecord } from '../../contract/records/foreign.js';

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
  const lines = snapshot.records.filter(isLiveCollection).map((record) => line(record, validator));
  if (lines.length === 0) return emptyLibrary;
  return lines.join('\n');
}

/** A collection record that is not deleted. */
function isLiveCollection(record: StoredRecord): boolean {
  return record.key.kind === 'collection' && !record.deleted;
}

/** The collection's Model-checked ID, revision, title and section count. */
function line(
  record: StoredRecord,
  reader: CollectionValidator,
): string {
  const collection = reader.validate(record.value);
  if (!collection.ok) return `${record.key.id}\tInvalid collection — inspect service diagnostics`;
  const { id, revision, title, sections } = collection.value;
  return `${id}\tr${revision}\t${title}\t${sections.length} sections`;
}
