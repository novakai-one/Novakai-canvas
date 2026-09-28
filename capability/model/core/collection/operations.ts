import type { Collection } from '../../contract/records/collection.js';
import type { Change } from '../../contract/records/change.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../invariants/issues.js';
import { preserveOverrides } from './preservation.js';
import { writeRecord } from './records.js';
import { deleteObject, removeRecord } from './removal.js';
import { editView } from './view-operations.js';

/**
 * Applies one parsed change to a collection, without checking the result's domain rules:
 * - `create` and `replace` write a record;
 * - `remove` removes a record, and `delete-object` deletes an object (with or without cascade);
 * - `replace-document` swaps in a whole collection, which must keep the current `id` and
 *   `revision` (else `identity` at `collection`, "Collection identity and revision are fixed
 *   during planning"); geometry the new sections omit is carried over from the current sections
 *   with the same ID;
 * - `hide` hides an object in one section; `reset-layout` clears one section's geometry;
 *   `reset-route` clears one wire's manual route.
 *
 * A failure stops the batch. Pure: replaying against the same snapshot gives the same result.
 * `plan` validates the final candidate; Authoring owns commit and crash recovery.
 *
 * @param collection - The collection so far.
 * @param change - One change parsed by the change schema.
 * @returns The new collection, or `validation-failed` from the operation. Not frozen.
 * @throws Never for a parsed change and collection.
 */
export function applyOperation(
  collection: Collection,
  change: Change,
): Result<Collection> {
  const handler = operationHandlers[change.op];
  return handler(collection, change);
}

/** Applies one change whose operation the handler is registered for. */
type OperationHandler = (collection: Collection, change: Change) => Result<Collection>;

/**
 * Replaces the whole collection. The replacement must keep the current ID and revision; geometry
 * its sections omit is carried over from the current sections with the same ID.
 */
function replaceDocument(
  collection: Collection,
  replacement: Collection,
): Result<Collection> {
  const identityChanged =
    collection.id !== replacement.id || collection.revision !== replacement.revision;
  if (identityChanged) {
    return failure(
      'identity',
      'collection',
      'Collection identity and revision are fixed during planning',
    );
  }
  return success(preserveOverrides(replacement, collection));
}

/**
 * The failure for a change sent to the wrong handler. The table below always picks the handler
 * for the change's own operation, so parsed input never reaches it.
 */
function unsupportedOperation(): Result<Collection> {
  return failure('shape', 'changes', 'Unsupported operation');
}

/**
 * One handler per operation. Each narrows the change to its own operation before applying it;
 * the table covers every operation in the change schema.
 */
const operationHandlers: Readonly<Record<Change['op'], OperationHandler>> = {
  /** Writes a new record. */
  create: (collection, change) => {
    if (change.op !== 'create') {
      return unsupportedOperation();
    }
    return writeRecord(collection, change);
  },
  /** Overwrites an existing record. */
  replace: (collection, change) => {
    if (change.op !== 'replace') {
      return unsupportedOperation();
    }
    return writeRecord(collection, change);
  },
  /** Removes a record. */
  remove: (collection, change) => {
    if (change.op !== 'remove') {
      return unsupportedOperation();
    }
    return removeRecord(collection, change);
  },
  /** Deletes an object, with or without cascade. */
  'delete-object': (collection, change) => {
    if (change.op !== 'delete-object') {
      return unsupportedOperation();
    }
    return deleteObject(collection, change);
  },
  /** Replaces the whole collection. */
  'replace-document': (collection, change) => {
    if (change.op !== 'replace-document') {
      return unsupportedOperation();
    }
    return replaceDocument(collection, change.value);
  },
  /** Hides an object in one section. */
  hide: (collection, change) => {
    if (change.op !== 'hide') {
      return unsupportedOperation();
    }
    return editView(collection, change);
  },
  /** Clears one section's geometry. */
  'reset-layout': (collection, change) => {
    if (change.op !== 'reset-layout') {
      return unsupportedOperation();
    }
    return editView(collection, change);
  },
  /** Clears one wire's manual route. */
  'reset-route': (collection, change) => {
    if (change.op !== 'reset-route') {
      return unsupportedOperation();
    }
    return editView(collection, change);
  },
};
