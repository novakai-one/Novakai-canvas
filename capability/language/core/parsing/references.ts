/*
 * Reading IDs and references. An ID is one `@name` token. A reference is an ID, optionally
 * followed by `.@member` (an endpoint) or `/@item` (an item inside a section), or a layout
 * reference written `group:@id` or `section:@id`. Language owns correcting the source; Authoring
 * owns commit recovery.
 */
import type { Reference, LocatedValue } from '../../contract/records/syntax.js';
import { reject } from '../validation/outcomes.js';
import { peek, advance, consume, consumedSpan, type Cursor, type Parsed } from './cursor.js';

/**
 * Reads one `@name` token.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic when the token is not an ID.
 */
export function readIdentity(cursor: Cursor): Parsed<string> {
  const token = peek(cursor);
  if (token.kind !== 'id') reject('syntax', token.span, '@identifier', 'Expected a stable ID');
  return { value: token.text.slice(1), next: advance(cursor) };
}

/**
 * Reads one reference.
 *
 * - A word first means a layout reference: `group:@id` or `section:@id`.
 * - Otherwise an ID, then optionally `.@member` or `/@item` (the ID before `/` is the section).
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic for an unknown namespace, a missing `:`
 * after the namespace word (`Expected :`), or a missing ID.
 */
export function readReference(cursor: Cursor): Parsed<LocatedValue> {
  if (peek(cursor).kind === 'word') return readNamespaced(cursor);
  const id = readIdentity(cursor);
  const tail = readAddressTail(id.value, id.next);
  return {
    value: { value: tail.value, span: consumedSpan(cursor, tail.next), token: peek(cursor) },
    next: tail.next,
  };
}

/** Reads what follows an ID: `.@member`, `/@item`, or nothing. */
function readAddressTail(
  id: string,
  cursor: Cursor,
): Parsed<Reference> {
  const separator = peek(cursor).text;
  if (separator === '.') return readMember(id, advance(cursor));
  if (separator === '/') return readSectionMember(id, advance(cursor));
  return { value: { kind: 'reference', id }, next: cursor };
}

/** Reads the member ID after `.`: the reference is to a member of object `id`. */
function readMember(
  id: string,
  cursor: Cursor,
): Parsed<Reference> {
  const member = readIdentity(cursor);
  return { value: { kind: 'reference', id, member: member.value }, next: member.next };
}

/** Reads the item ID after `/`: the reference is to that item inside section `section`. */
function readSectionMember(
  section: string,
  cursor: Cursor,
): Parsed<Reference> {
  const item = readIdentity(cursor);
  return { value: { kind: 'reference', id: item.value, section }, next: item.next };
}

/** Reads `group:@id` or `section:@id`; any other namespace word is a `syntax` error. */
function readNamespaced(cursor: Cursor): Parsed<LocatedValue> {
  const namespace = peek(cursor).text;
  if (namespace !== 'group' && namespace !== 'section')
    reject(
      'syntax',
      peek(cursor).span,
      'group or section namespace',
      'Unknown reference namespace',
    );
  const id = readIdentity(consume(advance(cursor), ':'));
  return {
    value: {
      value: { kind: 'reference', namespace, id: id.value },
      span: consumedSpan(cursor, id.next),
    },
    next: id.next,
  };
}
