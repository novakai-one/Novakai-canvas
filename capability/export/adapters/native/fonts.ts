/*
 * Font decoding for the native PNG and PDF encoders. They need real font files (sfnt:
 * TrueType/OpenType), not the browser `@font-face` aliases the SVG uses, and they must never
 * substitute a system font.
 */
import { create } from 'fontkit';
import type { FontSet } from '@novakai/canvas-presentation';
import type { FontDecoder, NativeFont } from '../../contract/render-types.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Creates the font decoder for Presentation's pinned fonts. Nothing is cached: every `decode`
 * call decodes all fonts again, and a failed call can simply be repeated.
 *
 * `decode` turns each font's base64 into bytes (Node's `Buffer` decoding; Presentation supplies
 * these fonts), decompresses `font/woff2` fonts with `decompress`, and reads the real family
 * name from the bytes with fontkit. All fonts start decoding at once (production WOFF2
 * decompression still runs one call at a time); the result keeps the input order. Each font
 * gets the alias `canvas-<digest>`, the family name the SVG uses. A non-WOFF2 font's `bytes` is
 * the decoded `Buffer` itself.
 *
 * @param fonts - Presentation's pinned fonts.
 * @param decompress - The WOFF2 decompressor (`decompressFont` in production).
 * @returns The decoder. `decode` never throws; it returns `encoding-failed` at `fonts` when
 * there are no fonts, when any font cannot be decoded (including a font collection file, or a
 * `decompress` rejection), or when two fonts report the same family name, which would let the
 * native renderer substitute one for the other.
 * @throws Never.
 */
export function createFontDecoder(
  fonts: FontSet,
  decompress: (bytes: Uint8Array) => Promise<Uint8Array>,
): FontDecoder {
  /** Decodes every pinned font; see {@link createFontDecoder}. */
  async function decode(): Promise<Result<readonly NativeFont[]>> {
    try {
      if (fonts.length === 0)
        return failure('encoding-failed', 'fonts', 'At least one exact pinned font is required');
      const decoded = await Promise.all(fonts.map(decodeFont));
      return distinctFamilies(decoded);
    } catch {
      return failure('encoding-failed', 'fonts', 'Exact pinned font bytes could not be decoded');
    }
  }

  /**
   * Decodes one font. The family name comes from the font bytes, never from a name the caller
   * supplied. Throws for a font collection file (several fonts in one file).
   */
  async function decodeFont(font: FontSet[number]): Promise<NativeFont> {
    const original = Buffer.from(font.base64, 'base64');
    const bytes = await nativeBytes(original, font.mediaType);
    const parsed = create(Buffer.from(bytes));
    if (!('familyName' in parsed))
      throw new Error('Font collections are not an admitted font source');
    return { alias: `canvas-${font.digest}`, family: parsed.familyName, bytes };
  }

  /** Decompresses WOFF2; bytes of any other media type pass through unchanged. */
  async function nativeBytes(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<Uint8Array> {
    if (mediaType === 'font/woff2') return decompress(bytes);
    return bytes;
  }

  return { decode };
}

/**
 * Rejects fonts that share a family name: the native renderers look fonts up by family, so a
 * shared name would let one font silently replace another.
 */
function distinctFamilies(fonts: readonly NativeFont[]): Result<readonly NativeFont[]> {
  const families = new Set(fonts.map(/** The font's family name. */ (font) => font.family));
  if (families.size !== fonts.length)
    return failure(
      'encoding-failed',
      'fonts',
      'Distinct pinned fonts share an ambiguous internal family',
    );
  return success(fonts);
}
