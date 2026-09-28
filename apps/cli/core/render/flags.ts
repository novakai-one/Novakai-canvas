/*
 * Why this file exists
 *
 * When a render:png flag is typed wrong, the agent needs to see what to type instead. So every
 * flag mistake ends with one usage line:
 *
 *   Use render:png --collection ID|FILE.canvas --out DIR [--format svg|png] [--theme ID] …
 *
 * This file writes that line, and says which flags are required and which formats exist. It holds
 * words only; `request.ts` checks what was typed.
 */
import type { RenderFlag } from '../../contract/records/arguments.js';
import type { RenderFormat } from '../../contract/records/render.js';

/** A flag render:png can't run without: `collection` or `out`, named without the `--`. */
export type RequiredFlag = 'collection' | 'out';

/** A flag render:png can run without: `format`, `theme`, `theme-file` or `labels`. */
export type OptionalFlag = Exclude<RenderFlag, RequiredFlag>;

/** The words written after a flag in the usage line; the `--labels` switch has none. */
type Placeholder = readonly string[];

/** Every section file format, keyed by itself, in the order the usage line and failures name them. */
const renderFormats: Readonly<Record<RenderFormat, RenderFormat>> = Object.freeze({
  svg: 'svg',
  png: 'png',
});

/** The image formats render:png can write, `svg` then `png`, in the order mistakes name them. */
export const formatNames: readonly string[] = Object.freeze(Object.keys(renderFormats));

/** Each required flag's placeholder, in usage order. */
const requiredFlags: Readonly<Record<RequiredFlag, Placeholder>> = Object.freeze({
  collection: Object.freeze(['ID|FILE.canvas']),
  out: Object.freeze(['DIR']),
});

/** Each optional flag's placeholder, in usage order, after the required flags. */
const optionalFlags: Readonly<Record<OptionalFlag, Placeholder>> = Object.freeze({
  format: Object.freeze([formatNames.join('|')]),
  theme: Object.freeze(['ID']),
  'theme-file': Object.freeze(['FILE']),
  labels: Object.freeze([]),
});

/** The usage line every flag mistake ends with: required flags, then optional ones in `[ ]`. */
export const renderUsage = `Use render:png ${[
  ...Object.entries(requiredFlags).map(written),
  ...Object.entries(optionalFlags).map(written).map(bracketed),
].join(' ')}.`;

/** Writes a flag's name the way it is typed: `format` becomes `--format`. */
export function flagAsTyped(name: string): string {
  return `--${name}`;
}

/** Whether `text`, as typed after `--format`, is a format render:png can write. */
export function isRenderFormat(text: string): text is RenderFormat {
  return Object.hasOwn(renderFormats, text);
}

/** One flag and its placeholder, as the usage line writes them. */
function written([flag, placeholder]: readonly [string, Placeholder]): string {
  return [flagAsTyped(flag), ...placeholder].join(' ');
}

/** An optional flag in the usage line. */
function bracketed(words: string): string {
  return `[${words}]`;
}
