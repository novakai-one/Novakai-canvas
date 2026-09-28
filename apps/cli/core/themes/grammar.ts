/*
 * The `.theme` text grammar: a header, exactly one body, mono and strong font, and uniquely named
 * token overrides → a typed theme source. Pure. Every rule returns a Result and the first failure
 * wins: `invalid-theme` or `duplicate-token`. The caller fixes the theme file and runs the command
 * again. Design System checks token names and values later; the grammar only types them.
 */
import { fontRoles } from '../../contract/records/theme-source.js';
import type {
  FontRequest,
  FontTriple,
  ThemeAdmission,
  ThemeRaw,
  ThemeSource,
  TokenOverride,
} from '../../contract/records/theme-source.js';
import { baseTheme, chromeName, presetId, version } from '../../contract/brands.js';
import type { PresetId, TokenName, Version } from '../../contract/brands.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { combined, joined, mapped } from '../shared/results.js';
import { bodyLine, themeLines, themeMismatch } from './lines.js';
import type { BodyEntry, ThemeLine } from './lines.js';

/**
 * A `.theme` file as its Templates admission and its three fonts. Checks run in this order, and the
 * first failure is returned:
 * 1. the header's shape, then each body line in file order (`invalid-theme`);
 * 2. no token set twice (`duplicate-token`, naming the earliest repeat's line);
 * 3. exactly one body, mono and strong font, then a chrome in Design System's chrome-name form
 *    (`invalid-theme`);
 * 4. the header's @id is a Templates preset ID, then its version a Templates version
 *    (`invalid-theme`, naming the rule).
 */
export function readThemeSource(source: string): Result<ThemeSource> {
  const [first, ...body] = themeLines(source);
  const header = headerText(first);
  if (!header.ok) return header;
  const declared = themeBody(body);
  if (!declared.ok) return declared;
  return themeSource(header.value, declared.value);
}

/** `theme 1 @ID "TITLE" version=X base=ALIAS`, then an optional ` chrome=NAME`. */
const headerPattern =
  /^theme 1 @([\w-]+) "([^"]+)" version=([\w.-]+) base=(\S+)(?: chrome=([\w-]+))?$/;

/** The recovery for a header @id or version Templates would reject. */
const correctHeader = 'Correct the theme header and retry.';

/** The header's text parts, before its @id, version and chrome are checked. */
interface HeaderText {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly base: string;
  /** Absent when the header names no chrome. */
  readonly chrome?: string;
}

/** The body's checked declarations. */
interface ThemeBody {
  readonly fonts: FontTriple;
  readonly overrides: readonly TokenOverride[];
}

/** The first declaration line's header parts. Fails with `invalid-theme` when it is no header. */
function headerText(line: ThemeLine | undefined): Result<HeaderText> {
  const match = headerPattern.exec(line?.text ?? '');
  if (match === null) return failure(themeMismatch);
  return headerParts(match);
}

/**
 * The header's four required captures, then its chrome when written. Fails with `invalid-theme`
 * when a required capture is missing.
 */
function headerParts(match: RegExpExecArray): Result<HeaderText> {
  const [, id, title, versionText, base, chrome] = match;
  if (id === undefined || title === undefined || versionText === undefined || base === undefined)
    return failure(themeMismatch);
  return success(withChrome({ id, title, version: versionText, base }, chrome));
}

/** The parts with `chrome` when the header writes one; absent chrome stays absent. */
function withChrome(
  parts: HeaderText,
  chrome: string | undefined,
): HeaderText {
  if (chrome === undefined) return parts;
  return { ...parts, chrome };
}

/**
 * Every body line, then unique tokens, then the three fonts. Fails as the first unreadable line
 * does, then with `duplicate-token`, then with `invalid-theme` for the fonts.
 */
function themeBody(lines: readonly ThemeLine[]): Result<ThemeBody> {
  const entries = combined(lines.map(bodyLine));
  if (!entries.ok) return entries;
  return joined(
    uniqueOverrides(overridesOf(entries.value)),
    threeFonts(fontsOf(entries.value)),
    (overrides, fonts) => ({ fonts, overrides }),
  );
}

/** The font requests among `entries`, in file order. */
function fontsOf(entries: readonly BodyEntry[]): readonly FontRequest[] {
  return entries.flatMap((entry) => (entry.kind === 'font' ? [entry.font] : []));
}

/** The token overrides among `entries`, in file order. */
function overridesOf(entries: readonly BodyEntry[]): readonly TokenOverride[] {
  return entries.flatMap((entry) => (entry.kind === 'override' ? [entry.override] : []));
}

