/*
 * The `.theme` text grammar: header, three fonts and token overrides → a typed theme source. Pure.
 * Grammar faults are thrown privately and returned as `invalid-theme` or `duplicate-token`; the
 * caller fixes the theme file and runs the command again.
 */
import { fontRoles } from '../../contract/records/theme-source.js';
import type {
  FontRequest,
  FontRole,
  ThemeRaw,
  ThemeSource,
  TokenOverride,
} from '../../contract/records/theme-source.js';
import {
  chromeName,
  presetId,
  version,
  type PresetId,
  type Version,
} from '../../contract/brands.js';
import type { LocalCode, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** One trimmed, non-comment line and its 1-based line number. */
interface Line {
  readonly text: string;
  readonly line: number;
}
/** What one body line declares: a font, or token overrides. */
interface Entry {
  readonly fonts: readonly FontRequest[];
  readonly overrides: readonly TokenOverride[];
}
/** The codes a theme file can fail with. */
type ThemeCode = Extract<LocalCode, 'invalid-theme' | 'duplicate-token'>;
/** Theme grammar faults retain a stable reason and exact corrective instruction. */
class ThemeFault extends Error {
  constructor(
    readonly code: ThemeCode,
    message: string,
    readonly recovery: string,
  ) {
    super(message);
  }
}
/**
 * Read semantic token intent; syntax failures retain the source for CLI correction, while Design
 * System owns token validation. Fails with `invalid-theme` (the text does not match the grammar,
 * or the header's @id or version is not a Templates preset ID or version) or `duplicate-token`.
 */
export function readThemeSource(source: string): Result<ThemeSource> {
  try {
    return success(parse(source));
  } catch (error) {
    return themeFailure(error);
  }
}
/** A ThemeFault keeps its code and recovery; any other grammar throw is `invalid-theme`. */
function themeFailure(error: unknown): Result<never, LocalFailure> {
  if (error instanceof ThemeFault)
    return failure({ code: error.code, message: error.message, recovery: error.recovery });
  return failure({
    code: 'invalid-theme',
    message:
      'Expected theme 1 @id "Title" version=X base=ALIAS, font body/mono/strong source="PATH", set color TOKEN="HEX", or set number TOKEN=VALUE',
  });
}
/**
 * Header vocabulary is intentionally closed and coordinate-free; no diagram or typography metric
 * model is introduced. Checks run in the base order (lines, duplicate tokens, fonts, chrome); the
 * header's @id and version are checked last.
 */
function parse(source: string): ThemeSource {
  const lines = source
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter((item) => item.text.length > 0 && !item.text.startsWith('#'));
  const header =
    /^theme 1 @([\w-]+) "([^"]+)" version=([\w.-]+) base=(\S+)(?: chrome=([\w-]+))?$/.exec(
      lines[0]?.text ?? '',
    );
  if (!header) throw new Error('Invalid theme header');
  const entries = lines.slice(1).map(line);
  const overrides = uniqueOverrides(entries.flatMap((item) => item.overrides));
  const fonts = threeFonts(entries.flatMap((item) => item.fonts));
  const raw = themeRaw(required(header, 4), header[5], overrides);
  return {
    admission: {
      schemaVersion: 1,
      kind: 'theme',
      id: themeId(required(header, 1)),
      title: required(header, 2),
      version: themeVersion(required(header, 3)),
      description: '',
      raw,
    },
    fonts,
  };
}
/** Exactly one body, one mono and one strong font, in file order. */
function threeFonts(fonts: readonly FontRequest[]): ThemeSource['fonts'] {
  const [first, second, third, ...rest] = fonts;
  const roles = new Set(fonts.map((item) => item.alias));
  if (first === undefined || second === undefined || third === undefined) throw missingFonts();
  if (rest.length > 0 || roles.size !== fontRoles.length) throw missingFonts();
  return [first, second, third];
}
/** The fault for anything but exactly body, mono and strong. */
function missingFonts(): Error {
  return new Error('Exactly body, mono and strong are required');
}
/**
 * Font and token syntax is translated only; Design System owns token types, bounds and derived
 * values. A `font` line whose role is not body, mono or strong is read as a token line, which
 * rejects it.
 */
