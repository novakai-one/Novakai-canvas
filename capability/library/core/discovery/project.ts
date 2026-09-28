/*
 * Building search hits from the collection projections. Rebuilt on every search; nothing is
 * cached and the organisation is not touched. Pure; Authoring owns commit and recovery.
 */
import type {
  LibrarySnapshot,
  CollectionProjection,
  SectionProjection,
  ObjectProjection,
} from '../../contract/records/snapshot.js';
import type { SearchHit } from '../../contract/records/query.js';

/**
 * Builds every search hit of a snapshot, in inventory order: for each collection, the collection
 * itself, then its sections, then its objects (including objects in no section).
 */
export function projectHits(snapshot: LibrarySnapshot): readonly SearchHit[] {
  return snapshot.collections.flatMap(projectCollection);
}

/** The hits of one collection: the collection, its sections, then its objects. */
function projectCollection(collection: CollectionProjection): readonly SearchHit[] {
  const collectionHit: SearchHit = {
    kind: 'collection',
    collection: collection.id,
    id: collection.id,
    label: collection.title,
    description: collection.description,
    visibleIn: [],
  };
  const sections = collection.sections.map((section) => sectionHit(collection, section));
  const objects = collection.objects.map((object) => objectHit(collection, object));
  return [collectionHit, ...sections, ...objects];
}

/** A section's hit: its title, no description, visible in itself. */
function sectionHit(
  collection: CollectionProjection,
  section: SectionProjection,
): SearchHit {
  return {
    kind: 'section',
    collection: collection.id,
    id: section.id,
    label: section.title,
    description: '',
    visibleIn: [section.id],
  };
}

/** An object's hit: its label, description and the sections it is visible in. */
function objectHit(
  collection: CollectionProjection,
  object: ObjectProjection,
): SearchHit {
  return {
    kind: 'object',
    collection: collection.id,
    id: object.id,
    label: object.label,
    description: object.description,
    visibleIn: object.visibleIn,
  };
}
