/*
 * Reading declarations such as `node @a step "Label" size=small { … }`. Each construct in the
 * vocabulary lists its positional values, its attributes and the constructs allowed in its
 * braces. A shared type also has a compact form, `type @id "Label" = "A" | "B"`, whose
 * expression is kept as text. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type {
  Declaration,
  Construct,
  Fields,
  LocatedValue,
  Token,
} from '../../contract/records/syntax.js';
import type { ConstructDefinition, PositionRule } from '../../contract/records/vocabulary.js';
import { constructs } from '../vocabulary/constructs.js';
import { reject, accepted } from '../validation/outcomes.js';
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
import { readAttributes } from './attributes.js';
import { readValue, readReferenceList } from './values.js';
import { checkValue } from './value-types.js';
import { repeat } from './repetition.js';
import { readIdentity } from './references.js';

/** The words that end a compact type expression when they are not inside parentheses. */
const typeExpressionEnders: readonly string[] = [
  'type',
  'asset',
  'source',
  'node',
  'wire',
  'section',
  'rank',
  'align',
  'before',
  'below',
];

/** The token texts of a compact type expression, and the tokens themselves. */
interface TypeTokens {
  /** The expression as one string, rebuilt from the token texts. */
  readonly text: string;

  /** The expression's tokens, in order. */
  readonly tokens: readonly Token[];
}

/**
 * Reads one declaration whose construct must be in `allowed`.
 *
 * - `type @id "Label" = …` is read as a compact type.
 * - Otherwise the first word names a construct; its positional values, its attributes and, when
 *   the construct has a body, its braces are read in that order. Required properties are
 *   checked last.
 *
 * @throws A `LanguageFault`: `syntax` for an unknown or disallowed construct, unquoted
 * positional text, a missing required property or an incomplete type expression; `limit` when
 * nesting is too deep; `invalid-value` for a value of the wrong type; and every other fault from
 * reading values, attributes and nested declarations.
 */
export function readDeclaration(
  cursor: Cursor,
  allowed: readonly Construct[],
): Parsed<Declaration> {
  const compactType = compactTypeDeclaration(cursor, allowed);
  if (compactType !== undefined) return compactType;
  const definition = declarationDefinition(cursor, allowed);
  return readDefined(cursor, definition);
}

/**
 * The cases where a type expression's tokens are joined with no space, so that a number such
 * as `1e-5` or `2E+3` stays one piece. Each takes the text so far and the next token.
 */
const exponentMatchers: readonly ((source: string, token: string) => boolean)[] = [
  (source, token) => (token === 'e' || token === 'E') && /\d$/u.test(source),
  (source, token) => /^e[+-]?\d+$/u.test(token) && /\d$/u.test(source),
  (source, token) => (token === '+' || token === '-') && /[eE]$/u.test(source),
  (source, token) => /^[+-]?\d+$/u.test(token) && /[eE][+-]?$/u.test(source),
];

/**
 * Reads the compact type form when the cursor is at `type` and the fourth token is `=`;
 * otherwise `undefined`. The form must be allowed here.
 */
function compactTypeDeclaration(
  cursor: Cursor,
  allowed: readonly Construct[],
): Parsed<Declaration> | undefined {
  if (peek(cursor).text !== 'type' || peek(cursor, 3).text !== '=') return undefined;
  requireAllowedType(cursor, allowed);
  return readType(cursor);
}

/** Rejects a compact type where `type` is not allowed. */
function requireAllowedType(
  cursor: Cursor,
  allowed: readonly Construct[],
): void {
  if (!allowed.includes('type'))
    reject(
      'syntax',
      peek(cursor).span,
      allowed.join(' / '),
      'Declaration is not allowed in this body',
    );
}

/**
 * Reads `type @id "Label" = expression`. The label must be text. The expression runs to the next
 * declaration word or `}` outside parentheses, and is kept as text with its tokens.
 */
