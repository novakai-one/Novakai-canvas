/*
 * The parser's position in the token list. A cursor is never changed: every step returns a new
 * one, so a reader can look ahead and give up without undoing anything. The cursor also counts
 * nesting depth, which is limited to 64. Language owns correcting the source; Authoring owns
 * commit recovery.
 */
import type { Token, Span } from '../../contract/records/syntax.js';
import { reject, origin } from '../validation/outcomes.js';

/** The deepest nesting of braces and lists allowed. */
const maxNesting = 64;

/** A position in the token list. */
export interface Cursor {
  /** All tokens of the source, ending with `eof`. */
  readonly tokens: readonly Token[];

  /** The index of the current token. */
  readonly index: number;

  /** How many braces or lists are open here. */
  readonly depth: number;
}

/** What a reader returns: the value it read and the cursor after it. */
export interface Parsed<T> {
  /** The value read. */
  readonly value: T;

  /** The cursor just after what was read. */
  readonly next: Cursor;
}

/**
 * The token at the cursor, or `ahead` tokens after it, without moving.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic ("Unexpected end of source") past the
 * last token. The diagnostic is at the start of the source (`origin`), not at the cursor.
 */
export function peek(
  cursor: Cursor,
  ahead = 0,
): Token {
  const token = cursor.tokens[cursor.index + ahead];
  if (token === undefined)
    reject('syntax', origin, 'Complete statement', 'Unexpected end of source');
  return token;
}

/** Moves forward, keeping the nesting depth. */
export function advance(
  cursor: Cursor,
  count = 1,
): Cursor {
  return { ...cursor, index: cursor.index + count };
}

/**
 * Moves past a token that must have exactly the text `expected`.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic ("Expected …") when the token differs,
 * or from {@link peek} at the end of the tokens.
 */
export function consume(
  cursor: Cursor,
  expected: string,
): Cursor {
  const token = peek(cursor);
  if (token.text !== expected) reject('syntax', token.span, expected, `Expected ${expected}`);
  return advance(cursor);
}

/**
 * Opens one more level of nesting. The limit keeps deeply nested source from exhausting the
 * JavaScript stack.
 *
 * @throws A `LanguageFault` with a `limit` diagnostic when 64 levels are already open.
 */
export function enter(cursor: Cursor): Cursor {
  if (cursor.depth >= maxNesting)
    reject('limit', peek(cursor).span, `Nesting at most ${maxNesting}`, 'Nesting limit exceeded');
  return { ...cursor, depth: cursor.depth + 1 };
}

/** Closes one level of nesting after a complete brace or list body. */
export function leave(cursor: Cursor): Cursor {
  return { ...cursor, depth: cursor.depth - 1 };
}

/**
 * The span of the tokens read between two cursors: from the first token at `start` to the last
 * token before `end`. The token at `end` is not included.
 *
 * @throws From {@link peek} when `start` is past the last token.
 */
export function consumedSpan(
  start: Cursor,
  end: Cursor,
): Span {
  const final = start.tokens[Math.max(start.index, end.index - 1)];
  return { start: peek(start).span.start, end: final?.span.end ?? peek(start).span.end };
}
