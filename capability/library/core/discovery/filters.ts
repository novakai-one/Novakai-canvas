/*
 * Keeping the search hits a request asks for, before sorting and paging. Pure; nothing is written,
 * and Authoring owns recovery.
 */
import type { LibrarySnapshot } from '../../contract/records/snapshot.js';
import type { OrganisationEntry } from '../../contract/records/organisation.js';
import type { ArchiveMode, QueryRequest, SearchHit } from '../../contract/records/query.js';
import { isWithin } from '../organisation/ancestry.js';
import { searchWords } from './text.js';

/**
 * Keeps the hits the request asks for. A hit is kept when:
 * - its collection's entry matches the archive mode and the folder filter,
 * - its kind is in `kinds`, and
 * - every word of `text` appears in its label or description (lowercased).
 *
 * Objects in no section are kept like any other hit.
 */
export function filterHits(
  hits: readonly SearchHit[],
  snapshot: LibrarySnapshot,
  request: QueryRequest,
): readonly SearchHit[] {
  const entries = snapshot.organisation.entries.filter(
    (entry) => archiveModes[request.archived](entry) && folderMatches(entry, request, snapshot),
  );
  const visibleCollections = new Set(entries.map(entryCollection));
  const words = searchWords(request.text);
  return hits.filter(
    (hit) =>
      visibleCollections.has(hit.collection) &&
      request.kinds.includes(hit.kind) &&
      textMatches(hit, words),
  );
}

/**
 * Which entries each archive mode keeps: `exclude` keeps entries that are not archived, `include`
 * keeps every entry, `only` keeps archived entries. Every mode has a rule (checked by the type).
 */
const archiveModes: Readonly<Record<ArchiveMode, (entry: OrganisationEntry) => boolean>> =
  Object.freeze({ exclude: isLive, include: isAnyEntry, only: isArchived });

/** Whether the entry is not archived. */
function isLive(entry: OrganisationEntry): boolean {
  return !entry.archived;
}

/** Every entry matches. */
function isAnyEntry(): boolean {
  return true;
}

/** Whether the entry is archived. */
function isArchived(entry: OrganisationEntry): boolean {
  return entry.archived;
}

/** The collection an entry lists. */
function entryCollection(entry: OrganisationEntry): OrganisationEntry['collection'] {
  return entry.collection;
}

/**
 * No folder: every entry, root included. With a folder: entries directly in it, or also in its
 * subfolders when `descendants` is set.
 */
function folderMatches(
  entry: OrganisationEntry,
  request: QueryRequest,
  snapshot: LibrarySnapshot,
): boolean {
  if (request.folder === undefined) {
    return true;
  }
  if (request.descendants) {
    return isWithin(entry.folder, request.folder, snapshot.organisation.folders);
  }
  return entry.folder === request.folder;
}

/** Every word occurs in the hit's lowercased label or description (no DOM content involved). */
function textMatches(
  hit: SearchHit,
  words: readonly string[],
): boolean {
  const searchable = `${hit.label} ${hit.description}`.toLowerCase();
  return words.every((word) => searchable.includes(word));
}
