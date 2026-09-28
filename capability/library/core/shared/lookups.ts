/*
 * Existence checks and record keys by ID, shared by validation, organisation changes and search. Each
 * check reads the given list only. Pure: the same lists always give the same answer; Authoring owns
 * commit and recovery.
 */
import type { CollectionId, FolderId, SectionId } from '../../contract/brands.js';
import type { OrganisationEntry, Folder } from '../../contract/records/organisation.js';
import type { CollectionProjection, SectionProjection } from '../../contract/records/snapshot.js';

/** Whether a folder with this ID exists. */
export function hasFolder(
  folders: readonly Folder[],
  id: FolderId,
): boolean {
  return folders.some((folder) => folder.id === id);
}

/** Whether an organisation entry lists this collection. */
export function hasEntry(
  entries: readonly OrganisationEntry[],
  collection: CollectionId,
): boolean {
  return entries.some((entry) => entry.collection === collection);
}

/** Whether a collection with this ID is in the inventory. */
export function hasCollection(
  collections: readonly CollectionProjection[],
  id: CollectionId,
): boolean {
  return collections.some((collection) => collection.id === id);
}

/** Whether a section with this ID is in the collection. */
export function hasSection(
  sections: readonly SectionProjection[],
  id: SectionId,
): boolean {
  return sections.some((section) => section.id === id);
}

/** A folder's key: its ID. Shared by organisation changes and validation. */
export function folderKey(folder: Folder): FolderId {
  return folder.id;
}

/**
 * An organisation entry's key: its collection's ID (one entry per collection). Shared by organisation changes
 * and validation.
 */
export function entryKey(entry: OrganisationEntry): CollectionId {
  return entry.collection;
}