function readType(cursor: Cursor): Parsed<Declaration> {
  const start = cursor;
  const identity = readIdentity(advance(cursor, 1));
  const labelValue = readValue(identity.next);
  if (typeof labelValue.value.value !== 'string')
    reject('syntax', labelValue.value.span, 'Quoted label', 'Definition label must be text');
  const expressionStart = consume(labelValue.next, '=');
  const expressionTokens = readTypeTokens(expressionStart);
  const next = expressionTokens.next;
  const expression: LocatedValue = {
    value: expressionTokens.value.text,
    span: consumedSpan(expressionStart, next),
    tokens: expressionTokens.value.tokens,
  };
  return {
    value: {
      kind: 'type',
      fields: {
        id: {
          value: { kind: 'reference', id: identity.value },
          span: peek(advance(cursor, 1)).span,
        },
        label: labelValue.value,
        expression,
      },
      children: [],
      span: consumedSpan(start, next),
    },
    next,
  };
}

/**
 * Collects the expression's tokens up to its end, tracking parenthesis depth. The expression must
 * not be empty and its parentheses must balance.
 */
function readTypeTokens(cursor: Cursor): Parsed<TypeTokens> {
  const tokens: string[] = [];
  const sourceTokens: Token[] = [];
  let current = cursor;
  let depth = 0;
  while (!endsTypeDeclaration(peek(current), depth)) {
    const token = peek(current);
    tokens.push(token.text);
    sourceTokens.push(token);
    depth = nextTypeDepth(token.text, depth);
    current = advance(current);
  }
  requireCompleteType(tokens, depth, peek(current).span);
  return { value: { text: joinTypeTokens(tokens), tokens: sourceTokens }, next: current };
}

/** Whether the expression ends here: outside parentheses, at `}` or a declaration word. */
function endsTypeDeclaration(
  token: Token,
  depth: number,
): boolean {
  if (depth > 0) return false;
  return token.text === '}' || isTypeExpressionEnder(token);
}

/** Whether the token is a word that starts the next declaration. */
function isTypeExpressionEnder(token: Token): boolean {
  return token.kind === 'word' && typeExpressionEnders.includes(token.text);
}

/** The parenthesis depth after this token: `(` opens one level, `)` closes one. */
function nextTypeDepth(
  token: string,
  depth: number,
): number {
  if (token === '(') return depth + 1;
  if (token === ')') return depth - 1;
  return depth;
}

/** Rejects an empty expression or unbalanced parentheses, at the token after the expression. */
function requireCompleteType(
  tokens: readonly string[],
  depth: number,
  span: Token['span'],
): void {
  if (tokens.length === 0 || depth !== 0)
    reject('syntax', span, 'Type expression', 'Expected a complete type expression');
}

/** Rebuilds the expression text from its token texts. */
function joinTypeTokens(tokens: readonly string[]): string {
  return tokens.reduce(joinTypeToken, '');
}

/**
 * Appends one token. `.` and the pieces of an exponent join with no space; any other token
 * follows one space, except at the start or right after a `.`.
 */
function joinTypeToken(
  source: string,
  token: string,
): string {
  if (token === '.' || exponentContinuation(source, token)) return `${source}${token}`;
  if (needsTypeSpace(source)) return `${source} ${token}`;
  return `${source}${token}`;
}

/** Whether the token continues a number's exponent (see {@link exponentMatchers}). */
function exponentContinuation(
  source: string,
  token: string,
): boolean {
  return exponentMatchers.some((matcher) => matcher(source, token));
}

/** Whether a space goes before the next token: not at the start, and not right after `.`. */
function needsTypeSpace(source: string): boolean {
  return source.length > 0 && !source.endsWith('.');
}

/** The construct named by the word at the cursor; it must exist and be allowed here. */
function declarationDefinition(
  cursor: Cursor,
  allowed: readonly Construct[],
): ConstructDefinition {
  const definition = constructs.find((item) => item.kind === peek(cursor).text);
  if (definition === undefined)
    reject('syntax', peek(cursor).span, allowed.join(' / '), 'Unknown declaration');
  if (!allowed.includes(definition.kind))
    reject(
      'syntax',
      peek(cursor).span,
      allowed.join(' / '),
      'Declaration is not allowed in this body',
    );
  return definition;
}

