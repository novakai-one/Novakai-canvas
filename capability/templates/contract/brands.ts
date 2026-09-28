import { z } from 'zod';

/**
 * Checks a preset ID (also used as an expansion namespace): 1–80 characters, a letter then
 * letters, digits, `_` or `-`. The preset's `kind` keeps recipe and theme IDs apart.
 */
export const presetId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .brand<'PresetId'>();

/**
 * Checks a SHA-256 content digest: 64 lowercase hex characters. It identifies exact media or
 * preset content, never a file name or a URL that could change.
 */
export const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'PresetDigest'>();

/**
 * Checks a release version `major.minor.patch`: at most 50 characters, numbers without leading
 * zeros, and each part a safe integer.
 */
export const version = z
  .string()
  .max(50)
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/)
  .refine((value) => value.split('.').every((part) => Number.isSafeInteger(Number(part))))
  .brand<'PresetVersion'>();

/**
 * Checks a theme's card chrome name: 1–60 characters, a lowercase letter, then lowercase letters,
 * digits or `-`. Presentation owns which names exist and the fallback for unknown ones.
 */
export const chromeName = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9-]*$/)
  .brand<'ChromeName'>();

/**
 * Checks a token name a `.theme` file sets (`set color TOKEN=…`): any non-empty text. Design
 * System checks that the token exists, and its value, when the theme is admitted.
 */
export const tokenName = z.string().min(1).brand<'ThemeTokenName'>();

/**
 * Checks the theme a `.theme` file builds on (`base=…`): a theme ID or an exact theme pin, as
 * written. The host resolves it against the catalog when the theme is admitted.
 */
export const baseTheme = z.string().min(1).brand<'BaseTheme'>();

/** A preset ID that passed {@link presetId}. */
export type PresetId = z.infer<typeof presetId>;

/** A digest that passed {@link digest}. */
export type Digest = z.infer<typeof digest>;

/** A version that passed {@link version}. */
export type Version = z.infer<typeof version>;

/** A chrome name that passed {@link chromeName}. */
export type ChromeName = z.infer<typeof chromeName>;

/** A token name that passed {@link tokenName}. */
export type TokenName = z.infer<typeof tokenName>;

/** A base theme that passed {@link baseTheme}. */
export type BaseTheme = z.infer<typeof baseTheme>;
