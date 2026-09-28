/*
 * The field values a `set` or `unset` produces on one record. `set` checks each written value
 * with the same rules as creating the record, then lowers it; `unset` removes an optional field
 * or restores its default. Every other field is kept. Pure: new records only. Faults are
 * `LanguageFault`s for `protect`. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type { Operation, Fields } from '../../contract/records/syntax.js';
import type { Property, PropertyTable } from '../../contract/records/vocabulary.js';
import { withoutField, type RawRecord } from '../lowering/fields.js';
import { lowerValue } from '../lowering/properties.js';
import { checkValue } from '../parsing/value-types.js';
import { reject } from '../validation/outcomes.js';

/**
 * Applies a `set` or `unset` to a record, one property at a time in written order.
 *
 * - `unset name ...`: an optional field is removed, or reset to its default when it has one.
 * - `set name=value ...`: each value is checked against the property and lowered to its field.
 *
 * @throws `unknown-property` for a name the target does not own (the expected text lists every
 * owned name); `invalid-value` for unsetting a required property; and the faults of `checkValue`.
 */
export function changedProperties(
  record: RawRecord,
  operation: Operation,
  properties: PropertyTable,
): RawRecord {
  if (operation.action === 'unset')
    return operation.properties.reduce(
      (next, name) => removeProperty(next, name, operation, properties),
      record,
    );
  return Object.entries(operation.fields).reduce(
    (next, [name, value]) => assignProperty(next, name, value, operation, properties),
    record,
  );
}

/** The target's own property with this name; an inherited or unknown name is refused. */
function owningProperty(
  name: string,
  operation: Operation,
  properties: PropertyTable,
): Property {
  const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
  if (property === undefined)
    reject(
      'unknown-property',
      operation.span,
      Object.keys(properties).join(' / '),
      'Property is not owned by this target',
      name,
    );
  return property;
}

/** Checks the value like creation does, then writes it, lowered, to the property's field. */
function assignProperty(
  record: RawRecord,
  name: string,
  value: Fields[string],
  operation: Operation,
  properties: PropertyTable,
): RawRecord {
  const property = owningProperty(name, operation, properties);
  const checked = checkValue(value, property, name);
  return { ...record, [property.field]: lowerValue(checked.value, property.type) };
}

/** A required property cannot be unset; an optional one is removed or reset to its default. */
function removeProperty(
  record: RawRecord,
  name: string,
  operation: Operation,
  properties: PropertyTable,
): RawRecord {
  const property = owningProperty(name, operation, properties);
  if (property.required)
    reject(
      'invalid-value',
      operation.span,
      'Optional property',
      'Required property cannot be unset',
      name,
    );
  const remaining = withoutField(record, property.field);
  if (property.fallback === undefined) return remaining;
  return { ...remaining, [property.field]: lowerValue(property.fallback, property.type) };
}