/**
 * Reads a construct's declaration in stages: positional values, attributes, then the body. An
 * attribute with the same name as a positional value replaces it. Required properties are
 * checked after the body is read.
 */
function readDefined(
  cursor: Cursor,
  definition: ConstructDefinition,
): Parsed<Declaration> {
  const positional = definition.positions.reduce(readPosition, {
    value: {},
    next: advance(cursor),
  });
  const attributes = readAttributes(positional.next, definition.properties);
  const children = readChildren(attributes.next, definition.children);
  const fields = { ...positional.value, ...attributes.value };
  checkRequired(fields, definition, cursor);
  return {
    value: {
      kind: definition.kind,
      fields,
      children: children.value,
      span: consumedSpan(cursor, children.next),
    },
    next: children.next,
  };
}

/**
 * Reads one positional value. A literal (such as a wire's `->`) is consumed and not stored. An
 * optional ID is skipped when the next token is not an ID.
 */
function readPosition(
  current: Parsed<Fields>,
  rule: PositionRule,
): Parsed<Fields> {
  if (rule.literal !== undefined) return { ...current, next: consume(current.next, rule.literal) };
  if (optionalIdentityMissing(current.next, rule)) return current;
  return readRequiredPosition(current, rule);
}

/** Whether an optional ID position is left out: the next token is not an ID. */
function optionalIdentityMissing(
  cursor: Cursor,
  rule: PositionRule,
): boolean {
  return rule.optional === true && peek(cursor).kind !== 'id';
}

/**
 * Reads a positional value, checks its form, then (for text) checks that it was quoted, and
 * stores it under the rule's name.
 */
function readRequiredPosition(
  current: Parsed<Fields>,
  rule: PositionRule,
): Parsed<Fields> {
  const raw = positionalValue(current.next, rule.type);
  const checked = checkValue(raw.value, { ...rule, field: rule.name }, rule.name);
  requireQuotedPosition(current.next, rule);
  return { value: { ...current.value, [rule.name]: checked }, next: raw.next };
}

/** Reads the value; `references` and `targets` positions are unbracketed lists (`show @a @b`). */
function positionalValue(
  cursor: Cursor,
  type: PositionRule['type'],
): Parsed<LocatedValue> {
  if (type === 'references' || type === 'targets') return readReferenceList(cursor);
  return readValue(cursor);
}

/** Text positions must be quoted, so a bare word (such as a keyword) is not taken as text. */
function requireQuotedPosition(
  cursor: Cursor,
  rule: PositionRule,
): void {
  if (rule.type !== 'string') return;
  if (peek(cursor).kind !== 'string')
    reject('syntax', peek(cursor).span, 'Quoted string', 'Positional text must be quoted');
}

/**
 * Rejects the first required property (in the construct's order) that is missing, at the
 * declaration's first token. A required property has no default; Model checks relations
 * afterwards.
 */
function checkRequired(
  fields: Fields,
  definition: ConstructDefinition,
  cursor: Cursor,
): void {
  Object.entries(definition.properties).forEach(([name, property]) => {
    if (property.required && !Object.hasOwn(fields, name))
      reject('syntax', peek(cursor).span, name, 'Required property is missing');
  });
}

/**
 * Reads `{ declarations }` when the construct has a body (`allowed` is not `null`); nested
 * declarations must be in `allowed`. A construct without a body reads nothing.
 */
function readChildren(
  cursor: Cursor,
  allowed: readonly Construct[] | null,
): Parsed<readonly Declaration[]> {
  if (allowed === null) return { value: [], next: cursor };
  const body = enter(consume(cursor, '{'));
  const children = accepted(
    repeat(
      body,
      (item) => peek(item).text !== '}',
      (item) => readDeclaration(item, allowed),
    ),
  );
  return { value: children.value, next: leave(consume(children.next, '}')) };
}
