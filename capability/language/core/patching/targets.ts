/*
 * Finding what a patch addresses: the snapshot of the collection it names, then each operation's
 * record in the staged collection (never in the original snapshot). Checks the address has the
 * right parts: `@id` for a plain record, `@object.@block` for a content block (`@object` for an
 * insert), `@section/@item` for an appearance, a route or a membership operation. Pure: nothing
 * is written. Faults are `LanguageFault`s for `protect`. Language owns correcting the source;
 * Authoring owns commit recovery.
 */
import type { Collection, DiagramObject, Section } from '../../contract/ports/model.js';
import type { Operation, Patch } from '../../contract/records/syntax.js';
import { reject } from '../validation/outcomes.js';

/**
 * Requires the snapshot of the collection the patch names; a patch never creates one.
 *
 * @throws `unknown-target` when there is no snapshot or it is another collection.
 */
export function requireSnapshot(
  snapshot: Collection | null,
  patch: Pick<Patch, 'collection' | 'span'>,
): Collection {
  if (snapshot === null)
    reject('unknown-target', patch.span, 'Existing collection snapshot', 'Patch needs a snapshot');
  if (snapshot.id !== patch.collection)
    reject(
      'unknown-target',
      patch.span,
      'Matching collection identity',
      'Patch targets a different collection',
    );
  return snapshot;
}

/**
 * The first record with the ID in one list of the staged collection.
 *
 * @throws `unknown-target` (target `id`) when no record has the ID.
 */
export function findRecord<T extends { readonly id: string }>(
  records: readonly T[],
  id: string,
  operation: Operation,
): T {
  const record = records.find((item) => item.id === id);
  if (record === undefined)
    reject(
      'unknown-target',
      operation.span,
      'Existing target ID',
      'Patch target does not exist',
      id,
    );
  return record;
}

/**
 * Requires a plain `@id` address (`kind` and `id` only), so a member, section or namespace
 * selector cannot stand in for a record.
 *
 * @throws `invalid-value` for any other address.
 */
export function requirePlainAddress(operation: Operation): void {
  if (addressParts(operation) !== PLAIN_PARTS)
    reject('invalid-value', operation.span, '@id', 'Target needs a plain identity');
}

/**
 * The object that owns an addressed content block. An insert names only the object (`@object`);
 * every other block operation names the block too (`@object.@block`).
 *
 * @throws `invalid-value` for a wrong number of address parts or a section or namespace
 * selector; `unknown-target` for a missing object.
 */
export function blockOwner(
  collection: Collection,
  operation: Operation,
): DiagramObject {
  requireBlockAddress(operation);
  return findRecord(collection.objects, operation.address.id, operation);
}

/**
 * The section that owns an addressed appearance, route or membership entry (`@section/@item`).
 *
 * @throws `invalid-value` when the address has no section or has other parts; `unknown-target`
 * for a missing section.
 */
export function viewOwner(
  collection: Collection,
  operation: Operation,
): Section {
  const section = operation.address.section;
  if (section === undefined)
    reject('invalid-value', operation.span, VIEW_ADDRESS, 'Missing section address');
  if (addressParts(operation) !== SELECTED_PARTS)
    reject('invalid-value', operation.span, VIEW_ADDRESS, 'Unexpected address selector');
  return findRecord(collection.sections, section, operation);
}

/**
 * The block ID of an `@object.@block` address; no empty ID is used in place of a missing one.
 *
 * @throws `invalid-value` when the address has no block.
 */
export function blockId(operation: Operation): string {
  const member = operation.address.member;
  if (member === undefined)
    reject('invalid-value', operation.span, '@object.@block', 'Missing block identity');
  return member;
}

/** Checks the number of address parts, then refuses a section or namespace selector. */
function requireBlockAddress(operation: Operation): void {
  const expected = blockAddressParts(operation);
  if (addressParts(operation) !== expected)
    reject(
      'invalid-value',
      operation.span,
      '@object.@block, or @object for add',
      'Invalid block address',
    );
  if (hasForeignSelector(operation))
    reject(
      'invalid-value',
      operation.span,
      'Object-local block address',
      'Invalid block namespace',
    );
}

/** Whether a block address has a section or namespace selector. */
function hasForeignSelector(operation: Operation): boolean {
  return operation.address.section !== undefined || operation.address.namespace !== undefined;
}

/** An insert names only the object (`@object`); other block operations name the block too. */
function blockAddressParts(operation: Operation): number {
  return operation.action === 'add' ? PLAIN_PARTS : SELECTED_PARTS;
}

/** How many parts (own keys) the address has. */
function addressParts(operation: Operation): number {
  return Object.keys(operation.address).length;
}

/** The parts of a plain `@id` address: `kind` and `id`. */
const PLAIN_PARTS = 2;

/** The parts of an `@object.@block` or `@section/@item` address: `kind`, `id` and one selector. */
const SELECTED_PARTS = 3;

/** The expected form of an appearance, route or membership address. */
const VIEW_ADDRESS = '@section/@item';
