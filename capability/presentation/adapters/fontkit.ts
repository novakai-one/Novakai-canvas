import { create } from 'fontkit';
import type { Font } from 'fontkit';
import { createHash } from 'node:crypto';
import type { FontSet, FontSource, FontRef } from '../contract/records/style.js';
import { contextualAlternates } from '../contract/records/style.js';
import type { MeasurementPort, TextMetrics } from '../contract/ports/measurement.js';
import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
/** Native parsing is injectable; callers supply exact admitted bytes without filesystem or OS lookup. */
export type FontParser = (bytes: Uint8Array) => Font;
interface LoadedFont {
  readonly source: FontSource;
  readonly font: Font;
  readonly metrics: Map<string, Result<TextMetrics>>;
}
/** Bounded native provider cache contains font objects and text metrics, never scene geometry. */
const nativeFonts = new Map<string, LoadedFont>();
/** Font collections are not silently resolved to their first member. */
function parseNative(bytes: Uint8Array): Font {
  const parsed = create(Buffer.from(bytes));
  if (!('layout' in parsed)) throw new Error('Expected one font');
  return parsed;
}
/** Supplied content digest and glyph data must agree before metrics are exposed. */
function load(
  source: FontSource,
  parser: FontParser,
): LoadedFont {
  const bytes = Buffer.from(source.base64, 'base64');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== source.digest) throw new Error('Font digest mismatch');
  if (parser !== parseNative) return { source, font: parser(bytes), metrics: new Map() };
  const prior = nativeFonts.get(source.digest);
  if (prior !== undefined) return prior;
  const loaded = { source, font: parser(bytes), metrics: new Map<string, Result<TextMetrics>>() };
  if (nativeFonts.size >= 8) nativeFonts.delete(nativeFonts.keys().next().value!);
  nativeFonts.set(source.digest, loaded);
  return loaded;
}
/** Unsupported codepoints are explicit failures; invisible substitution would invalidate measured layout. */
function missingGlyph(
  text: string,
  font: Font,
): string | undefined {
  return Array.from(text).find(
    (character) => !font.hasGlyphForCodePoint(character.codePointAt(0) ?? 0),
  );
}
/** Shape with the pinned font and convert native design units into the requested local text size. */
function shape(
  text: string,
  loaded: LoadedFont,
  size: number,
): Result<TextMetrics> {
  const missing = missingGlyph(text, loaded.font);
  if (missing !== undefined)
    return fail(
      'missing-glyph',
      loaded.source.digest,
      `Pinned font ${loaded.source.family} does not contain ${JSON.stringify(missing)} (${codepoint(missing)})`,
    );
  const run = loaded.font.layout(text, { calt: contextualAlternates });
  const scale = size / loaded.font.unitsPerEm;
  return {
    ok: true,
    value: {
      width: run.positions.reduce((sum, position) => sum + position.xAdvance, 0) * scale,
      ascent: loaded.font.ascent * scale,
      descent: Math.abs(loaded.font.descent) * scale,
    },
  };
}
/** Unicode identity makes a missing symbol actionable without dumping the entire authored paragraph. */
function codepoint(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}
/** Exact identity lookup prevents family-name fallback to an unrelated machine font. */
function measure(
  text: string,
  font: FontRef,
  size: number,
  fonts: readonly LoadedFont[],
): Result<TextMetrics> {
  const found = fonts.find((item) => item.source.digest === font.digest);
  if (!found) return fail('missing-resource', font.digest, 'Pinned font is unavailable');
  const key = `${size}:${text}`;
  const prior = found.metrics.get(key);
  if (prior !== undefined) return prior;
  const result = protectShape(text, found, size);
  if (found.metrics.size >= 8192) found.metrics.delete(found.metrics.keys().next().value!);
  found.metrics.set(key, result);
  return result;
}
/** Native shaping failure remains typed; caller restores the resource or corrects unsupported text. */
function protectShape(
  text: string,
  font: LoadedFont,
  size: number,
): Result<TextMetrics> {
  try {
    return shape(text, font, size);
  } catch {
    return fail('provider-failed', font.source.digest, 'Font shaping failed');
  }
}
/** Parse one immutable font set once. Host must give the same set to React rendering. */
export function createFontMetrics(
  fonts: FontSet,
  parser: FontParser = parseNative,
): Result<MeasurementPort> {
  try {
    const loaded = fonts.map((source) => load(source, parser));
    return {
      ok: true,
      value: {
        version: 'fontkit-2.0.4/presentation-8',
        measure: (text, font, size) => measure(text, font, size, loaded),
      },
    };
  } catch {
    return fail('missing-resource', 'fonts', 'Pinned font bytes cannot be loaded');
  }
}
