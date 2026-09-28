/*
 * Patching an object's content blocks: add, remove, move or replace one top-level block. Each
 * edit becomes one Model change that replaces the owning object with a new content list; block
 * IDs and the order of the other blocks are kept. Blocks are read from the staged collection,
 * never from the original snapshot. Pure: new arrays and records only. Language owns correcting
 * the source; Authoring owns commit recovery.
 */
import type { Collection, ContentBlock, DiagramObject } from '../../contract/ports/model.js';
import type { Operation } from '../../contract/records/syntax.js';
import { lowerContent } from '../lowering/content.js';
import { id, type RawRecord } from '../lowering/fields.js';
import { reject } from '../validation/outcomes.js';
import { blockOwner, blockId, findRecord } from './targets.js';

/**
 * Replaces one content block of an object with a new record, keeping every other block, the
 * object's ports and its other fields.
 *
 * @throws A `LanguageFault` (`invalid-value`) for an address that is not `@object.@block`, or
 * (`unknown-target`) for a missing object. A missing block leaves the content unchanged; Model
 * planning checks the result.
 */
export function replaceBlock(
  collection: Collection,
  operation: Operation,
  value: RawRecord,
): RawRecord {
  const owner = blockOwner(collection, operation);
  const target = blockId(operation);
  const content = owner.content.map((block) => (block.id === target ? value : block));
  return objectChange(owner, content);
}

/**
 * Applies a block `add`, `remove` or `move` to an object's content.
 *
 * - `add @object { <block> } [before=@block]`: inserts the lowered block before the named block,
 *   or at the end.
 * - `remove @object.@block`: removes the block.
 * - `move @object.@block before=@sibling`: moves the block before the sibling; moving it before
 *   itself changes nothing.
 *
 * Duplicate block IDs are left for Model planning to reject.
 *
 * @throws A `LanguageFault`: `invalid-value` for a wrong block address; `unknown-target` for a
 * missing object, block or `before` sibling; `syntax` for an `add` without a declaration or a
 * `move` without `before=`; and the faults of lowering the added block. Callers run it inside
 * `protect`.
 */
export function editBlocks(
  collection: Collection,
  operation: Operation,
): RawRecord {
  const owner = blockOwner(collection, operation);
  const content = changedContent(owner.content, operation);
  return objectChange(owner, content);
}

/** The Model change that replaces the owning object with a new content list. */
function objectChange(
  owner: DiagramObject,
  content: readonly RawRecord[],
): RawRecord {
  return { op: 'replace', target: 'objects', value: { ...owner, content } };
}

/** An `add` names only the object; `remove` and `move` need an existing block. */
function changedContent(
  content: readonly ContentBlock[],
  operation: Operation,
): readonly RawRecord[] {
  if (operation.action === 'add') return addContent(content, operation);
  const target = findRecord(content, blockId(operation), operation);
  if (operation.action === 'remove') return withoutBlock(content, target);
  return moveContent(content, target, operation);
}

/** Inserts the operation's one content declaration, lowered. */
function addContent(
  content: readonly ContentBlock[],
  operation: Operation,
): readonly RawRecord[] {
  if (operation.declaration === null)
    reject('syntax', operation.span, 'One content declaration', 'Missing inserted block');
  return insertBefore(content, lowerContent(operation.declaration), beforeId(operation), operation);
}

/** Moves the block before its destination; moving it before itself changes nothing. */
function moveContent(
  content: readonly ContentBlock[],
  target: ContentBlock,
  operation: Operation,
): readonly RawRecord[] {
  const before = beforeId(operation);
  if (before === null)
    reject('syntax', operation.span, 'before=@block', 'Move requires a destination');
  if (before === target.id) return content;
  return insertBefore(withoutBlock(content, target), target, before, operation);
}

/** The content without the given block; its ID is read for each item, as the filter runs. */
function withoutBlock(
  content: readonly ContentBlock[],
  block: ContentBlock,
): readonly ContentBlock[] {
  return content.filter((item) => item.id !== block.id);
}

/** The `before=` block ID, or `null` when it is not written (append). */
function beforeId(operation: Operation): string | null {
  if (operation.fields.before === undefined) return null;
  return id(operation.fields, 'before');
}

/** A new list with the block before the named sibling, or at the end; the sibling must exist. */
function insertBefore(
  content: readonly ContentBlock[],
  block: RawRecord,
  before: string | null,
  operation: Operation,
): readonly RawRecord[] {
  if (before === null) return [...content, block];
  const index = content.findIndex((item) => item.id === before);
  if (index < 0)
    reject(
      'unknown-target',
      operation.span,
      'Existing sibling block',
      'Insertion target does not exist',
      before,
    );
  return [...content.slice(0, index), block, ...content.slice(index)];
}
