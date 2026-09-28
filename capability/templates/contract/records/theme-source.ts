/*
 * A `.theme` file as Templates' theme grammar reads it: the theme admission and its three font
 * declarations. Pure declarations and the frozen font role list. core/theme-source/grammar.ts
 * builds it (one body line at a time in core/theme-source/lines.ts); the host stages the fonts and
 * submits the admission. Design System checks the token names and values when the theme is
 * admitted; the grammar only types them.
 */
import type { BaseTheme, ChromeName, TokenName } from '../brands.js';
import type { Admission } from './preset.js';

/** The three fonts every theme declares, in the order the grammar's error text names them. */
export const fontRoles = Object.freeze(['body', 'mono', 'strong'] as const);

/** One of the three theme font roles. */
export type FontRole = (typeof fontRoles)[number];

/**
 * One point in a `.theme` file. `offset` counts UTF-16 code units from the start of the file;
 * `line` and `column` start at 1. Language counts source positions the same way.
 */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** Where a declaration's text sits. `end` is the first position after the text. */
export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/**
 * One `font ROLE source="PATH"` line: the font the theme asks for, named by its role, and its path
 * as written, relative to the theme file. It has the shape of Language's font resource request,
 * so a host stages theme fonts and DSL fonts alike. Its span covers the line's text without
 * surrounding whitespace.
 */
export interface FontRequest {
  readonly kind: 'font';
  readonly alias: FontRole;
  readonly source: string;
  readonly span: SourceSpan;
}

/** A theme's fonts: one body, one mono and one strong font, in file order. */
export type FontTriple = readonly [FontRequest, FontRequest, FontRequest];

/** A `set dimension` value: a pixel length, as Design System's dimension token takes it. */
export interface PixelDimension {
  readonly value: number;
  readonly unit: 'px';
}

/** A `set` line's value, tagged by its `type`: color text, a number or a pixel dimension. */
export type OverrideValue =
  | { readonly type: 'color'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'dimension'; readonly value: PixelDimension };

/** What every token override carries: the token it sets and where its line's text sits. */
interface OverrideLine {
  readonly token: TokenName;
  readonly span: SourceSpan;
}

/** One `set color|number|dimension TOKEN=VALUE` line: its typed value, token and span. */
export type TokenOverride = OverrideValue & OverrideLine;

/** The theme's `raw` input: the base theme, the optional chrome and each override's value by token. */
export interface ThemeRaw {
  readonly base: BaseTheme;
  readonly chrome?: ChromeName;
  readonly overrides: Readonly<Record<TokenName, OverrideValue['value']>>;
}

/** A theme admission whose `raw` input is the grammar's typed record. */
export type ThemeAdmission = Extract<Admission, { readonly kind: 'theme' }> & {
  readonly raw: ThemeRaw;
};

/** A checked theme file: its admission and its body, mono and strong fonts, in file order. */
export interface ThemeSource {
  readonly admission: ThemeAdmission;
  readonly fonts: FontTriple;
}
