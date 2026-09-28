/*
 * render:png's flags in words: which flags a render cannot run without, the placeholder each value
 * is written as, the section formats, and the usage line built from them. Pure; built once. The
 * usage line follows every argument failure, so the caller sees what to type instead.
 */
import type { RenderFlag } from '../../contract/records/arguments.js';
import type { RenderFormat } from '../../contract/records/render.js';

/** A flag render:png cannot run without. */
export type RequiredFlag = 'collection' | 'out';

/** A flag render:png runs without. */
export type OptionalFlag = Exclude<RenderFlag, RequiredFlag>;

/** The words written after a flag in the usage line; the `--labels` switch has none. */
type Placeholder = readonly string[];

/** Every section file format, keyed by itself, in the order the usage line and failures name them. */
const renderFormats: Readonly<Record<RenderFormat, RenderFormat>> = Object.freeze({
  svg: 'svg',
  png: 'png',
});

/** The section formats, in order. */
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

/** What to type instead, after any argument failure: required flags, then optional ones in `[ ]`. */
export const renderUsage = `Use render:png ${[
  ...Object.entries(requiredFlags).map(written),
  ...Object.entries(optionalFlags).map(written).map(bracketed),
].join(' ')}.`;

/** A flag as typed: `--` then its name. */
export function flagName(flag: string): string {
  return `--${flag}`;
}

/** Whether `text` names a section format. */
export function isRenderFormat(text: string): text is RenderFormat {
  return Object.hasOwn(renderFormats, text);
}

/** One flag and its placeholder, as the usage line writes them. */
function written([flag, placeholder]: readonly [string, Placeholder]): string {
  return [flagName(flag), ...placeholder].join(' ');
}

/** An optional flag in the usage line. */
function bracketed(words: string): string {
  return `[${words}]`;
}
