import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import type { SupportedMedia } from '../contract/records/media.js';

/** A media type and the test for its leading byte signature. */
interface Signature {
  readonly mediaType: SupportedMedia;
  readonly matches: (bytes: Buffer) => boolean;
}

/**
 * Detects a media type from the bytes' leading signature. Restoring a backup uses this because a
 * backup's claimed type is not trusted. A match only chooses the processor; the processor still
 * checks the whole file.
 *
 * Signatures are tried in this order: PNG, JPEG, WebP, TTF, OTF, WOFF, WOFF2, then SVG (the first
 * 256 bytes, read as UTF-8, start with `<` after leading whitespace).
 *
 * @param encoded - The bytes, base64 encoded.
 * @returns The first matching type. Fails `unsupported-media` at `mediaType` when nothing
 * matches, or `invalid-input` at `base64` when decoding throws.
 * @throws Never.
 */
export function detectMedia(encoded: string): Result<SupportedMedia> {
  try {
    const bytes = Buffer.from(encoded, 'base64');
    const signature = signatures.find((signature) => signature.matches(bytes));
    if (!signature) {
      return fail('unsupported-media', 'mediaType', 'No supported media signature found');
    }
    return { ok: true, value: signature.mediaType };
  } catch {
    return fail('invalid-input', 'base64', 'Media bytes could not be decoded');
  }
}

/** The byte signatures, in the order they are tried. SVG is last because its test is the loosest. */
const signatures: readonly Signature[] = [
  { mediaType: 'image/png', matches: (bytes) => hexAt(bytes, 0, 8) === '89504e470d0a1a0a' },
  { mediaType: 'image/jpeg', matches: (bytes) => hexAt(bytes, 0, 3) === 'ffd8ff' },
  {
    mediaType: 'image/webp',
    matches: (bytes) => textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 12) === 'WEBP',
  },
  { mediaType: 'font/ttf', matches: (bytes) => hexAt(bytes, 0, 4) === '00010000' },
  { mediaType: 'font/otf', matches: (bytes) => textAt(bytes, 0, 4) === 'OTTO' },
  { mediaType: 'font/woff', matches: (bytes) => textAt(bytes, 0, 4) === 'wOFF' },
  { mediaType: 'font/woff2', matches: (bytes) => textAt(bytes, 0, 4) === 'wOF2' },
  {
    mediaType: 'image/svg+xml',
    matches: (bytes) => bytes.toString('utf8', 0, 256).trimStart().startsWith('<'),
  },
];

/** The bytes from `start` up to `end`, as lowercase hex. */
function hexAt(
  bytes: Buffer,
  start: number,
  end: number,
): string {
  return bytes.subarray(start, end).toString('hex');
}

/** The bytes from `start` up to `end`, decoded as UTF-8. */
function textAt(
  bytes: Buffer,
  start: number,
  end: number,
): string {
  return bytes.subarray(start, end).toString();
}
