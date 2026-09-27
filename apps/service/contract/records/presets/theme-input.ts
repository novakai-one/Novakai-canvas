/*
 * Theme input shapes: the source-syntax theme config that theme admission translates, and the
 * selection envelope the theme codec resolves. Declarations only; Design System owns token and
 * delta validation, Templates owns preset identity, Authoring owns commit and retry.
 */
import { z } from 'zod';
import { chromeName } from '@novakai/canvas-design-system';
/** Host selection envelope maps a preset base to authoritative payload; Design System still owns token/delta validation. */
const pin = z.strictObject({
  kind: z.literal('theme'),
  id: z.string(),
  version: z.string(),
  digest: z.string(),
});
export const themeInput = z.strictObject({
  chrome: chromeName.optional(),
  base: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ui'), pin: z.unknown() }),
    z.strictObject({ kind: z.literal('preset'), pin, payload: z.unknown().optional() }),
  ]),
  fonts: z.unknown(),
  overrides: z.unknown(),
});
export type ThemeInput = z.infer<typeof themeInput>;

/**
 * A theme admission still in source syntax: a base selection (bare preset ID or exact
 * `id@version#sha256:hex` pin) and token overrides. Other admission keys pass through untouched.
 */
export const themeConfig = z.looseObject({
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
export type ThemeConfig = z.infer<typeof themeConfig>;
/** One source-syntax token override: a hex colour, a number, or a pixel dimension. */
export type ThemeOverride = ThemeConfig['raw']['overrides'][string];

/** A theme config's `raw` block read as named fields, so one field can be projected. */
export const rawFields = z.record(z.string(), z.unknown());

/** Source-syntax colour: `#rrggbb` or `#rrggbbaa`, either case. */
export const hexColour = z.string().regex(/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/);
