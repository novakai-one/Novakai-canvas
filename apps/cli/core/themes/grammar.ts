/*
 * The `.theme` text grammar: header, three fonts and token overrides → a theme admission and its
 * font requests. Pure. Grammar faults are thrown privately and returned as `invalid-theme` or
 * `duplicate-token`; the caller fixes the theme file and runs the command again.
 */
import type { ResourceRequest } from '../../contract/records/resources.js';
import type { PortableToken } from '../../contract/records/foreign.js';
import { chromeName, type ChromeName } from '../../contract/brands.js';
import type { LocalCode, LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
interface Override {
  readonly token: string;
  // Existing raw color/scalar syntax stays at the grammar edge; dimensions reuse the owner vocabulary.
  readonly value:
    | string
    | number
    | (Pick<Extract<PortableToken, { readonly type: 'dimension' }>, 'value'> & {
        readonly unit: 'px';
      });
  readonly line: number;
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
/** Read semantic token intent; syntax failures retain the source for CLI correction, while Design System owns token validation. */
export function readThemeConfig(
  source: string,
): Result<{ readonly admission: unknown; readonly resources: readonly ResourceRequest[] }> {
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
/** Header vocabulary is intentionally closed and coordinate-free; no diagram or typography metric model is introduced. */
function parse(source: string): {
  readonly admission: unknown;
  readonly resources: readonly ResourceRequest[];
} {
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
  const resources = entries.flatMap((item) => item.resources);
  const overrides = uniqueOverrides(entries.flatMap((item) => item.overrides));
  if (resources.length !== 3 || new Set(resources.map((item) => item.alias)).size !== 3)
    throw new Error('Exactly body, mono and strong are required');
  return {
    admission: {
      schemaVersion: 1,
      kind: 'theme',
      id: header[1],
      title: header[2],
      version: header[3],
      description: '',
      raw: {
        base: header[4],
        ...chromeField(header[5]),
        overrides: Object.fromEntries(overrides.map((item) => [item.token, item.value])),
      },
    },
    resources,
  };
}
/** Font and token syntax is translated only; Design System owns token types, bounds and derived values. */
function line(input: { readonly text: string; readonly line: number }): {
  readonly resources: readonly ResourceRequest[];
  readonly overrides: readonly Override[];
} {
  const font = /^font (body|mono|strong) source="([^"]+)"$/.exec(input.text);
  if (font)
    return {
      resources: [
        {
          kind: 'font',
          alias: required(font, 1),
          source: required(font, 2),
          span: {
            start: { line: input.line, column: 1, offset: 0 },
            end: { line: input.line, column: input.text.length + 1, offset: input.text.length },
          },
        },
      ],
      overrides: [],
    };
  return tokenLine(input);
}
/** Existing color syntax remains unchanged; numeric root tokens enable reusable readable diagram themes. */
function tokenLine(input: { readonly text: string; readonly line: number }): {
  readonly resources: readonly ResourceRequest[];
  readonly overrides: readonly Override[];
} {
  const color = /^set color ([\w.-]+)="(#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?)"$/.exec(input.text);
  if (!color) return numberLine(input);
  return {
    resources: [],
    overrides: [{ token: required(color, 1), value: required(color, 2), line: input.line }],
  };
}

/** Parse finite numbers without inventing token names or duplicating owner range validation. */
function numberLine(input: { readonly text: string; readonly line: number }): {
  readonly resources: readonly ResourceRequest[];
  readonly overrides: readonly Override[];
} {
  const match = /^set number ([\w.-]+)=(-?\d+(?:\.\d+)?)$/.exec(input.text);
  if (!match) return dimensionLine(input);
  const value = Number(required(match, 2));
  if (!Number.isFinite(value)) throw new Error('Theme number must be finite');
  return {
    resources: [],
    overrides: [{ token: required(match, 1), value, line: input.line }],
  };
}

/** Duplicate tokens reject at the second declaration instead of silently changing preset identity. */
function uniqueOverrides(overrides: readonly Override[]): readonly Override[] {
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

/** Raw regex capture is checked by chromeName before transport; absent chrome stays absent so existing immutable preset digests remain unchanged. */
function chromeField(chrome: string | undefined): { readonly chrome?: ChromeName } {
  if (chrome === undefined) return {};
  return { chrome: chromeName.parse(chrome) };
}

/** Explicit pixel dimensions preserve Design System's typed literal vocabulary. */
function dimensionLine(input: Parameters<typeof line>[0]): {
  readonly resources: readonly ResourceRequest[];
  readonly overrides: readonly Override[];
} {
  const match = /^set dimension ([\w.-]+)=(-?\d+(?:\.\d+)?)$/.exec(input.text);
  if (!match) throw new Error('Invalid theme line');
  return {
    resources: [],
    overrides: [
      {
        token: required(match, 1),
        value: { value: Number(required(match, 2)), unit: 'px' },
        line: input.line,
      },
    ],
  };
}
