/*
 * `list`'s text: one line per live collection in the workspace snapshot. Pure apart from the
 * injected Model check. An invalid stored collection is listed as invalid, never hidden, so an
 * invalid library cannot pass for an empty one.
 */
import type { CollectionValidator } from '../../contract/ports/collection-validator.js';
import type { WorkspaceSnapshot, StoredRecord } from '../../contract/records/foreign.js';

/** What `list` prints when the workspace holds no live collection. */
const emptyLibrary = 'No collections yet. Use canvas create diagram.canvas.';

/** One `ID  rN  title  N sections` line per live collection, in snapshot order. */
export function collectionLines(
  snapshot: WorkspaceSnapshot,
  reader: CollectionValidator,
): string {
  const lines = snapshot.records.filter(isLiveCollection).map((record) => line(record, reader));
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
