/*
 * Lowering a `type` definition: its expression text becomes a type-expression record for Model.
 * An expression is a union (`a | b`) of atoms: a reference (`@id`), a quoted string, `true` or
 * `false`, a number, a primitive name, or a parenthesized union. Pure: nothing is written.
 * Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Declaration, Span } from '../../contract/records/syntax.js';
import { reject } from '../validation/outcomes.js';
import { field, id, text, type RawRecord } from './fields.js';

/** One atom of a type expression. */
type Atom =
  | { readonly kind: 'reference'; readonly id: string }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'primitive'; readonly name: string };

/** One token read from the expression text, and where reading continues. */
interface Scan {
  readonly token: string;
  readonly next: number;
}

/** One lowered expression part, and the index of the first token after it. */
interface Parsed {
  readonly value: RawRecord;
  readonly next: number;
}

/** How to recognise one kind of atom, and how to read it. */
interface AtomMatcher {
  readonly matches: (token: string) => boolean;
  readonly read: (token: string, span: Span) => Atom;
}

/**
 * Lowers a `type` declaration to `{ id, label, expression }`. Quoted literals are never split,
 * and a parenthesized union stays nested. A union of one item is that item itself. An
 * expression is `{ kind: 'reference', id }`, `{ kind: 'literal', value }`,
 * `{ kind: 'primitive', name }` or `{ kind: 'union', items }`.
 *
 * @throws A `LanguageFault` (`invalid-value` at the expression's span) for an empty expression,
 * an unterminated or invalid quoted literal, a token that is not an atom, an unknown atom, an
 * unclosed parenthesis or a token left over; also for a missing or malformed `expression`, `id`
 * or `label` field (see `text`, `field` and `id`).
 */
export function lowerDefinition(declaration: Declaration): RawRecord {
  const source = text(declaration.fields, 'expression');
  const expression = parseExpression(source, field(declaration.fields, 'expression').span);
  return { id: id(declaration.fields), label: text(declaration.fields, 'label'), expression };
}

/** The expression record; every token must be used. */
function parseExpression(
  source: string,
  span: Span,
): RawRecord {
  const tokens = expressionTokens(source, span);
  const parsed = readUnion(tokens, 0, span);
  if (parsed.next !== tokens.length)
    reject('invalid-value', span, 'Complete type expression', 'Unexpected expression token');
  return parsed.value;
}

/** Splits the text into tokens, skipping whitespace; at least one token is required. */
function expressionTokens(
  source: string,
  span: Span,
): readonly string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const item = nextExpressionToken(source, index, span);
    index = item.next;
    appendToken(tokens, item.token);
  }
  return requireExpressionTokens(tokens, span);
}

/** Adds a token; the empty token that stands for skipped whitespace is left out. */
function appendToken(
  tokens: string[],
  token: string,
): void {
  if (token !== '') tokens.push(token);
}

/** An empty expression is rejected. */
function requireExpressionTokens(
  tokens: readonly string[],
  span: Span,
): readonly string[] {
  if (tokens.length === 0)
    reject('invalid-value', span, 'Type expression', 'Definition expression is empty');
  return tokens;
}

/** Whitespace is skipped as an empty token; anything else is read as a symbol or token. */
function nextExpressionToken(
  source: string,
  index: number,
  span: Span,
): Scan {
  const char = source[index] ?? '';
  if (/\s/.test(char)) return { token: '', next: index + 1 };
  return readSymbolOrToken(source, index, span);
}

/** `|`, `(` and `)` are one-character tokens; a quote starts a literal; anything else a word. */
function readSymbolOrToken(
  source: string,
  index: number,
  span: Span,
): Scan {
  const char = source[index] ?? '';
  if ('|()'.includes(char)) return { token: char, next: index + 1 };
  return char === '"' ? readQuotedToken(source, index, span) : readBareToken(source, index, span);
}

/** A quoted literal, quotes included, up to its closing quote. */
function readQuotedToken(
  source: string,
  start: number,
  span: Span,
): Scan {
  const end = requireClosingQuote(source, start, span);
  return { token: source.slice(start, end + 1), next: end + 1 };
}

/** The index of the literal's closing quote; a backslash escapes the next character. */
function requireClosingQuote(
  source: string,
  start: number,
  span: Span,
): number {
  const match = source.slice(start).match(/^"(?:[^"\\]|\\.)*"/);
  if (match === null) reject('invalid-value', span, 'Closing quote', 'Unterminated type literal');
  return start + match[0].length - 1;
}

/**
 * A word (`@` allowed first) or a number. Only the word pattern is anchored at the start, so a
 * number later in the text is also found; the next index still moves by the token's length.
 */
