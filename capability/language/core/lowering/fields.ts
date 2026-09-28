/*
 * Small readers used by lowering: they take one parsed field and return it as plain data for
 * Model. They check only the written form (text, reference, list); Model validates the result.
 * No side effects. Language owns correcting the source; Authoring owns commit recovery.
 */
import type {
  Fields,
  LocatedValue,
  Reference,
  SyntaxValue,
} from '../../contract/records/syntax.js';
import { isList, isReference } from '../parsing/value-types.js';
import { reject, origin } from '../validation/outcomes.js';

/** A lowered record: plain data that Model has not validated yet. */
export type RawRecord = Readonly<Record<string, unknown>>;

/**
 * One field that must be present.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic at the start of the source
 * (`origin`) when the field is missing.
 */
export function field(
  fields: Fields,
  name: string,
): LocatedValue {
  const value = fields[name];
  if (value === undefined) reject('invalid-value', origin, name, 'Required syntax value is absent');
  return value;
}

/**
 * One field that must be text. Lists and references are rejected, never turned into text.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic when the field is missing (see
 * {@link field}) or is not text.
 */
export function text(
  fields: Fields,
  name: string,
): string {
  const item = field(fields, name);
  if (typeof item.value !== 'string')
    reject('invalid-value', item.span, 'String', 'Expected textual value', name);
  return item.value;
}

/**
 * One optional text field.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic when the field is present but is
 * not text.
 */
export function textOr(
  fields: Fields,
  name: string,
  fallback: string,
): string {
  if (fields[name] === undefined) return fallback;
  return text(fields, name);
}

/**
 * The reference held by a field.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic when the value is not a reference.
 */
export function reference(value: LocatedValue): Reference {
  if (!isReference(value.value))
    reject('invalid-value', value.span, 'Reference', 'Expected a reference');
  return value.value;
}

/**
 * The ID of the reference held by a field. It stays a plain string; Model gives it its checked
 * type.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic when the field is missing or is
 * not a reference.
 */
export function id(
  fields: Fields,
  name: string = 'id',
): string {
  return reference(field(fields, name)).id;
}

/**
 * One field that must be a list, in written order. A missing field is an error, not an empty
 * list.
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic when the field is missing or is
 * not a list.
 */
export function list(
  fields: Fields,
  name: string,
): readonly SyntaxValue[] {
  const value = field(fields, name);
  if (!isList(value.value)) reject('invalid-value', value.span, 'List', 'Expected a list');
  return value.value;
}

/**
 * A one-key record for spreading into a larger record, or an empty one when the value is
 * missing, so an absent field is left out rather than stored as `undefined`.
 */
export function optional(
  name: string,
  value: unknown,
): RawRecord {
  if (value === undefined) return {};
  return { [name]: value };
}

/**
 * An endpoint record: the object's ID, and the member's ID when the reference names one. Model
 * checks which kinds of endpoint are legal.
 */
export function endpoint(value: Reference): RawRecord {
  return { object: value.id, ...optional('member', value.member) };
}

/**
 * Returns a copy of a record without one field; the other own enumerable fields (symbol keys
 * included) keep their order. Reads the field first, then copies the rest (the same reads as a
 * rest destructuring).
 */
export function withoutField(
  record: RawRecord,
  field: string,
): RawRecord {
  const { [field]: removed, ...remaining } = record;
  // `void` marks the removed value as deliberately unused; only the copy is kept.
  void removed;
  return remaining;
}
