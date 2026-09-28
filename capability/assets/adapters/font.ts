import { create } from 'fontkit';
import type { Font, FontCollection } from 'fontkit';
import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import { limits } from '../contract/records/media.js';
import type { NormalizedMedia, SupportedMedia } from '../contract/records/media.js';
import type { MediaHandler } from '../contract/ports/media.js';

/** Parses font bytes, injectable so tests can simulate parser failures. */
type FontFactory = (bytes: Buffer) => Font | FontCollection;

/**
 * Creates the font processor for TTF, OTF, WOFF and WOFF2. It keeps the original bytes unchanged
 * (no lossy conversion) and records the family name.
 *
 * Normalizing, in order:
 * 1. the first 4 bytes must be the declared type's signature (`unsupported-media` at
 *    `mediaType`);
 * 2. for WOFF and WOFF2, the expanded size in the header must be at most {@link limits}.bytes
 *    (`unsafe-media` at `font`), checked before any decompression;
 * 3. parse the font: a collection is `unsupported-media` at `font`; a glyph count below 1 or above
 *    {@link limits}.glyphs is `unsafe-media` at `glyphs` (a count that is not a number, such as
 *    `NaN`, passes this check); `unitsPerEm` must be positive and finite (`unsafe-media` at
 *    `unitsPerEm`); a family name is required (`unsafe-media` at `fontFamily`). Reading these
 *    forces lazily parsed tables, so corrupt tables fail here.
 *
 * A throw from parsing becomes `unsafe-media` at `font`: "Font tables could not be parsed safely".
 *
 * @param parseFont - Parses the bytes. Defaults to fontkit's `create`.
 * @returns The processor. On success its `normalize` returns the original bytes as media of kind
 * `font` with no width or height. It never rejects.
 * @throws Never.
 */
export function createFont(parseFont: FontFactory = create): MediaHandler {
  return {
    mediaTypes: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2'],
    /** Normalizes one font; see the steps above. */
    normalize: (encoded, declared) => protectFont(encoded, declared, parseFont),
  };
}

/** The first 4 bytes, as hex, of each font type. */
const signatures: Readonly<Partial<Record<SupportedMedia, string>>> = {
  'font/ttf': '00010000',
  'font/otf': '4f54544f',
  'font/woff': '774f4646',
  'font/woff2': '774f4632',
};

/** Normalizes the font; anything thrown becomes `unsafe-media` at `font`. */
async function protectFont(
  encoded: string,
  declared: SupportedMedia,
  parseFont: FontFactory,
): Promise<Result<NormalizedMedia>> {
  try {
    return normalizeFont(encoded, declared, parseFont);
  } catch {
    return fail('unsafe-media', 'font', 'Font tables could not be parsed safely');
  }
}

/** Checks the signature and the expanded size, then parses the font. */
function normalizeFont(
  encoded: string,
  declared: SupportedMedia,
  parseFont: FontFactory,
): Result<NormalizedMedia> {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.subarray(0, 4).toString('hex') !== signatures[declared]) {
    return fail('unsupported-media', 'mediaType', 'Font signature differs from declared format');
  }
  const expanded = checkExpandedSize(bytes, declared);
  if (!expanded.ok) {
    return expanded;
  }
  return parseSingleFont(encoded, declared, bytes, parseFont);
}

/** For WOFF and WOFF2, rejects a header that declares an expanded size over the byte limit. */
function checkExpandedSize(
  bytes: Buffer,
  declared: SupportedMedia,
): Result<void> {
  if (!['font/woff', 'font/woff2'].includes(declared)) {
    return { ok: true, value: undefined };
  }
  if (bytes.readUInt32BE(16) > limits.bytes) {
    return fail('unsafe-media', 'font', 'Expanded font exceeds byte limit');
  }
  return { ok: true, value: undefined };
}

/** Parses and checks one font, then builds the media from the original bytes and family name. */
function parseSingleFont(
  encoded: string,
  declared: SupportedMedia,
  bytes: Buffer,
  parseFont: FontFactory,
): Result<NormalizedMedia> {
  const checked = inspectFont(parseFont(bytes));
  if (!checked.ok) {
    return checked;
  }
  return {
    ok: true,
    value: {
      base64: encoded,
      mediaType: declared,
      kind: 'font',
      width: null,
      height: null,
      fontFamily: checked.value.familyName,
    },
  };
}

/** Rejects a font collection and a glyph count outside the limits, then checks the metrics. */
function inspectFont(font: Font | FontCollection): Result<Font> {
  if (!('numGlyphs' in font)) {
    return fail('unsupported-media', 'font', 'Font collections require selecting one font first');
  }
  if (font.numGlyphs < 1 || font.numGlyphs > limits.glyphs) {
    return fail('unsafe-media', 'glyphs', 'Font glyph count exceeds limits');
  }
  return checkFontMetrics(font);
}

/** Requires a positive finite `unitsPerEm` and a family name. */
function checkFontMetrics(font: Font): Result<Font> {
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
    return fail('unsafe-media', 'unitsPerEm', 'Font metric scale is invalid');
  }
  if (!font.familyName) {
    return fail('unsafe-media', 'fontFamily', 'Font has no family name');
  }
  return { ok: true, value: font };
}
