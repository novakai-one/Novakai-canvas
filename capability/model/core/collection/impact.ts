import type { Collection } from '../../contract/records/collection.js';
import type { Impact, Target } from '../../contract/types.js';

/**
 * Lists the net changes between two validated snapshots (not the individual operations that led
 * there). For each record list in this order: objects, relationships, sections, assets, sources,
 * definitions:
 * - `added`: an ID only in `after`;
 * - `removed`: an ID only in `before`;
 * - `updated`: an ID in both whose record JSON differs (array order and explicit overrides
 *   count).
 *
 * Within a list, additions come first, then removals, then updates; removals follow `before`'s
 * order, the others `after`'s. Last comes one `collection` update (with `after`'s ID) when any
 * other collection field differs as JSON.
 *
 * Pure and repeatable; `plan` returns this report and Authoring owns commit and crash recovery.
 *
 * @param before - The validated snapshot.
 * @param after - The validated candidate.
 * @returns A new, unfrozen list of changes; empty when nothing changed.
 * @throws Never for validated collections.
 */
export function describeImpact(
  before: Collection,
  after: Collection,
): readonly Impact[] {
  const targets: readonly Target[] = [
    'objects',
    'relationships',
    'sections',
    'assets',
    'sources',
    'definitions',
  ];
  const records = targets.flatMap(
    /** Lists one record list's changes. */
    (target) => describeRecordImpact(before, after, target),
  );
  const metadataChanged = hasChanged(collectionMetadata(before), collectionMetadata(after));
  if (!metadataChanged) {
    return records;
  }
  return [...records, { target: 'collection', id: after.id, action: 'updated' }];
}

/** A collection's own fields, without its record lists. */
type CollectionMetadata = Omit<Collection, Target>;

/**
 * Tells whether two values differ as JSON. The inputs are detached JSON data; array order and
 * explicit overrides count as differences on purpose.
 */
function hasChanged(
  before: unknown,
  after: unknown,
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Lists one record list's additions, then removals, then updates. */
function describeRecordImpact(
  before: Collection,
  after: Collection,
  target: Target,
): readonly Impact[] {
  const previousRecords = before[target];
  const nextRecords = after[target];
  const added = nextRecords.filter(
    /** Tells whether the record is new. */
    (record) =>
      !previousRecords.some(
        /** Tells whether this earlier record has the same ID. */
        (previous) => previous.id === record.id,
      ),
  );
  const removed = previousRecords.filter(
    /** Tells whether the record is gone. */
    (record) =>
      !nextRecords.some(
        /** Tells whether this later record has the same ID. */
        (next) => next.id === record.id,
      ),
  );
  const updated = nextRecords.filter(
    /** Tells whether the record existed before and its JSON changed. */
    (record) => {
      const previous = previousRecords.find(
        /** Tells whether this earlier record has the same ID. */
        (candidate) => candidate.id === record.id,
      );
      return previous !== undefined && hasChanged(previous, record);
    },
  );
  const additions = impactsFor(added, target, 'added');
  const removals = impactsFor(removed, target, 'removed');
  const updates = impactsFor(updated, target, 'updated');
  return [...additions, ...removals, ...updates];
}

/** Reports each record as one change of the given kind, in list order. */
function impactsFor(
  records: readonly { readonly id: string }[],
  target: Target,
  action: Impact['action'],
): readonly Impact[] {
  return records.map(
    /** Reports one record. */
    (record): Impact => ({ target, id: record.id, action }),
  );
}

/**
 * Returns a copy of the collection's own fields without its record lists. Each record has its
 * own impact entry, so only the collection's metadata is compared here.
 */
function collectionMetadata(collection: Collection): CollectionMetadata {
  const { objects, relationships, sections, assets, sources, definitions, ...metadata } =
    collection;
  // `void` marks the record lists as deliberately unused; only the rest copy is kept.
  void objects;
  void relationships;
  void sections;
  void assets;
  void sources;
  void definitions;
  return metadata;
}
