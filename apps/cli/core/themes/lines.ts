/*
 * One `.theme` line at a time: where each declaration line sits in the file, and what one body line
 * declares (a font or a token override). Pure. A line that matches no declaration fails with
 * `invalid-theme`; the caller fixes the theme file and runs the command again.
 */
import { fontRoles } from '../../contract/records/theme-source.js';
import type { FontRole, FontRequest, TokenOverride } from '../../contract/records/theme-source.js';
import type { Span } from '../../contract/records/foreign.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { mapped } from '../shared/results.js';

/** One declaration line: its text without surrounding whitespace, and where that text sits. */
export interface ThemeLine {
  readonly text: string;
  readonly span: Span;
}

/** What one body line declares. */
export type BodyEntry =
  | { readonly kind: 'font'; readonly font: FontRequest }
  | { readonly kind: 'override'; readonly override: TokenOverride };

/** The one `invalid-theme` text for any part of the file that does not match the grammar. */
export const themeMismatch: FailureInput = Object.freeze({
  code: 'invalid-theme',
  message:
    'Expected theme 1 @id "Title" version=X base=ALIAS, font body/mono/strong source="PATH", set color TOKEN="HEX", or set number TOKEN=VALUE',
});

/**
 * The file's declaration lines, in order; blank lines and `#` comments are left out. Lines break
 * at `\n` or `\r\n`. Spans count UTF-16 code units from the start of the file, as Language's do.
 * Nothing can fail here.
 */
export function themeLines(source: string): readonly ThemeLine[] {
  return [...source.matchAll(linePattern)].map(themeLine).filter(isDeclaration);
}

/**
 * What one body line declares: `font ROLE source="PATH"`, or `set color|number|dimension
 * TOKEN=VALUE`. Fails with `invalid-theme` when the line is neither, its font role is not body,
 * mono or strong, or its `set number` value is not finite.
 */
export function bodyLine(line: ThemeLine): Result<BodyEntry> {
  const [matched] = lineRules.flatMap((rule) => ruleMatch(rule, line.text));
  if (matched === undefined) return failure(themeMismatch);
  return matched.rule.read(matched.captures, line);
}

/** Each line with its `\n`; the last line has none. A last line that is empty is not matched. */
const linePattern = /[^\n]*\n|[^\n]+$/g;

/** A body line's two captures: the font role or token, then the font source or token value. */
interface Captures {
  readonly name: string;
  readonly value: string;
}

/** One body line kind: the whole-line pattern and how its captures become a declaration. */
interface LineRule {
  readonly pattern: RegExp;
  read(
    captures: Captures,
    line: ThemeLine,
  ): Result<BodyEntry>;
}

/** A rule whose pattern matched, with the captures it read. */
interface RuleMatch {
  readonly rule: LineRule;
  readonly captures: Captures;
}

/** Every body line kind. Each pattern starts with its own keyword, so at most one matches. */
const lineRules: readonly LineRule[] = Object.freeze([
  { pattern: /^font (\w+) source="([^"]+)"$/, read: fontEntry },
  { pattern: /^set color ([\w.-]+)="(#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?)"$/, read: colorEntry },
  { pattern: /^set number ([\w.-]+)=(-?\d+(?:\.\d+)?)$/, read: numberEntry },
  { pattern: /^set dimension ([\w.-]+)=(-?\d+(?:\.\d+)?)$/, read: dimensionEntry },
]);

/** One matched line: its trimmed text and the span of that text. `index` is 0-based. */
function themeLine(
  match: RegExpExecArray,
  index: number,
): ThemeLine {
  const text = match[0].trim();
  const indent = match[0].length - match[0].trimStart().length;
  const start = position(match.index, index + 1, indent);
  return { text, span: { start, end: position(match.index, index + 1, indent + text.length) } };
}

/** The point `column` code units into the line that starts at `lineStart`; `column` is 0-based. */
function position(
  lineStart: number,
  line: number,
  column: number,
): Span['start'] {
  return { offset: lineStart + column, line, column: column + 1 };
}

/** Whether a line declares something: it is neither blank nor a `#` comment. */
function isDeclaration(line: ThemeLine): boolean {
  return line.text.length > 0 && !line.text.startsWith('#');
}

/** The rule and its captures when `text` matches its pattern; otherwise nothing. */
function ruleMatch(
  rule: LineRule,
  text: string,
): readonly RuleMatch[] {
  const match = rule.pattern.exec(text);
  if (match === null) return [];
  return captured(rule, match);
}

/** The match's two captures. Every rule pattern has exactly two required groups. */
function captured(
  rule: LineRule,
  match: RegExpExecArray,
): readonly RuleMatch[] {
  const [, name, value] = match;
  if (name === undefined || value === undefined) return [];
  return [{ rule, captures: { name, value } }];
}

/** A font request spanning the line. Fails with `invalid-theme` when the role is not a font role. */
function fontEntry(
  captures: Captures,
  line: ThemeLine,
): Result<BodyEntry> {
  const role = captures.name;
  if (!isFontRole(role)) return failure(themeMismatch);
  const font: FontRequest = { kind: 'font', alias: role, source: captures.value, span: line.span };
  return success({ kind: 'font', font });
}

/** Whether `text` names one of the three theme font roles. */
function isFontRole(text: string): text is FontRole {
  return fontRoles.some((role) => role === text);
}

/** A color override; the pattern already checked the `#RRGGBB` or `#RRGGBBAA` value. */
function colorEntry(
  captures: Captures,
  line: ThemeLine,
): Result<BodyEntry> {
  return success(
    overrideEntry({
      type: 'color',
      token: captures.name,
      value: captures.value,
      line: lineOf(line),
    }),
  );
}

/** A number override. Fails with `invalid-theme` when the number is not finite. */
function numberEntry(
  captures: Captures,
  line: ThemeLine,
): Result<BodyEntry> {
  return mapped(finite(captures.value), (value) =>
    overrideEntry({ type: 'number', token: captures.name, value, line: lineOf(line) }),
  );
}

/**
 * A pixel dimension override. Nothing fails here: a value too large to be finite is kept, and
 * admission rejects it later. Only `set number` checks finiteness in the grammar.
 */
function dimensionEntry(
  captures: Captures,
  line: ThemeLine,
): Result<BodyEntry> {
  return success(
    overrideEntry({
      type: 'dimension',
      token: captures.name,
      value: { value: Number(captures.value), unit: 'px' },
      line: lineOf(line),
    }),
  );
}

/** The decimal text as a number. Fails with `invalid-theme` when it is too large to be finite. */
function finite(text: string): Result<number> {
  const value = Number(text);
  if (!Number.isFinite(value)) return failure(themeMismatch);
  return success(value);
}

/** The 1-based line number the declaration is written on. */
function lineOf(line: ThemeLine): number {
  return line.span.start.line;
}

/** A body entry for one token override. */
function overrideEntry(override: TokenOverride): BodyEntry {
  return { kind: 'override', override };
}