function line(input: Line): Entry {
  const font = /^font (\w+) source="([^"]+)"$/.exec(input.text);
  if (!font) return tokenLine(input);
  const role = required(font, 1);
  if (!isFontRole(role)) return tokenLine(input);
  return fontEntry(role, required(font, 2), input);
}
/** Whether `text` names one of the three theme font roles. */
function isFontRole(text: string): text is FontRole {
  return fontRoles.some((role) => role === text);
}
/** A line that declares one font: a Language font request spanning the whole line. */
function fontEntry(
  role: FontRole,
  source: string,
  input: Line,
): Entry {
  const span = {
    start: { line: input.line, column: 1, offset: 0 },
    end: { line: input.line, column: input.text.length + 1, offset: input.text.length },
  };
  return { fonts: [{ kind: 'font', alias: role, source, span }], overrides: [] };
}
/** Existing color syntax remains unchanged; numeric root tokens enable reusable readable diagram themes. */
function tokenLine(input: Line): Entry {
  const color = /^set color ([\w.-]+)="(#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?)"$/.exec(input.text);
  if (!color) return numberLine(input);
  return overrideEntry({
    type: 'color',
    token: required(color, 1),
    value: required(color, 2),
    line: input.line,
  });
}

/** Parse finite numbers without inventing token names or duplicating owner range validation. */
function numberLine(input: Line): Entry {
  const match = /^set number ([\w.-]+)=(-?\d+(?:\.\d+)?)$/.exec(input.text);
  if (!match) return dimensionLine(input);
  const value = Number(required(match, 2));
  if (!Number.isFinite(value)) throw new Error('Theme number must be finite');
  return overrideEntry({ type: 'number', token: required(match, 1), value, line: input.line });
}

/** Duplicate tokens reject at the second declaration instead of silently changing preset identity. */
function uniqueOverrides(overrides: readonly TokenOverride[]): readonly TokenOverride[] {
  const duplicate = overrides.find(
    (item, index, all) => all.findIndex((candidate) => candidate.token === item.token) !== index,
  );
  if (duplicate)
    throw new ThemeFault(
      'duplicate-token',
      `Line ${duplicate.line} repeats theme token ${duplicate.token}`,
      `Remove the duplicate ${duplicate.token} declaration and admit the theme again.`,
    );
  return overrides;
}

/** Regex captures are checked before becoming semantic identifiers. */
function required(
  match: RegExpExecArray,
  index: number,
): string {
  const value = match[index];
  if (value === undefined) throw new Error('Missing capture');
  return value;
}

/** The header's @id as a Templates preset ID; otherwise `invalid-theme` naming the rule. */
function themeId(text: string): PresetId {
  const checked = presetId.safeParse(text);
  if (!checked.success)
    throw headerFault('Theme @id must be 1-80 characters: a letter, then letters, digits, _ or -');
  return checked.data;
}

/** The header's version as a Templates version; otherwise `invalid-theme` naming the rule. */
function themeVersion(text: string): Version {
  const checked = version.safeParse(text);
  if (!checked.success) throw headerFault('Theme version must be MAJOR.MINOR.PATCH');
  return checked.data;
}

/** An `invalid-theme` fault for a header value Templates would reject. */
function headerFault(message: string): ThemeFault {
  return new ThemeFault('invalid-theme', message, 'Correct the theme header and retry.');
}

/**
 * The theme's `raw` input: base, chrome and each override's value by token. The chrome capture is
 * checked by chromeName before transport; absent chrome stays absent so existing immutable preset
 * digests remain unchanged.
 */
function themeRaw(
  base: string,
  chrome: string | undefined,
  overrides: readonly TokenOverride[],
): ThemeRaw {
  const values = Object.fromEntries(overrides.map((item) => [item.token, item.value]));
  if (chrome === undefined) return { base, overrides: values };
  return { base, chrome: chromeName.parse(chrome), overrides: values };
}

/** Explicit pixel dimensions preserve Design System's typed literal vocabulary. */
function dimensionLine(input: Line): Entry {
  const match = /^set dimension ([\w.-]+)=(-?\d+(?:\.\d+)?)$/.exec(input.text);
  if (!match) throw new Error('Invalid theme line');
  return overrideEntry({
    type: 'dimension',
    token: required(match, 1),
    value: { value: Number(required(match, 2)), unit: 'px' },
    line: input.line,
  });
}

/** A line that declares one token override and no font. */
function overrideEntry(override: TokenOverride): Entry {
  return { fonts: [], overrides: [override] };
}
