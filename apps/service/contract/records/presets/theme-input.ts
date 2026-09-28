/*
 * Why this file exists
 *
 * A person writes a theme in source syntax: a base theme by name (`base=paper`), colours as hex
 * text (`#245ba0`), fonts by name. Templates and Design System need an exact form instead: the base
 * as an exact version, every value checked.
 *
 * This file holds the checks for both forms: `sourceTheme` (source syntax, which theme saving in
 * core/presets/theme-admission.ts translates), `exactTheme` (the exact form the theme codec
 * resolves) and `hexColour` (one colour). Declarations only; Design System checks the tokens.
 */
import { z } from 'zod';
import { chromeName } from '@novakai/canvas-design-system';
/** Checks an exact theme version: kind `theme`, ID, version and digest. */
const themeVersion = z.strictObject({
  kind: z.literal('theme'),
  id: z.string(),
  version: z.string(),
  digest: z.string(),
});
/**
 * Checks a theme in the exact form the theme codec resolves: the chrome, the base (Design
 * System's own UI tokens, or an exact stored theme and its content), the fonts and the token
 * overrides. Design System checks the fonts and overrides.
 */
export const exactTheme = z.strictObject({
  chrome: chromeName.optional(),
  base: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ui'), pin: z.unknown() }),
    z.strictObject({
      kind: z.literal('preset'),
      pin: themeVersion,
      payload: z.unknown().optional(),
    }),
  ]),
  fonts: z.unknown(),
  overrides: z.unknown(),
});
/** A theme that passed {@link exactTheme}. */
export type ExactTheme = z.infer<typeof exactTheme>;

/**
 * Checks a theme still in source syntax: the base (a theme ID such as `paper`, or an exact version
 * such as `paper@1.0.0#sha256:…`) and the token overrides. Other keys pass through untouched.
 */
export const sourceTheme = z.looseObject({
  kind: z.literal('theme'),
  raw: z.strictObject({
    // chromeField rejects malformed selectors instead of bypassing source preparation.
    chrome: z.unknown().optional(),
    base: z.string(),
    overrides: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.strictObject({ value: z.number().finite(), unit: z.literal('px') }).readonly(),
      ]),
    ),
  }),
});
/** A source-syntax theme that passed {@link sourceTheme}. */
export type SourceTheme = z.infer<typeof sourceTheme>;
/** One source-syntax token override: a hex colour, a number, or a pixel dimension. */
export type ThemeOverride = SourceTheme['raw']['overrides'][string];

/** Checks a source-syntax colour: `#rrggbb` or `#rrggbbaa`, in either case. */
export const hexColour = z.string().regex(/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/);