function readBareToken(
  source: string,
  index: number,
  span: Span,
): Scan {
  const match = source
    .slice(index)
    .match(/^@?[A-Za-z][A-Za-z0-9_-]*|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (match === null)
    reject('invalid-value', span, 'Type expression atom', 'Invalid type expression token');
  const token = match[0];
  return { token, next: index + token.length };
}

/** Atoms separated by `|`. One atom is returned as itself; more become a `union`. */
function readUnion(
  tokens: readonly string[],
  start: number,
  span: Span,
): Parsed {
  const first = readAtom(tokens, start, span);
  const items: RawRecord[] = [first.value];
  let next = first.next;
  while (tokens[next] === '|') {
    const item = readAtom(tokens, next + 1, span);
    items.push(item.value);
    next = item.next;
  }
  const value = items.length === 1 ? first.value : { kind: 'union', items };
  return { value, next };
}

/** A parenthesized union, or one atom. */
function readAtom(
  tokens: readonly string[],
  start: number,
  span: Span,
): Parsed {
  if (tokens[start] === '(') {
    return readParenthesized(tokens, start, span);
  }
  const token = tokens[start];
  requireAtomToken(token, span);
  return { value: atom(token, span), next: start + 1 };
}

/** The union inside `(` … `)`; the closing parenthesis is required. */
function readParenthesized(
  tokens: readonly string[],
  start: number,
  span: Span,
): Parsed {
  const nested = readUnion(tokens, start + 1, span);
  if (tokens[nested.next] !== ')')
    reject('invalid-value', span, 'Closing parenthesis', 'Unclosed nested type expression');
  return { value: nested.value, next: nested.next + 1 };
}

/** An atom cannot be missing, `|` or `)`. */
function requireAtomToken(
  token: string | undefined,
  span: Span,
): asserts token is string {
  if (token === undefined || token === '|' || token === ')')
    reject('invalid-value', span, 'Type expression atom', 'Expected a type expression atom');
}

/** The atom the first matching reader gives; a token no reader matches is rejected. */
function atom(
  token: string,
  span: Span,
): Atom {
  const matcher = atomMatchers.find((candidate) => candidate.matches(token));
  if (matcher !== undefined) return matcher.read(token, span);
  reject('invalid-value', span, 'Supported type expression', 'Unknown type expression atom', token);
}

/** The primitive type names. */
const primitiveNames: readonly string[] = ['string', 'number', 'boolean', 'unknown', 'void'];

/** A whole token that is a number (integer, decimal or exponent form). */
const numericLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** The atom readers, tried in order: reference, quoted string, boolean, number, primitive. */
const atomMatchers: readonly AtomMatcher[] = [
  { matches: isReferenceToken, read: referenceAtom },
  { matches: isQuotedToken, read: literalString },
  { matches: isBooleanToken, read: booleanAtom },
  { matches: isNumberToken, read: numberAtom },
  { matches: isPrimitiveToken, read: primitiveAtom },
];

/** Whether the token is a reference (`@id`). */
function isReferenceToken(token: string): boolean {
  return token.startsWith('@');
}

/** A reference to another definition, without its `@`. */
function referenceAtom(token: string): Atom {
  return { kind: 'reference', id: token.slice(1) };
}

/** Whether the token is a quoted literal. */
function isQuotedToken(token: string): boolean {
  return token.startsWith('"');
}

/** A quoted literal's string value; invalid escapes are rejected. */
function literalString(
  token: string,
  span: Span,
): Atom {
  return { kind: 'literal', value: quotedValue(token, span) };
}

/** Reads the quoted literal as JSON; a quoted JSON literal is always a string. */
function quotedValue(
  token: string,
  span: Span,
): string {
  const value = parsedLiteral(token, span);
  if (typeof value !== 'string')
    reject('invalid-value', span, 'Quoted literal', 'Invalid type literal');
  return value;
}

/** `JSON.parse` of the token; a parse error is rejected as an invalid literal. */
function parsedLiteral(
  token: string,
  span: Span,
): unknown {
  try {
    return JSON.parse(token);
  } catch {
    reject('invalid-value', span, 'Quoted literal', 'Invalid type literal');
  }
}

/** Whether the token is `true` or `false`. */
function isBooleanToken(token: string): boolean {
  return token === 'true' || token === 'false';
}

/** A boolean literal. */
function booleanAtom(token: string): Atom {
  return { kind: 'literal', value: token === 'true' };
}

/** Whether the whole token is a number. */
function isNumberToken(token: string): boolean {
  return numericLiteral.test(token);
}

/** A number literal. */
function numberAtom(token: string): Atom {
  return { kind: 'literal', value: Number(token) };
}

/** Whether the token is a primitive type name. */
function isPrimitiveToken(token: string): boolean {
  return primitiveNames.includes(token);
}

/** A primitive type. */
function primitiveAtom(token: string): Atom {
  return { kind: 'primitive', name: token };
}
