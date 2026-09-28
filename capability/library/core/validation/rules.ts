/*
 * The rules across records of a parsed snapshot: unique IDs, existing references, no folder
 * cycles, and one organisation entry per collection. Every violation is reported. Pure; the caller
 * corrects the input, and Authoring owns commit and recovery.
 */
import type { Diagnostic } from '../../contract/errors.js';
import type { CollectionId, ObjectId, SectionId } from '../../contract/brands.js';
import type {
  LibrarySnapshot,
  CollectionProjection,
  ObjectProjection,
  RecentVisit,
  SectionProjection,
} from '../../contract/records/snapshot.js';
import type {
  Organisation,
  OrganisationEntry,
  Folder,
} from '../../contract/records/organisation.js';
import { ancestry } from '../organisation/ancestry.js';
import { duplicateIssues } from './identities.js';
import {
  entryKey,
  folderKey,
  hasCollection,
  hasEntry,
  hasFolder,
  hasSection,
} from '../shared/lookups.js';
import { diagnoseWhen } from '../shared/outcomes.js';

/**
 * Checks the rules across records of a parsed snapshot, and reports every violation.
 *
 * Diagnostics come in this order:
 * 1. Folders: duplicate IDs, missing parents, then parent cycles.
 * 2. Membership: duplicate entries, duplicate collections, entries whose collection or folder is
 *    missing, then collections without an entry.
 * 3. Each collection: duplicate section IDs, duplicate object IDs, then each object's duplicate
 *    or missing visible sections.
 * 4. Recent visits: duplicates, then visits to missing collections.
 *
 * Works on parsed projections only, never on raw Model documents. Runs inside the protected
 * boundary of `validateLibrarySnapshot`.
 */
export function validateRecords(snapshot: LibrarySnapshot): readonly Diagnostic[] {
  const folders = folderIssues(snapshot.organisation);
  const membership = membershipIssues(snapshot);
  const projections = snapshot.collections.flatMap(projectionIssues);
  const visits = recentIssues(snapshot);
  return [...folders, ...membership, ...projections, ...visits];
}

/** Folder rules: unique IDs, existing parents and no parent cycles, each checked separately. */
function folderIssues(organisation: Organisation): readonly Diagnostic[] {
  const identities = duplicateIssues(organisation.folders, folderKey, 'organisation.folders');
  const references = organisation.folders.flatMap((folder) => parentIssues(folder, organisation));
  const cycles = organisation.folders.flatMap((folder) => cycleIssues(folder, organisation));
  return [...identities, ...references, ...cycles];
}

/** A folder without a parent is at the root; a named parent must exist in this organisation. */
function parentIssues(
  folder: Folder,
  organisation: Organisation,
): readonly Diagnostic[] {
  if (folder.parent === undefined) {
    return [];
  }
  return diagnoseWhen(!hasFolder(organisation.folders, folder.parent), {
    code: 'broken-reference',
    path: `organisation.folders.${folder.id}.parent`,
    message: 'Parent folder must exist',
  });
}

/** A folder whose parent chain comes back to a folder already visited is in a cycle. */
function cycleIssues(
  folder: Folder,
  organisation: Organisation,
): readonly Diagnostic[] {
  const walk = ancestry(folder.id, organisation.folders);
  return diagnoseWhen(walk.cycle, {
    code: 'folder-cycle',
    path: `organisation.folders.${folder.id}.parent`,
    message: 'Folder ancestry must be acyclic',
  });
}

/** The organisation entries and the collection inventory match one to one; neither has orphans. */
function membershipIssues(snapshot: LibrarySnapshot): readonly Diagnostic[] {
  const entries = duplicateIssues(snapshot.organisation.entries, entryKey, 'organisation.entries');
  const collections = duplicateIssues(snapshot.collections, collectionKey, 'collections');
  const orphanEntries = snapshot.organisation.entries.flatMap((entry) =>
    entryIssues(entry, snapshot),
  );
  const missingEntries = snapshot.collections.flatMap((collection) =>
    missingEntryIssues(collection, snapshot.organisation),
  );
  return [...entries, ...collections, ...orphanEntries, ...missingEntries];
}

