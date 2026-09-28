/*
 * The lexer: turns source text into tokens. Every character belongs to some lexeme, so nothing
 * is skipped silently; whitespace and `#` comments are dropped, and anything else becomes a
 * token, except a lone `"`, which is rejected. A final `eof` token marks the end. Language owns
 * correcting the source; Authoring owns commit recovery.
 */
import type { Token } from '../../contract/records/syntax.js';
import type { Result } from '../../contract/errors.js';
import { protect, reject, origin } from '../validation/outcomes.js';
import { lineStarts, sourceSpan } from './locations.js';

/** The most tokens one source may have, not counting the final `eof`. */
const maxTokens = 250000;

/**
 * The lexeme alternatives, tried in this order at each position. The last one matches any
 * single character, so every character is covered.
 */
const lexemePatterns: readonly string[] = [
  // Whitespace.
  String.raw`\s+`,
  // A comment, to the end of the line.
  String.raw`#[^\n]*`,
  // A complete quoted string, with backslash escapes.
  String.raw`"(?:\\[\s\S]|[^"\\])*"`,
  // An ID such as `@start`.
  String.raw`@[A-Za-z][A-Za-z0-9_-]*`,
  // A cardinality: `0..1`, `0..many`, `1..1` or `1..many`.
  String.raw`(?:0|1)\.\.(?:1|many)`,
  // An integer, optionally negative.
  String.raw`-?\d+`,
  // A bare word.
  String.raw`[A-Za-z][A-Za-z0-9_-]*`,
  // The arrow.
  String.raw`->`,
  // One punctuation character.
  String.raw`[{}\[\],=.:/]`,
  // Any other single character. `(`, `)` and `|` in type expressions end up here as `symbol`
  // tokens, since the punctuation class above does not include them; a lone `"` also ends up
  // here and is then rejected.
  String.raw`[\s\S]`,
];

/** One global expression matching any of {@link lexemePatterns}. */
const lexeme = new RegExp(lexemePatterns.join('|'), 'g');

/**
 * Splits source text into tokens, ending with `eof`. Fails with `syntax` for an unterminated
 * string, or `limit` above 250,000 tokens.
 */
export function tokenize(source: string): Result<readonly Token[]> {
  return protect(() => collectTokens(source));
}

/** Every token in the source, then `eof`. */
function collectTokens(source: string): readonly Token[] {
  const starts = lineStarts(source);
  const tokens: Token[] = [];
  for (const match of source.matchAll(lexeme)) appendToken(tokens, match, starts);
  tokens.push({ kind: 'eof', text: '', span: sourceSpan(starts, source.length, source.length) });
  return tokens;
}

/**
 * Adds one lexeme as a token, unless it is whitespace or a comment. A lone `"` is rejected, and
 * the token limit is checked before the array grows.
 */
function appendToken(
  tokens: Token[],
  match: RegExpExecArray,
  starts: readonly number[],
): void {
  if (isTrivia(match[0])) return;
  requireCompleteLexeme(match, starts);
  if (tokens.length >= maxTokens)
    reject('limit', origin, `At most ${maxTokens} tokens`, 'Token limit exceeded');
  tokens.push({
    kind: classify(match[0]),
    text: match[0],
    span: sourceSpan(starts, match.index, match.index + match[0].length),
  });
}

/** Whether the lexeme is whitespace or a comment. */
function isTrivia(text: string): boolean {
  return /^\s|^#/.test(text);
}

/** Rejects a lone `"`: a string that never closes matched only the any-character fallback. */
function requireCompleteLexeme(
  match: RegExpExecArray,
  starts: readonly number[],
): void {
  if (match[0] === '"')
    reject(
      'syntax',
      sourceSpan(starts, match.index, match.index + 1),
      'Closing unescaped quote',
      'Unterminated quoted string',
    );
}

/** The token kind of a lexeme: `string`, `id`, or a bare kind from {@link classifyBare}. */
function classify(text: string): Token['kind'] {
  if (text.startsWith('"')) return 'string';
  if (text.startsWith('@')) return 'id';
  return classifyBare(text);
}

/**
 * The kind of any other lexeme: `integer` for an optionally negative run of digits, `word` for
 * anything starting with a letter or digit (cardinalities are words), otherwise `symbol`.
 */
function classifyBare(text: string): Token['kind'] {
  if (/^-?\d+$/.test(text)) return 'integer';
  if (/^[A-Za-z0-9]/.test(text)) return 'word';
  return 'symbol';
}
