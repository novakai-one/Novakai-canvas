/*
 * A `.theme` file as the theme grammar reads it: the Templates theme admission and its three font
 * declarations. Pure declarations and the frozen font role list. core/themes/grammar.ts builds it
 * (one body line at a time in core/themes/lines.ts); `theme admit` and render:png read it. Design
 * System checks the token names and values later; the grammar only types them.
 */
import type { BaseTheme, ChromeName, TokenName } from '../brands.js';
import type { Admission, ResourceRequest, Span } from './foreign.js';

/** The three fonts every theme declares, in the order the grammar's error text names them. */
export const fontRoles = Object.freeze(['body', 'mono', 'strong'] as const);

/** One of the three theme font roles. */
export type FontRole = (typeof fontRoles)[number];

/**
 * One `font ROLE source="PATH"` line: a Language font request named by its role. Its span covers
 * the line's text without surrounding whitespace, with real offsets into the file.
 */
export type FontRequest = ResourceRequest & { readonly kind: 'font'; readonly alias: FontRole };

/** A theme's fonts: one body, one mono and one strong font, in file order. */
export type FontTriple = readonly [FontRequest, FontRequest, FontRequest];

/** A `set dimension` value: a finite pixel length, as Design System's dimension token takes it. */
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
  readonly span: Span;
}

/** One `set color|number|dimension TOKEN=VALUE` line: its typed value, token and span. */
export type TokenOverride = OverrideValue & OverrideLine;

/** The theme's `raw` input: the base theme, the optional chrome and each override's value by token. */
export interface ThemeRaw {
  readonly base: BaseTheme;
  readonly chrome?: ChromeName;
  readonly overrides: Readonly<Record<TokenName, OverrideValue['value']>>;
}

/** A Templates theme admission whose `raw` input is the grammar's typed record. */
export type ThemeAdmission = Extract<Admission, { readonly kind: 'theme' }> & {
  readonly raw: ThemeRaw;
};

/** A checked theme file: its admission and its body, mono and strong fonts, in file order. */
export interface ThemeSource {
  readonly admission: ThemeAdmission;
  readonly fonts: FontTriple;
}
