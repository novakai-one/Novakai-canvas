import type { ObjectId } from '../../contract/brands.js';
import type { ContentBlock } from '../../contract/records/content.js';
import type { DiagramObject } from '../../contract/records/object.js';

/**
 * Removes one object's content that depends on a deleted object, for `delete-object`. The
 * cascade is computed for every deletion; without `cascade`, any difference it makes fails the
 * deletion as `delete-referenced`. In block order:
 * - a keygroup with a reference to the deleted object is removed;
 * - a link to the deleted object is removed (URI links stay);
 * - a field whose `references` names the deleted object keeps its place but loses both `key` and
 *   `references` (it becomes an ordinary field);
 * - every other block is kept as it is (the same object).
 *
 * Pure copy: `object` is not changed. The result is not validated here; `plan` validates the
 * final candidate, and Authoring owns commit and crash recovery.
 *
 * @param object - The object to clean.
 * @param removedId - The deleted object's ID.
 * @returns A new object with the same fields in the same order and a new `content` list.
 * @throws Never for a parsed object.
 */
export function cascadeContent(
  object: DiagramObject,
  removedId: ObjectId,
): DiagramObject {
  const survivingBlocks = object.content.filter(
    /** Keeps the block unless it is a dependent keygroup or link. */
    (block) => !keyGroupReferencesObject(block, removedId) && !linksToObject(block, removedId),
  );
  const content = survivingBlocks.map(
    /** Clears a field's reference to the deleted object. */
    (block) => clearDeletedFieldReference(block, removedId),
  );
  return { ...object, content };
}

/** Tells whether a block is a keygroup with a reference to the deleted object. */
function keyGroupReferencesObject(
  block: ContentBlock,
  removedId: ObjectId,
): boolean {
  if (block.kind !== 'keygroup') {
    return false;
  }
  if (block.references === undefined) {
    return false;
  }
  return block.references.some(
    /** Tells whether this reference names the deleted object. */
    (endpoint) => endpoint.object === removedId,
  );
}

/** Tells whether a block is a link to the deleted object; URI links never are. */
function linksToObject(
  block: ContentBlock,
  removedId: ObjectId,
): boolean {
  if (block.kind !== 'link') {
    return false;
  }
  return block.target.kind === 'object' && block.target.id === removedId;
}

/**
 * Returns a field that referenced the deleted object as a copy without `key` and `references`
 * (other fields in their order). Any other block is returned as it is.
 */
function clearDeletedFieldReference(
  block: ContentBlock,
  removedId: ObjectId,
): ContentBlock {
  if (block.kind !== 'field') {
    return block;
  }
  if (block.references?.object !== removedId) {
    return block;
  }
  const { key: removedKey, references: removedReference, ...ordinaryField } = block;
  // `void` marks the removed fields as deliberately unused; only the rest copy is kept.
  void removedKey;
  void removedReference;
  return ordinaryField;
}
