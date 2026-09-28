/*
 * Matching an Authoring record key to a Model collection. Authoring keys a collection's record
 * with the collection's ID text under its own record-ID brand, so this is the one place the two
 * brands are compared, as text. Pure; never fails. The caller that holds the key owns recovery.
 */
import type { CollectionId } from '../../contract/brands.js';
import type { RecordKey } from '../../contract/records/owners.js';

/** Whether `key` is the record key of collection `collection`. */
export function isCollectionKey(
  key: RecordKey,
  collection: CollectionId,
): boolean {
  if (key.kind !== 'collection') return false;
  const text: string = collection;
  return key.id === text;
}
