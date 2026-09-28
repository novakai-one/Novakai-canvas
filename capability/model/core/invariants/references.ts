import type { ObjectId, SectionId, SourceId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { ContentBlock } from '../../contract/records/content.js';
import type { DiagramObject } from '../../contract/records/object.js';
import { duplicates } from './duplicates.js';
import { referenceIssue } from './issues.js';
import { visibleObjects } from '../sections/groups.js';

/**
 * Checks the references inside objects and relationships: provenance source IDs, local object
 * links and asset references. Every failure is collected; nothing stops early.
 *
 * Order: for each object in list order, its `sources` (duplicates first, then unresolved IDs),
 * then each content block's object link, then its asset reference; then each relationship's
 * `sources` the same way. Diagnostics:
 * - a repeated source ID on one owner: `duplicate` at `<owner>.sources.<id>`;
 * - a source ID with no matching collection source: `reference` at `<owner>.sources.<id>`;
 * - a link to a missing object: `reference` at `objects.<id>.content.<block>`;
 * - a link naming a section that is missing or does not show the object: `reference` at
 *   `objects.<id>.content.<block>.section`;
 * - an asset block whose asset is not in `collection.assets`: `reference` at
 *   `objects.<id>.content.<block>`.
 * Every `reference` message is "Reference must resolve in this collection and scope".
 *
 * URI links are not checked, and asset bytes are never loaded. Relationship endpoints and entity
 * keys have their own validators. Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateReferences(collection: Collection): readonly Diagnostic[] {
  const objectIssues = collection.objects.flatMap(
    /** Checks one object's sources and content references. */
    (object) => validateObjectReferences(object, collection),
  );
  const relationshipIssues = collection.relationships.flatMap(
    /** Checks one relationship's sources. */
    (relationship) =>
      validateSourceIds(
        relationship.sources,
        collection,
        `relationships.${relationship.id}.sources`,
      ),
  );
  return [...objectIssues, ...relationshipIssues];
}

/** A check run on each content block of an object; it returns that block's diagnostics. */
type ReferenceRule = (
  block: ContentBlock,
  collection: Collection,
  path: string,
) => readonly Diagnostic[];

/**
 * Checks provenance source IDs: each must be unique on its owner and name a collection source.
 * Duplicates come first, then unresolved IDs, each in list order.
 */
function validateSourceIds(
  ids: readonly SourceId[],
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  const duplicateIssues = duplicates(
    ids,
    /** A source ID is its own key. */
    (id) => id,
    path,
  );
  const missingSources = ids.filter(
    /** Tells whether no collection source has this ID. */
    (id) =>
      !collection.sources.some(
        /** Tells whether this source has the ID. */
        (source) => source.id === id,
      ),
  );
  const unresolvedIssues = missingSources.flatMap(
    /** Reports one unresolved source ID. */
    (id) => referenceIssue(true, `${path}.${id}`),
  );
  return [...duplicateIssues, ...unresolvedIssues];
}

/**
 * Checks a local link's optional section: the section must exist and show the object. A link
 * without a section addresses the object itself, whether or not any section shows it.
 */
function validateLinkSection(
  objectId: ObjectId,
  sectionId: SectionId | undefined,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (sectionId === undefined) {
    return [];
  }
  const section = collection.sections.find(
    /** Tells whether this is the linked section. */
    (candidate) => candidate.id === sectionId,
  );
  if (section === undefined) {
    return referenceIssue(true, `${path}.section`);
  }
  const objectIsVisible = visibleObjects(section).includes(objectId);
  return referenceIssue(!objectIsVisible, `${path}.section`);
}

/**
 * Checks a link block that targets a local object: the object must exist, then its optional
 * section is checked. Other blocks and URI links give no diagnostics.
 */
function validateObjectLink(
  block: ContentBlock,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (block.kind !== 'link') {
    return [];
  }
  if (block.target.kind !== 'object') {
    return [];
  }
  const target = block.target;
  const objectExists = collection.objects.some(
    /** Tells whether this is the linked object. */
    (object) => object.id === target.id,
  );
  const objectIssues = referenceIssue(!objectExists, path);
  const sectionIssues = validateLinkSection(target.id, target.section, collection, path);
  return [...objectIssues, ...sectionIssues];
}

/** Checks that a block with an `asset` field names an asset in the collection's manifest. */
function validateAssetReference(
  block: ContentBlock,
  collection: Collection,
  path: string,
): readonly Diagnostic[] {
  if (!('asset' in block)) {
    return [];
  }
  const assetExists = collection.assets.some(
    /** Tells whether this is the referenced asset. */
    (asset) => asset.id === block.asset,
  );
  return referenceIssue(!assetExists, path);
}

/** The checks run on every content block, in this order. */
const contentReferenceRules: readonly ReferenceRule[] = [
  validateObjectLink,
  validateAssetReference,
];

/** Checks one object's provenance sources, then every content block's references. */
function validateObjectReferences(
  object: DiagramObject,
  collection: Collection,
): readonly Diagnostic[] {
  const path = `objects.${object.id}`;
  const sourceIssues = validateSourceIds(object.sources, collection, `${path}.sources`);
  const contentIssues = object.content.flatMap(
    /** Runs every content rule on one block. */
    (block) => {
      const blockPath = `${path}.content.${block.id}`;
      return contentReferenceRules.flatMap(
        /** Runs one rule on the block. */
        (rule) => rule(block, collection, blockPath),
      );
    },
  );
  return [...sourceIssues, ...contentIssues];
}
