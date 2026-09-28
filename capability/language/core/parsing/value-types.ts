/*
 * Checking a parsed value against the form its property declares (`ValueType`) and against the
 * property's allowed words. This checks only the written form; whether the value makes sense for
 * the diagram is Model's job. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type { SyntaxValue, Reference, LocatedValue } from '../../contract/records/syntax.js';
import type { ValueType, Property } from '../../contract/records/vocabulary.js';
import { reject } from '../validation/outcomes.js';

/** Whether a value is a list. `Array.isArray` alone would not narrow to a readonly array. */
export function isList(value: SyntaxValue): value is readonly SyntaxValue[] {
  return Array.isArray(value);
}

/** Whether a value is a reference (the only object that is not a list). */
export function isReference(value: SyntaxValue): value is Reference {
  if (typeof value !== 'object') return false;
  return !isList(value);
}

/**
 * Checks a value against its property. A number for a property with allowed words is first
 * turned into text (the cardinality `1` is read as an integer but listed as a word).
 *
 * @throws A `LanguageFault` with an `invalid-value` diagnostic when the form is wrong, or when
 * the value is not one of the allowed words.
 */
export function checkValue(
  located: LocatedValue,
  property: Property,
  target: string,
): LocatedValue {
  const value = normalizeEnum(located.value, property);
  if (!checks[property.type](value))
    reject(
      'invalid-value',
      located.span,
      property.type,
      'Property value has the wrong type',
      target,
    );
  checkEnum(value, property, located, target);
  return { ...located, value };
}

/** For each value type, whether a value has that form. */
const checks: Readonly<Record<ValueType, (value: SyntaxValue) => boolean>> = {
  string: isText,
  word: isText,
  integer: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
  id: isIdentity,
  endpoint: isEndpoint,
  address: isReference,
  strings: (value) => listOf(value, isText),
  ids: (value) => listOf(value, isIdentity),
  endpoints: (value) => listOf(value, isEndpoint),
  references: (value) => listOf(value, isIdentity),
  targets: (value) => listOf(value, isReference),
  'reference-value': (value) => isEndpoint(value) || listOf(value, isEndpoint),
  'type-expression': isTextOrIdentity,
  'signature-parameters': (value) => listOf(value, signatureParameter),
  link: isTextOrIdentity,
};

/** A number becomes text when the property has allowed words; other values are unchanged. */
function normalizeEnum(
  value: SyntaxValue,
  property: Property,
): SyntaxValue {
  if (property.values === undefined) return value;
  if (typeof value === 'number') return String(value);
  return value;
}

/** Rejects a value outside the property's allowed words; the diagnostic lists them all. */
function checkEnum(
  value: SyntaxValue,
  property: Property,
  located: LocatedValue,
  target: string,
): void {
  if (property.values === undefined) return;
  if (!property.values.includes(String(value)))
    reject(
      'invalid-value',
      located.span,
      property.values.join(' / '),
      'Unknown enum value',
      target,
    );
}

/** Whether the value is text. */
function isText(value: SyntaxValue | undefined): boolean {
  return typeof value === 'string';
}

/** Whether the value is text or a plain `@id`. */
function isTextOrIdentity(value: SyntaxValue): boolean {
  return isText(value) || isIdentity(value);
}

/** Whether the value is a plain `@id`: a reference with only `kind` and `id`. */
function isIdentity(value: SyntaxValue): boolean {
  if (!isReference(value)) return false;
  return Object.keys(value).length === 2;
}

/** Whether the value is an `@id` or `@id.@member`: no section and no namespace. */
function isEndpoint(value: SyntaxValue): boolean {
  if (!isReference(value)) return false;
  return value.namespace === undefined && value.section === undefined;
}

/** Whether the value is a list whose every item passes `predicate` (an empty list passes). */
function listOf(
  value: SyntaxValue,
  predicate: (value: SyntaxValue) => boolean,
): boolean {
  return isList(value) && value.every(predicate);
}

/** Whether a signature parameter is a name, or a `[name, type]` pair. */
function signatureParameter(item: SyntaxValue): boolean {
  if (isText(item)) return true;
  return validSignatureTuple(item);
}

/** Whether the item is a `[name, type]` pair: text name, and a text or plain-ID type. */
function validSignatureTuple(item: SyntaxValue): boolean {
  if (!isList(item) || item.length !== 2) return false;
  const name = item[0];
  const type = item[1];
  return isText(name) && type !== undefined && isTextOrIdentity(type);
}
