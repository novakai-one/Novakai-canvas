import type { Collection } from '../../contract/records/collection.js';
import type { Section } from '../../contract/records/section.js';
import type { RecordChange } from '../../contract/records/change.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../invariants/issues.js';
import { preserveSection } from './preservation.js';

/**
 * Writes one complete record for a `create` or `replace` change, in the record list its `target`
 * names:
 * - `create` needs an ID not yet in that list (else `already-exists` at `<target>.<id>`, "Create
 *   requires absent ID") and appends the record;
 * - `replace` needs an existing ID (else `not-found` at `<target>.<id>`, "Replace requires
 *   existing ID") and puts the record in the old one's position;
 * - a replaced section first inherits the geometry it omits from the section it replaces (see
 *   `preserveSection`).
 * Assets and sources are metadata only: no bytes are stored or fetched and no source is checked.
 *
 * Pure: on failure no partly written collection is returned; replaying against the same snapshot
 * gives the same result. `plan` validates the final candidate; Authoring owns commit and crash
 * recovery.
 *
 * @param collection - The collection so far.
 * @param change - A parsed `create` or `replace` change.
 * @returns A new collection with only the target list copied (other records keep their
 * identity), or `validation-failed`. Not frozen.
 * @throws Never for a parsed change and collection.
 */
export function writeRecord(
  collection: Collection,
  change: RecordChange,
): Result<Collection> {
  const exists = collection[change.target].some(
    /** Tells whether this record has the change's ID. */
    (record) => record.id === change.value.id,
  );
  if (change.op === 'create' && exists) {
    return failure(
      'already-exists',
      `${change.target}.${change.value.id}`,
      'Create requires absent ID',
    );
  }
  return writeAfterIdentityCheck(collection, change, exists);
}

/** Writes the record into one list; each writer ignores changes for other lists. */
type RecordWriter = (collection: Collection, change: RecordChange) => Collection;

/** Returns the list with the record appended (`create`) or put in place of the old one. */
function writeRecordList<T extends { readonly id: string }>(
  items: readonly T[],
  value: T,
  operation: RecordChange['op'],
): readonly T[] {
  if (operation === 'create') {
    return [...items, value];
  }
  return items.map(
    /** Swaps in the replacement for the record with its ID. */
    (item) => replaceMatchingRecord(item, value),
  );
}

/** Returns the replacement for the record with its ID; any other record as it is. */
function replaceMatchingRecord<T extends { readonly id: string }>(
  item: T,
  replacement: T,
): T {
  if (item.id !== replacement.id) {
    return item;
  }
  return replacement;
}

/** Writes an object. */
function writeObjects(
  collection: Collection,
  change: RecordChange,
): Collection {
  if (change.target !== 'objects') {
    return collection;
  }
  const objects = writeRecordList(collection.objects, change.value, change.op);
  return { ...collection, objects };
}

/** Writes a relationship. Section wires keep their own routing. */
function writeRelationships(
  collection: Collection,
  change: RecordChange,
): Collection {
  if (change.target !== 'relationships') {
    return collection;
  }
  const relationships = writeRecordList(collection.relationships, change.value, change.op);
  return { ...collection, relationships };
}

/**
 * Returns the section to write: as given when no section has its ID yet, otherwise with the
 * geometry it omits inherited from the section it replaces.
 */
function sectionReplacement(
  collection: Collection,
  change: Extract<RecordChange, { target: 'sections' }>,
): Section {
  const previous = collection.sections.find(
    /** Tells whether this is the section being replaced. */
    (section) => section.id === change.value.id,
  );
  if (previous === undefined) {
    return change.value;
  }
  return preserveSection(change.value, previous);
}

/** Writes a section, after inheriting geometry from the section it replaces. */
function writeSections(
  collection: Collection,
  change: RecordChange,
): Collection {
  if (change.target !== 'sections') {
    return collection;
  }
  const replacement = sectionReplacement(collection, change);
  const sections = writeRecordList(collection.sections, replacement, change.op);
  return { ...collection, sections };
}

/** Writes asset metadata; no bytes are stored or fetched. */
function writeAssets(
  collection: Collection,
  change: RecordChange,
): Collection {
  if (change.target !== 'assets') {
    return collection;
  }
  const assets = writeRecordList(collection.assets, change.value, change.op);
  return { ...collection, assets };
}

/** Writes a provenance source; the source itself is not checked. */
function writeSources(
  collection: Collection,
  change: RecordChange,
): Collection {
  if (change.target !== 'sources') {
    return collection;
  }
  const sources = writeRecordList(collection.sources, change.value, change.op);
  return { ...collection, sources };
}

/** Writes a shared type definition. */
function writeDefinitions(
  collection: Collection,
  change: RecordChange,
): Collection {
  if (change.target !== 'definitions') {
    return collection;
  }
  const definitions = writeRecordList(collection.definitions, change.value, change.op);
  return { ...collection, definitions };
}

/**
 * One writer per record list. Each checks the change's target again, so TypeScript narrows its
 * payload; the table always picks the writer for the change's own target.
 */
const recordWriters: Readonly<Record<RecordChange['target'], RecordWriter>> = Object.freeze({
  objects: writeObjects,
  relationships: writeRelationships,
  sections: writeSections,
  assets: writeAssets,
  sources: writeSources,
  definitions: writeDefinitions,
});

/**
 * Rejects a `replace` whose ID is missing, then writes the record. (A `create` with an existing
 * ID was rejected before this.)
 */
function writeAfterIdentityCheck(
  collection: Collection,
  change: RecordChange,
  exists: boolean,
): Result<Collection> {
  if (change.op === 'replace' && !exists) {
    return failure(
      'not-found',
      `${change.target}.${change.value.id}`,
      'Replace requires existing ID',
    );
  }
  const writer = recordWriters[change.target];
  return success(writer(collection, change));
}