/** An entry's collection must exist, and its folder too when it names one. */
function entryIssues(
  entry: OrganisationEntry,
  snapshot: LibrarySnapshot,
): readonly Diagnostic[] {
  const collectionExists = hasCollection(snapshot.collections, entry.collection);
  const folderExists =
    entry.folder === undefined || hasFolder(snapshot.organisation.folders, entry.folder);
  const missingCollection = diagnoseWhen(!collectionExists, {
    code: 'broken-reference',
    path: `organisation.entries.${entry.collection}`,
    message: 'Collection projection must exist',
  });
  const missingFolder = diagnoseWhen(!folderExists, {
    code: 'broken-reference',
    path: `organisation.entries.${entry.collection}.folder`,
    message: 'Containing folder must exist',
  });
  return [...missingCollection, ...missingFolder];
}

/** Every collection needs an organisation entry. */
function missingEntryIssues(
  collection: CollectionProjection,
  organisation: Organisation,
): readonly Diagnostic[] {
  return diagnoseWhen(!hasEntry(organisation.entries, collection.id), {
    code: 'broken-reference',
    path: `collections.${collection.id}`,
    message: 'Collection must have exactly one organisation entry',
  });
}

/** Section IDs and object IDs are each unique within the collection (separately). */
function projectionIssues(collection: CollectionProjection): readonly Diagnostic[] {
  const sectionsPath = `collections.${collection.id}.sections`;
  const objectsPath = `collections.${collection.id}.objects`;
  const sections = duplicateIssues(collection.sections, sectionKey, sectionsPath);
  const objects = duplicateIssues(collection.objects, objectKey, objectsPath);
  const visibility = collection.objects.flatMap((object) => objectVisibility(object, collection));
  return [...sections, ...objects, ...visibility];
}

/**
 * An object may be in no section, but each section it names must exist in the same collection and
 * be named only once.
 */
function objectVisibility(
  object: ObjectProjection,
  collection: CollectionProjection,
): readonly Diagnostic[] {
  const path = `collections.${collection.id}.objects.${object.id}.visibleIn`;
  const duplicates = duplicateIssues(object.visibleIn, sectionIdKey, path);
  const references = object.visibleIn.flatMap((id) =>
    diagnoseWhen(!hasSection(collection.sections, id), {
      code: 'broken-reference',
      path: `${path}.${id}`,
      message: 'Visible section must exist',
    }),
  );
  return [...duplicates, ...references];
}

/** One visit per collection. A visit may name an archived collection, never a missing one. */
function recentIssues(snapshot: LibrarySnapshot): readonly Diagnostic[] {
  const duplicates = duplicateIssues(snapshot.recent, visitKey, 'recent');
  const references = snapshot.recent.flatMap((visit) =>
    diagnoseWhen(!hasCollection(snapshot.collections, visit.collection), {
      code: 'broken-reference',
      path: `recent.${visit.collection}`,
      message: 'Visited collection must exist',
    }),
  );
  return [...duplicates, ...references];
}

/** A collection's key: its ID. */
function collectionKey(collection: CollectionProjection): CollectionId {
  return collection.id;
}

/** A section's key: its ID. */
function sectionKey(section: SectionProjection): SectionId {
  return section.id;
}

/** An object's key: its ID. */
function objectKey(object: ObjectProjection): ObjectId {
  return object.id;
}

/** A visible-section entry's key: the section ID itself. */
function sectionIdKey(id: SectionId): SectionId {
  return id;
}

/** A visit's key: its collection's ID. */
function visitKey(visit: RecentVisit): CollectionId {
  return visit.collection;
}
