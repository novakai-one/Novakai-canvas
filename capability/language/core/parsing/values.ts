/*
 * Reading one value: quoted text, an integer, a bare word (`true` and `false` become booleans),
 * a reference, or a bracketed list of values. The owning property checks the value's form
 * afterwards (see value-types.ts). Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type { LocatedValue, SyntaxValue } from '../../contract/records/syntax.js';
import { reject, accepted } from '../validation/outcomes.js';
import { decodeString } from '../lexing/strings.js';
import {
  peek,
  advance,
  consume,
  enter,
  leave,
  consumedSpan,
  type Cursor,
  type Parsed,
} from './cursor.js';
import { readReference } from './references.js';
import { repeat } from './repetition.js';

/**
 * Reads one value: a reference (`@…`), a bracketed list (`[…]`), a layout reference
 * (`word:@…`), or a scalar.
 *
 * @throws A `LanguageFault`: `syntax` for a token that is not a value, a bad escape or an
 * unclosed list; `invalid-value` for an integer that is not a safe integer; `limit` for nesting
 * deeper than 64; and, for a list, any diagnostic its item loop (`repeat`) reports, such as
 * `limit` for too many items.
 */
export function readValue(cursor: Cursor): Parsed<LocatedValue> {
  const token = peek(cursor);
  if (token.kind === 'id') return readReference(cursor);
  if (token.text === '[') return readList(cursor);
  return readScalarOrNamespace(cursor);
}

/**
 * Reads references written one after another without brackets, as in `show @a @b`, up to the
 * first token that does not start a reference.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic when there is no reference at all; any
 * fault from reading a reference; and any diagnostic the item loop (`repeat`) reports, such as
 * `limit` for too many references.
 */
export function readReferenceList(cursor: Cursor): Parsed<LocatedValue> {
  const parsed = accepted(repeat(cursor, startsReference, readReference));
  if (parsed.value.length === 0)
    reject('syntax', peek(cursor).span, 'One or more references', 'Reference list is empty');
  return {
    value: {
      value: parsed.value.map((item) => item.value),
      span: consumedSpan(cursor, parsed.next),
    },
    next: parsed.next,
  };
}

/** A word followed by `:` is a layout reference; anything else is a single scalar token. */
function readScalarOrNamespace(cursor: Cursor): Parsed<LocatedValue> {
  if (peek(cursor, 1).text === ':') return readReference(cursor);
  return {
    value: { value: scalar(cursor), span: peek(cursor).span, token: peek(cursor) },
    next: advance(cursor),
  };
}

/** The scalar at the cursor: decoded text, an integer, or a word. */
function scalar(cursor: Cursor): SyntaxValue {
  const token = peek(cursor);
  if (token.kind === 'string') return decodeString(token.text, token.span);
  if (token.kind === 'integer') return readInteger(cursor);
  return readWord(cursor);
}

/** A bare word as a value; punctuation here is a `syntax` error ("Expected a value"). */
function readWord(cursor: Cursor): string | boolean {
  const token = peek(cursor);
  if (token.kind !== 'word')
    reject('syntax', token.span, 'String, enum, integer, boolean or reference', 'Expected a value');
  return wordValue(token.text);
}

/** `true` and `false` become booleans; every other word stays text. */
function wordValue(text: string): string | boolean {
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

/** The integer at the cursor; one that is not a safe integer is rejected, never rounded. */
function readInteger(cursor: Cursor): number {
  const number = Number(peek(cursor).text);
  if (!Number.isSafeInteger(number))
    reject(
      'invalid-value',
      peek(cursor).span,
      'Safe integer',
      'Integer cannot be represented exactly',
    );
  return number;
}

/**
 * Reads `[ ]` or `[a, b, …]`. The first item is read on its own, and every later item must
 * follow a comma, so a trailing comma is a `syntax` error.
 */
function readList(cursor: Cursor): Parsed<LocatedValue> {
  const start = enter(advance(cursor));
  if (peek(start).text === ']') return finishList(cursor, advance(start), []);
  const first = readValue(start);
  const rest = accepted(repeat(first.next, (item) => peek(item).text === ',', readFollowingItem));
  const locatedItems = [first.value, ...rest.value];
  const items = locatedItems.map((item) => item.value);
  return finishList(cursor, consume(rest.next, ']'), items, locatedItems);
}

/** Reads `, value`. */
function readFollowingItem(cursor: Cursor): Parsed<LocatedValue> {
  return readValue(consume(cursor, ','));
}

/** The finished list value, spanning from `[` to `]`, and the cursor one nesting level out. */
function finishList(
  start: Cursor,
  end: Cursor,
  items: readonly SyntaxValue[],
  locatedItems: readonly LocatedValue[] = [],
): Parsed<LocatedValue> {
  return {
    value: { value: items, span: consumedSpan(start, end), items: locatedItems },
    next: leave(end),
  };
}

/** Whether a reference starts here: an `@id`, or a word followed by `:`. */
function startsReference(cursor: Cursor): boolean {
  if (peek(cursor).kind === 'id') return true;
  return peek(cursor, 1).text === ':';
}
