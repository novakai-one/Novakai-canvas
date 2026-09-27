/*
 * A `.theme` file as the theme grammar reads it: the Templates theme admission and its three font
 * declarations. Pure declarations and the frozen font role list. core/themes/grammar.ts builds it;
 * `theme admit` and render:png read it. Design System checks the token names and values later; the
 * grammar only types them.
 */
import type { ChromeName } from '../brands.js';
import type { Admission, ResourceRequest } from './foreign.js';

/** The three fonts every theme declares, in the order the grammar's error text names them. */
export const fontRoles = Object.freeze(['body', 'mono', 'strong'] as const);

/** One of the three theme font roles. */
export type FontRole = (typeof fontRoles)[number];

/** One `font ROLE source="PATH"` line: a Language font request named by its role. */
export type FontRequest = ResourceRequest & { readonly kind: 'font'; readonly alias: FontRole };

/** One `set color|number|dimension TOKEN=VALUE` line, with the line it was written on. */
export type TokenOverride =
  | {
      readonly type: 'color';
      readonly token: string;
      readonly value: string;
      readonly line: number;
    }
  | {
      readonly type: 'number';
      readonly token: string;
      readonly value: number;
      readonly line: number;
    }
  | {
      readonly type: 'dimension';
      readonly token: string;
      readonly value: { readonly value: number; readonly unit: 'px' };
      readonly line: number;
    };

/** The theme's `raw` input: the base theme, the optional chrome and each override's value by token. */
export interface ThemeRaw {
  readonly base: string;
  readonly chrome?: ChromeName;
  readonly overrides: Readonly<Record<string, TokenOverride['value']>>;
}

/** A Templates theme admission whose `raw` input is the grammar's typed record. */
export type ThemeAdmission = Extract<Admission, { readonly kind: 'theme' }> & {
  readonly raw: ThemeRaw;
};

/** A checked theme file: its admission and its body, mono and strong fonts, in file order. */
export interface ThemeSource {
  readonly admission: ThemeAdmission;
  readonly fonts: readonly [FontRequest, FontRequest, FontRequest];
}
