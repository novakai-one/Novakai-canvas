/*
 * Reading `name=value` attributes. A run of attributes ends at the first token that is not a
 * word followed by `=` (line breaks do not matter). Each attribute is checked against the
 * construct's property table: unknown names, duplicates, unquoted text, fractional integers,
 * malformed signature parameters and blank types are rejected. Language owns correcting the
 * source; Authoring owns commit recovery.
 */
import type { Fields, LocatedValue, Span } from '../../contract/records/syntax.js';
import type { Property } from '../../contract/records/vocabulary.js';
import { accepted, reject } from '../validation/outcomes.js';
import { peek, advance, consume, type Cursor, type Parsed } from './cursor.js';
import { readValue } from './values.js';
import { checkValue } from './value-types.js';
import { repeat } from './repetition.js';

/** One attribute: its name and its checked value. */
type Attribute = readonly [string, LocatedValue];

/**
 * Reads every attribute at the cursor.
 *
 * @throws A `LanguageFault`: `unknown-property` for a name not in `properties`; `syntax` for a
 * duplicate, unquoted text or a malformed parameter; `invalid-value` for a wrong form, a
 * fractional integer or blank text; `limit` for too many attributes.
 */
export function readAttributes(
  cursor: Cursor,
  properties: Readonly<Record<string, Property>>,
): Parsed<Fields> {
  const entries = accepted(
    repeat(cursor, startsAttribute, (item) => readAttribute(item, properties)),
  );
  const fields = entries.value.reduce(insertUnique, {});
  return { value: fields, next: entries.next };
}

/** Whether an attribute starts here: a word followed by `=`. */
function startsAttribute(cursor: Cursor): boolean {
  if (peek(cursor).kind !== 'word') return false;
  return peek(cursor, 1).text === '=';
}

/**
 * Reads one attribute. Steps run in this order: known name, `=`, read the value, integer without
 * a fraction, quoted text, signature parameters, non-blank type, then the value's form.
 */
function readAttribute(
  cursor: Cursor,
  properties: Readonly<Record<string, Property>>,
): Parsed<Attribute> {
  const name = peek(cursor).text;
  const property = ownProperty(properties, name);
  if (property === undefined)
    reject(
      'unknown-property',
      peek(cursor).span,
      Object.keys(properties).join(' / '),
      'Unknown property',
      name,
    );
  const start = consume(advance(cursor), '=');
  const raw = readValue(start);
  requireIntegerValue(raw, property, name);
  requireQuotedValues(start, raw.next, property);
  requireSignatureParameters(raw.value, property);
  requireNonblankTypeExpression(raw.value, property);
  return { value: [name, checkValue(raw.value, property, name)], next: raw.next };
}

/** The property named `name`, only if it is the table's own entry (not an inherited key). */
function ownProperty(
  properties: Readonly<Record<string, Property>>,
  name: string,
): Property | undefined {
  if (!Object.hasOwn(properties, name)) return undefined;
  return properties[name];
}

/** For an integer property, rejects `1.5`, which would otherwise read as `1` then `.5`. */
function requireIntegerValue(
  raw: Parsed<LocatedValue>,
  property: Property,
  name: string,
): void {
  if (property.type !== 'integer') return;
  rejectFraction(raw, name);
}

/** Rejects a `.` plus integer right after the value, with a span covering the whole number. */
function rejectFraction(
  raw: Parsed<LocatedValue>,
  name: string,
): void {
  if (peek(raw.next).text !== '.' || peek(raw.next, 1).kind !== 'integer') return;
  reject(
    'invalid-value',
    { start: raw.value.span.start, end: peek(raw.next, 1).span.end },
    'Integer',
    'Fractional values are not valid integers',
    name,
  );
}

/**
 * Text properties must be quoted, even when the text looks like a bare word: a `string` value
 * must be one string token; every item of a `strings` list must be a string token.
 */
function requireQuotedValues(
  start: Cursor,
  end: Cursor,
  property: Property,
): void {
  if (property.type === 'string') return requireStringToken(start);
  if (property.type !== 'strings') return;
  requireQuotedList(start, end);
}

/** Rejects a value that is not a string token. */
function requireStringToken(cursor: Cursor): void {
  if (peek(cursor).kind !== 'string')
    reject('syntax', peek(cursor).span, 'Quoted string', 'Text property must be quoted');
}