/**
 * The overrides when no token is set twice. Fails with `duplicate-token` at the earliest line that
 * repeats a token, so a repeat never silently changes the preset's identity.
 */
function uniqueOverrides(overrides: readonly TokenOverride[]): Result<readonly TokenOverride[]> {
  const firstLines = firstLineByToken(overrides);
  const repeat = overrides.find((item) => firstLines.get(item.token) !== lineOf(item));
  if (repeat === undefined) return success(overrides);
  return failure({
    code: 'duplicate-token',
    message: `Line ${lineOf(repeat)} repeats theme token ${repeat.token}`,
    recovery: `Remove the duplicate ${repeat.token} declaration and admit the theme again.`,
  });
}

/** The line each token is first set on. A Map keeps the last entry per key, so read in reverse. */
function firstLineByToken(overrides: readonly TokenOverride[]): ReadonlyMap<TokenName, number> {
  return new Map(
    overrides.toReversed().map((item): readonly [TokenName, number] => [item.token, lineOf(item)]),
  );
}

/** The 1-based line the override is written on. */
function lineOf(override: TokenOverride): number {
  return override.span.start.line;
}

/** The fonts when there is exactly one per role. Fails with `invalid-theme` otherwise. */
function threeFonts(fonts: readonly FontRequest[]): Result<FontTriple> {
  if (!isTriple(fonts) || new Set(fonts.map(roleOf)).size !== fontRoles.length)
    return failure(themeMismatch);
  return success(fonts);
}

/** Whether there is one font per role, counted before the roles are compared. */
function isTriple(fonts: readonly FontRequest[]): fonts is FontTriple {
  return fonts.length === fontRoles.length;
}

/** The role a font request names. */
function roleOf(font: FontRequest): FontRequest['alias'] {
  return font.alias;
}

/**
 * The admission and fonts. Fails with `invalid-theme`: chrome that is not a Design System chrome
 * name, then an @id or version Templates would reject.
 */
function themeSource(
  header: HeaderText,
  body: ThemeBody,
): Result<ThemeSource> {
  const raw = themeRaw(header, body.overrides);
  if (!raw.ok) return raw;
  return joined(themeId(header.id), themeVersion(header.version), (id, checkedVersion) => ({
    admission: admission(header, id, checkedVersion, raw.value),
    fonts: body.fonts,
  }));
}

/**
 * The theme's `raw` input: base, chrome and each override's value by token, in that key order.
 * Fails with `invalid-theme` when the base is empty (the header pattern already refuses one) or
 * the chrome is not a Design System chrome name.
 */
function themeRaw(
  header: HeaderText,
  overrides: readonly TokenOverride[],
): Result<ThemeRaw> {
  const base = checked(baseTheme, header.base, themeMismatch);
  if (!base.ok) return base;
  return mapped(chromeChoice(header.chrome), (chrome) => ({
    base: base.value,
    ...chrome,
    overrides: Object.fromEntries(overrides.map((item) => [item.token, item.value])),
  }));
}

/**
 * The header's chrome as a Design System chrome name. Absent chrome stays absent, so existing
 * immutable preset digests are unchanged. Fails with `invalid-theme`.
 */
function chromeChoice(text: string | undefined): Result<Pick<ThemeRaw, 'chrome'>> {
  if (text === undefined) return success({});
  return mapped(checked(chromeName, text, themeMismatch), (chrome) => ({ chrome }));
}

/** The header's @id as a Templates preset ID. Fails with `invalid-theme` naming the rule. */
function themeId(text: string): Result<PresetId> {
  return checked(
    presetId,
    text,
    headerFault('Theme @id must be 1-80 characters: a letter, then letters, digits, _ or -'),
  );
}

/** The header's version as a Templates version. Fails with `invalid-theme` naming the rule. */
function themeVersion(text: string): Result<Version> {
  return checked(version, text, headerFault('Theme version must be MAJOR.MINOR.PATCH'));
}

/** An `invalid-theme` failure for a header value Templates would reject. */
function headerFault(message: string): FailureInput {
  return { code: 'invalid-theme', message, recovery: correctHeader };
}

/** The Templates theme admission, keys in the order the service has always received them. */
function admission(
  header: HeaderText,
  id: PresetId,
  checkedVersion: Version,
  raw: ThemeRaw,
): ThemeAdmission {
  return {
    schemaVersion: 1,
    kind: 'theme',
    id,
    title: header.title,
    version: checkedVersion,
    description: '',
    raw,
  };
}
