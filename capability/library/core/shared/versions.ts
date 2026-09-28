/*
 * The source revisions a Library operation read. Plans and result pages carry them so the host can
 * check that nothing changed before it commits or pages further. Pure; Authoring owns commit and
 * recovery.
 */
import type { LibrarySnapshot, CollectionProjection } from '../../contract/records/snapshot.js';
import type { CollectionVersion, ReadVersions } from '../../contract/types.js';
import { compareText } from './text.js';

/** The source revisions of a snapshot: the organisation's, and each collection's sorted by ID. */
export function readVersions(snapshot: LibrarySnapshot): ReadVersions {
  const versions = snapshot.collections.map(collectionVersion);
  const collections = versions.toSorted(byCollectionId);
  return {
    organisation: { id: snapshot.organisation.id, revision: snapshot.organisation.revision },
    collections,
  };
}

/** One collection's ID and revision. */
function collectionVersion(collection: CollectionProjection): CollectionVersion {
  return { id: collection.id, revision: collection.revision };
}

/** Sorts versions by collection ID, by code unit. */
function byCollectionId(
  left: CollectionVersion,
  right: CollectionVersion,
): number {
  return compareText(left.id, right.id);
}
