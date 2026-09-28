import type { ObjectId } from '../../contract/brands.js';
import type { Collection } from '../../contract/records/collection.js';
import type { Change } from '../../contract/records/change.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../invariants/issues.js';
import { cascadeContent } from './cascade-content.js';
import { cascadeSection } from './cascade-views.js';

/**
 * Deletes an object for a `delete-object` change. Checks, in order:
 * 1. the object must exist: else `not-found` at `objects.<id>`, "Object must exist";
 * 2. the full cascade is computed: relationships from or to the object are removed, other
 *    objects' dependent content is cleaned (`cascadeContent`) and every section is cleaned
 *    (`cascadeSection`);
 * 3. when that cascade changes anything besides removing the object itself (compared as JSON)
 *    and the change lacks
 *    `cascade: true`: `delete-referenced` at `objects.<id>`, "Explicit cascade required for
 *    referenced object".
 * Otherwise the cascaded collection is returned (with nothing to clean, that is the collection
 * without the object).
 *
 * Pure: on failure no partial result is returned; replaying against the same snapshot gives the
 * same result. `plan` validates the final candidate; Authoring owns admission, commit and crash
 * recovery.
 *
 * @param collection - The collection so far.
 * @param change - A parsed `delete-object` change.
 * @returns A new collection (objects, relationships and sections lists copied), or
 * `validation-failed`. Not frozen.
 * @throws Never for a parsed change and collection.
 */
export function deleteObject(
  collection: Collection,
  change: ObjectDeletion,
): Result<Collection> {
  const objectExists = collection.objects.some(
    /** Tells whether this is the object to delete. */
    (object) => object.id === change.id,
  );
  if (!objectExists) {
    return failure('not-found', `objects.${change.id}`, 'Object must exist');
  }
  return planObjectDeletion(collection, change);
}

/**
 * Removes exactly one record for a `remove` change, with no cascade. The ID must exist in the
 * target list (else `not-found` at `<target>.<id>`, "Remove requires existing ID"). References to
 * the removed record are not checked here: a later change in the batch may repair them, and
 * `plan` validates the final candidate.
 *
 * Pure: replaying against the same snapshot gives the same result. Authoring owns commit and
 * crash recovery.
 *
 * @param collection - The collection so far.
 * @param change - A parsed `remove` change.
 * @returns A new collection with only the target list copied, or `validation-failed`. Not
 * frozen.
 * @throws Never for a parsed change and collection.
 */
export function removeRecord(
  collection: Collection,
  change: RecordRemoval,
): Result<Collection> {
  const recordExists = collection[change.target].some(
    /** Tells whether this record has the change's ID. */
    (record) => record.id === change.id,
  );
  if (!recordExists) {
    return failure('not-found', `${change.target}.${change.id}`, 'Remove requires existing ID');
  }
  return success(removeFromNamespace(collection, change));
}

/** A parsed `delete-object` change. */
type ObjectDeletion = Extract<Change, { op: 'delete-object' }>;

/** A parsed `remove` change. */
type RecordRemoval = Extract<Change, { op: 'remove' }>;

/**
 * Builds the collection after a full cascade. In this order: finds the relationships from or to
 * the object; removes the object and cleans the other objects' content; removes those
 * relationships; cleans every section.
 */
function cascadeObjectDeletion(
  collection: Collection,
  removedId: ObjectId,
): Collection {
  const incidentRelationships = collection.relationships.filter(
    /** Tells whether the relationship starts or ends at the deleted object. */
    (relationship) =>
      relationship.source.object === removedId || relationship.target.object === removedId,
  );
  const removedRelationshipIds = incidentRelationships.map(
    /** The relationship's ID. */
    (relationship) => relationship.id,
  );
  const survivingObjects = withoutRecord(collection.objects, removedId);
  const objects = survivingObjects.map(
    /** Cleans content that depends on the deleted object. */
    (object) => cascadeContent(object, removedId),
  );
  const relationships = collection.relationships.filter(
    /** Keeps relationships not incident to the deleted object. */
    (relationship) => !removedRelationshipIds.includes(relationship.id),
  );
  const sections = collection.sections.map(
    /** Cleans the section. */
    (section) => cascadeSection(section, removedId, removedRelationshipIds),
  );
  return { ...collection, objects, relationships, sections };
}

/**
 * Computes the full cascade, then allows it when `cascade` is set or when it changes nothing
 * beyond removing the object itself (compared as JSON).
 */
function planObjectDeletion(
  collection: Collection,
  change: ObjectDeletion,
): Result<Collection> {
  const cascaded = cascadeObjectDeletion(collection, change.id);
  const objectOnly = {
    ...collection,
    objects: collection.objects.filter(
      /** Keeps every other object. */
      (object) => object.id !== change.id,
    ),
  };
  const requiresCascade = JSON.stringify(cascaded) !== JSON.stringify(objectOnly);
  if (!change.cascade && requiresCascade) {
    return failure(
      'delete-referenced',
      `objects.${change.id}`,
      'Explicit cascade required for referenced object',
    );
  }
  return success(cascaded);
}

/** Returns the list without the record with the removed ID, in the same order. */
function withoutRecord<T extends { readonly id: string }>(
  items: readonly T[],
  removedId: RecordRemoval['id'],
): readonly T[] {
  return items.filter(
    /** Keeps every other record. */
    (item) => item.id !== removedId,
  );
}

/**
 * Returns a copy of the collection without the record, in the list the change targets. One
 * remover per list keeps each list's own record type.
 */
function removeFromNamespace(
  collection: Collection,
  change: RecordRemoval,
): Collection {
  const removers: Readonly<Record<RecordRemoval['target'], () => Collection>> = {
    /** Removes an object. */
    objects: () => ({ ...collection, objects: withoutRecord(collection.objects, change.id) }),
    /** Removes a relationship. */
    relationships: () => ({
      ...collection,
      relationships: withoutRecord(collection.relationships, change.id),
    }),
    /** Removes a section. */
    sections: () => ({ ...collection, sections: withoutRecord(collection.sections, change.id) }),
    /** Removes an asset's metadata. */
    assets: () => ({ ...collection, assets: withoutRecord(collection.assets, change.id) }),
    /** Removes a provenance source. */
    sources: () => ({ ...collection, sources: withoutRecord(collection.sources, change.id) }),
    /** Removes a shared type definition. */
    definitions: () => ({
      ...collection,
      definitions: withoutRecord(collection.definitions, change.id),
    }),
  };
  return removers[change.target]();
}
