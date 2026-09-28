/*
 * Decoding a quoted string token. Only four escapes exist: `\"`, `\\`, `\n` and `\t`. The text
 * is never evaluated. Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Span } from '../../contract/records/syntax.js';
import { reject } from '../validation/outcomes.js';

/** The character each escape stands for, by the character after the backslash. */
const escapes: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', n: '\n', t: '\t' };

/**
 * Decodes a complete quoted string token.
 *
 * @throws A `LanguageFault` with a `syntax` diagnostic at `span` for any other escape.
 */
export function decodeString(
  text: string,
  span: Span,
): string {
  return text
    .slice(1, -1)
    .replace(/\\([\s\S])/g, (_whole: string, code: string) => decodeEscape(code, span));
}

/** The character for one escape; any escape outside the four is a `syntax` error. */
function decodeEscape(
  code: string,
  span: Span,
): string {
  const value = escapes[code];
  if (value === undefined)
    reject('syntax', span, 'quote, backslash, n or t escape', 'Unknown string escape');
  return value;
}