/** Rejects the first token between the list's brackets that is neither a comma nor a string. */
function requireQuotedList(
  start: Cursor,
  end: Cursor,
): void {
  const between = start.tokens.slice(start.index + 1, end.index - 1);
  const values = between.filter((token) => token.text !== ',');
  const invalid = values.find((token) => token.kind !== 'string');
  if (invalid !== undefined)
    reject('syntax', invalid.span, 'List of quoted strings', 'Text list values must be quoted');
}

/** For a `signature-parameters` property, checks every bracketed item. */
function requireSignatureParameters(
  raw: LocatedValue,
  property: Property,
): void {
  if (property.type !== 'signature-parameters') return;
  (raw.items ?? []).forEach(validateSignatureParameter);
}

/** A parameter is quoted text, or a `[name, type]` pair. */
function validateSignatureParameter(item: LocatedValue): void {
  if (typeof item.value === 'string') return validateLegacyParameter(item);
  if (!Array.isArray(item.value) || item.items?.length !== 2)
    reject('invalid-value', item.span, '[name, type]', 'Structured parameter needs two items');
  const [name, type] = item.items ?? [];
  validateParameterName(name, item.span);
  validateParameterType(type, item.span);
}

/** A text parameter must be quoted and not blank. */
function validateLegacyParameter(item: LocatedValue): void {
  if (item.token?.kind !== 'string')
    reject('syntax', item.span, 'Quoted string', 'Legacy parameter must be quoted');
  if (isBlank(String(item.value)))
    reject('invalid-value', item.span, 'Nonblank parameter', 'Parameter text must be nonblank');
}

/** A pair's name must be quoted and not blank; `fallback` locates a missing name. */
function validateParameterName(
  name: LocatedValue | undefined,
  fallback: Span,
): void {
  if (name?.token?.kind !== 'string')
    reject('syntax', name?.span ?? fallback, 'Quoted string', 'Parameter name must be quoted');
  rejectBlankParameterName(name, fallback);
}

/** Rejects a pair's name that is blank text; `fallback` locates a missing name. */
function rejectBlankParameterName(
  name: LocatedValue | undefined,
  fallback: Span,
): void {
  const nameText = name?.value as string | undefined;
  if (nameText === undefined || !isBlank(nameText)) return;
  reject(
    'invalid-value',
    name?.span ?? fallback,
    'Nonblank parameter name',
    'Parameter name must be nonblank',
  );
}

/** A pair's type is quoted text, or a plain reference to a definition. */
function validateParameterType(
  type: LocatedValue | undefined,
  fallback: Span,
): void {
  if (typeof type?.value === 'string') return validateStringParameterType(type);
  validateReferenceParameterType(type, fallback);
}

/** A text type must be quoted and not blank. */
function validateStringParameterType(type: LocatedValue): void {
  if (type.token?.kind !== 'string')
    reject('syntax', type.span, 'Quoted string', 'Unlinked parameter type must be quoted');
  if (isBlank(String(type.value)))
    reject(
      'invalid-value',
      type.span,
      'Nonblank parameter type',
      'Parameter type must be nonblank',
    );
}

/** A linked type must be a plain `@id`; `fallback` locates a missing type. */
function validateReferenceParameterType(
  type: LocatedValue | undefined,
  fallback: Span,
): void {
  if (!isIdentityReference(type?.value))
    reject(
      'invalid-value',
      type?.span ?? fallback,
      'Definition reference',
      'Linked parameter type must be a plain definition reference',
    );
}

/** Whether the value is a reference object with exactly two keys (`kind` and `id`). */
function isIdentityReference(value: LocatedValue['value'] | undefined): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    'kind' in value &&
    value.kind === 'reference'
  );
}

/** For a `type-expression` property written as text, rejects blank text. */
function requireNonblankTypeExpression(
  raw: LocatedValue,
  property: Property,
): void {
  if (property.type !== 'type-expression' || typeof raw.value !== 'string') return;
  if (isBlank(raw.value))
    reject('invalid-value', raw.span, 'Nonblank type', 'Type must be nonblank');
}

/** Whether the text is empty or only whitespace. */
function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/** Adds one attribute to the fields; the same name twice is a `syntax` error. */
function insertUnique(
  fields: Fields,
  [name, value]: Attribute,
): Fields {
  if (Object.hasOwn(fields, name))
    reject('syntax', value.span, 'One assignment per property', 'Duplicate property', name);
  return { ...fields, [name]: value };
}
