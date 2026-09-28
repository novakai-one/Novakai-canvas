/*
 * Finding the record a `set` or `unset` edits, the properties it accepts, and how its edited
 * copy becomes a Model change. Records are read from the staged collection, never from the
 * original snapshot. Pure: nothing is written. Faults are `LanguageFault`s for `protect`.
 * Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Collection } from '../../contract/ports/model.js';
import type { Operation } from '../../contract/records/syntax.js';
import type { Property, PropertyTable } from '../../contract/records/vocabulary.js';
import { patchProperties } from '../vocabulary/patch-properties.js';
import { constructs } from '../vocabulary/constructs.js';
import { recordNamespaces } from '../vocabulary/defaults.js';
import type { RawRecord } from '../lowering/fields.js';
import { reject } from '../validation/outcomes.js';
import { findRecord, requirePlainAddress, blockOwner, blockId, viewOwner } from './targets.js';
import { replaceBlock } from './blocks.js';

/** The record a property edit changes, what it accepts, and how its new copy is written. */
export interface PropertyTarget {
  readonly record: RawRecord;
  readonly properties: PropertyTable;

  /** Turns the edited copy of the record into one Model change. */
  readonly write: (record: RawRecord) => RawRecord;
}

/**
 * Finds the record a property edit addresses in the staged collection.
 *
 * - `collection`: the collection itself; written as `replace-document`.
 * - `node`, `wire`, `section`: the record with the `@id`; written as a `replace` of that record.
 * - `block`: the `@object.@block` content block; accepts its kind's properties plus its
 *   positional ones (except `id`); the positional ones are required. Written as a `replace` of
 *   the owning object.
 * - `appearance`, `route`: the `@section/@item` entry; written as a `replace` of the section.
 *
 * @throws `invalid-value` for a target without property edits (`asset`, `source`, `layout`), a
 * wrong address or an unknown content kind; `unknown-target` for a missing record, block,
 * appearance or visible wire.
 */
export function propertyTarget(
  collection: Collection,
  operation: Operation,
): PropertyTarget {
  const target = operation.target;
  switch (target) {
    case 'collection':
      return {
        record: collection,
        properties: patchProperties.collection,
        write: (value) => ({ op: 'replace-document', value }),
      };
    case 'node':
      return canonicalTarget(collection.objects, recordNamespaces.node, operation);
    case 'wire':
      return canonicalTarget(collection.relationships, recordNamespaces.wire, operation);
    case 'section':
      return canonicalTarget(collection.sections, recordNamespaces.section, operation);
    case 'block':
      return contentTarget(collection, operation);
    case 'appearance':
      return appearanceTarget(collection, operation);
    case 'route':
      return routeTarget(collection, operation);
    case 'asset':
    case 'source':
    case 'layout':
      return refuseEdits(operation);
    default:
      return unknownTarget(target, operation);
  }
}

/** A plain `@id` record, written back as a whole-record `replace` in its namespace. */
function canonicalTarget(
  records: readonly (RawRecord & { readonly id: string })[],
  namespace: string,
  operation: Operation,
): PropertyTarget {
  requirePlainAddress(operation);
  return {
    record: findRecord(records, operation.address.id, operation),
    properties: patchProperties[operation.target],
    write: (value) => ({ op: 'replace', target: namespace, value }),
  };
}

/** A content block accepts its own kind's properties plus its positional ones, except `id`. */
function contentTarget(
  collection: Collection,
  operation: Operation,
): PropertyTarget {
  const owner = blockOwner(collection, operation);
  const record = findRecord(owner.content, blockId(operation), operation);
  const definition = constructs.find((item) => item.kind === record.kind);
  if (definition === undefined)
    reject(
      'invalid-value',
      operation.span,
      'Supported content kind',
      'Cannot edit unknown content',
    );
  const positional = definition.positions
    .filter((item) => item.name !== 'id')
    .map((item): readonly [string, Property] => [
      item.name,
      { type: item.type, field: item.name, required: true },
    ]);
  const properties = { ...definition.properties, ...Object.fromEntries(positional) };
  return {
    record,
    properties,
    write: (value) => replaceBlock(collection, operation, value),
  };
}

/** An object's ordinary appearance in a section; one drawn as part of a group is refused. */
function appearanceTarget(
  collection: Collection,
  operation: Operation,
): PropertyTarget {
  const section = viewOwner(collection, operation);
  const record = section.appearances.find((item) => item.object === operation.address.id);
  if (record === undefined)
    reject(
      'unknown-target',
      operation.span,
      'Ordinary appearance',
      'Appearance is absent or represented by a group',
    );
  return {
    record,
    properties: patchProperties.appearance,
    write: (value) =>
      sectionChange({
        ...section,
        appearances: section.appearances.map((item) =>
          item.object === record.object ? value : item,
        ),
      }),
  };
}

/** A visible wire's route preferences in a section; manual points are not properties. */
function routeTarget(
  collection: Collection,
  operation: Operation,
): PropertyTarget {
  const section = viewOwner(collection, operation);
  const record = section.wires.find((item) => item.relationship === operation.address.id);
  if (record === undefined)
    reject('unknown-target', operation.span, 'Visible wire', 'Route target is absent');
  return {
    record,
    properties: patchProperties.route,
    write: (value) =>
      sectionChange({
        ...section,
        wires: section.wires.map((item) =>
          item.relationship === record.relationship ? value : item,
        ),
      }),
  };
}

/** The change that replaces a whole section. */
function sectionChange(section: RawRecord): RawRecord {
  return { op: 'replace', target: recordNamespaces.section, value: section };
}

/** Refuses a target that has no property edits. */
function refuseEdits(operation: Operation): never {
  return reject(
    'invalid-value',
    operation.span,
    'Editable target',
    'Target does not support property edits',
  );
}

/** Refuses a target of no known kind; `never` proves every target kind is handled above. */
function unknownTarget(
  target: never,
  operation: Operation,
): never {
  void target;
  return refuseEdits(operation);
}
