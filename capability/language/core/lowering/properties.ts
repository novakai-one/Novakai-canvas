/*
 * Lowering attribute values to the plain data Model reads. How a reference lowers depends on the
 * property's value type: an endpoint becomes `{ object, member? }`, a type reference becomes
 * `{ kind: 'definition', id }`, any other reference becomes its ID. Text is never guessed to be a
 * reference. No side effects. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type { Fields, SyntaxValue } from '../../contract/records/syntax.js';
import type { Property, ValueType } from '../../contract/records/vocabulary.js';
import { isList, isReference } from '../parsing/value-types.js';
import { endpoint, type RawRecord } from './fields.js';

/**
 * Lowers one value for a property of the given type. Each list item lowers with the item type
 * `endpoint` for an `endpoints` list and `id` for any other list. For `signature-parameters`, a
 * list lowers item by item: text stays text, a `[name, type]` pair becomes `{ name, type }`, and
 * any other item (a reference included) is kept unlowered; a value that is not a list lowers to
 * `[]`. For any other type, values that are not references or lists are kept.
 */
export function lowerValue(
  value: SyntaxValue,
  type: ValueType,
): unknown {
  if (type === 'signature-parameters') return lowerSignatureParameters(value);
  return lowerComposite(value, type);
}

/**
 * Lowers a new declaration's attributes: every property with a `fallback` starts at it, then
 * the written attributes replace those defaults.
 */
export function mapDeclaredProperties(
  fields: Fields,
  properties: Readonly<Record<string, Property>>,
): RawRecord {
  const defaults = Object.fromEntries(defaultEntries(properties));
  return { ...defaults, ...mapProperties(fields, properties) };
}

/**
 * The written attributes only, under their Model field names, in the property table's order.
 * No defaults are added; `mapDeclaredProperties` adds them.
 */
function mapProperties(
  fields: Fields,
  properties: Readonly<Record<string, Property>>,
): RawRecord {
  return Object.fromEntries(writtenEntries(fields, properties));
}

/** Parameters: text stays text; a `[name, type]` pair becomes `{ name, type }`; others are kept. */
function lowerSignatureParameters(value: SyntaxValue): readonly unknown[] {
  if (!isList(value)) return [];
  return value.map(lowerSignatureParameter);
}

/** One parameter; the pair's type lowers as a type expression. */
function lowerSignatureParameter(item: SyntaxValue): unknown {
  if (typeof item === 'string') return item;
  if (!isPair(item)) return item;
  const name = item[0];
  const type = item[1];
  return { name, type: lowerValue(type, 'type-expression') };
}

/** Whether a value is a two-item list, such as a `[name, type]` parameter pair. */
function isPair(value: SyntaxValue): value is readonly [SyntaxValue, SyntaxValue] {
  return isList(value) && value.length === 2;
}

/** A list lowers item by item; a reference by the property's type; anything else is kept. */
function lowerComposite(
  value: SyntaxValue,
  type: ValueType,
): unknown {
  if (isList(value)) return value.map((item) => lowerValue(item, scalarType(type)));
  if (isReference(value)) return lowerReference(value, type);
  return value;
}

/** The type of a list's items: `endpoint` for an `endpoints` list, otherwise `id`. */
function scalarType(type: ValueType): ValueType {
  if (type === 'endpoints') return 'endpoint';
  return 'id';
}

/** An endpoint record, a definition reference for a type, or else the plain ID. */
function lowerReference(
  value: Extract<SyntaxValue, { kind: 'reference' }>,
  type: ValueType,
): unknown {
  if (type === 'endpoint') return endpoint(value);
  if (type === 'type-expression') return { kind: 'definition', id: value.id };
  return value.id;
}

/**
 * The lowered `[field, value]` entries of the written properties, in the table's order. Built as
 * the argument of `Object.fromEntries`, so that function is looked up before any input is read.
 */
function writtenEntries(
  fields: Fields,
  properties: Readonly<Record<string, Property>>,
): readonly (readonly [string, unknown])[] {
  const entries = Object.entries(properties);
  return entries.flatMap(([name, property]) => mappedEntry(fields, name, property));
}

/**
 * The `[field, fallback]` entries of the properties that have a default, in the table's order.
 * Built as the argument of `Object.fromEntries`, so that function is looked up before any input
 * is read.
 */
function defaultEntries(
  properties: Readonly<Record<string, Property>>,
): readonly (readonly [string, unknown])[] {
  const all = Object.values(properties);
  const withDefaults = all.filter((property) => property.fallback !== undefined);
  return withDefaults.map((property) => [property.field, property.fallback]);
}

/** The lowered `[field, value]` entry for one property, or none when it is not written. */
function mappedEntry(
  fields: Fields,
  name: string,
  property: Property,
): readonly (readonly [string, unknown])[] {
  const located = fields[name];
  if (located === undefined) return [];
  return [[property.field, lowerValue(located.value, property.type)]];
}
