import { z } from 'zod';
import { digest } from '../brands.js';
import type { Digest } from '../brands.js';

/**
 * Admission limits. The codecs enforce the same size and dimension ceilings on decoded media.
 *
 * - `bytes`: 16 MiB, for submitted and normalized media (decoded size).
 * - `pixels`: 32 million pixels per raster image.
 * - `dimension`: 16384, the largest width or height.
 * - `svgBytes`: 1 MiB of SVG text.
 * - `svgElements`: 4096 SVG elements.
 * - `svgDepth`: 64 levels of SVG nesting.
 * - `glyphs`: 65535 glyphs per font.
 */
export const limits = Object.freeze({
  bytes: 16 * 1024 * 1024,
  pixels: 32_000_000,
  dimension: 16384,
  svgBytes: 1024 * 1024,
  svgElements: 4096,
  svgDepth: 64,
  glyphs: 65535,
});

/** Checks a supported media type: PNG, JPEG, WebP, SVG, or a TTF, OTF, WOFF or WOFF2 font. */
export const mediaType = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
]);

/** A media type that passed {@link mediaType}. */
export type SupportedMedia = z.infer<typeof mediaType>;

/**
 * Checks base64 text: at least 4 characters, at most the encoded length of {@link limits}.bytes,
 * a multiple of 4 long, only the base64 alphabet, and at most two `=` at the very end. A length,
 * alphabet or padding failure has the message "Invalid base64 encoding"; the length bounds have
 * zod's own messages. Canonical form is checked later, when the bytes are hashed.
 */
export const base64 = z
  .string()
  .min(4)
  .max(Math.ceil(limits.bytes / 3) * 4)
  .refine(validBase64, 'Invalid base64 encoding');

/** The longest alt, license or attribution text. */
const MAX_TEXT = 4096;

/**
 * Checks where media came from: a `source` (1–2048 characters) and an optional `license` and
 * `attribution` (up to 4096 characters each). No other fields.
 */
export const provenance = z
  .strictObject({
    source: z.string().min(1).max(2048),
    license: z.string().max(MAX_TEXT).optional(),
    attribution: z.string().max(MAX_TEXT).optional(),
  })
  .readonly();

/**
 * Checks a staging request: `base64` bytes, their declared `mediaType`, `alt` text (up to 4096
 * characters) and `provenance`. No other fields.
 */
export const stageInput = z.strictObject({
  base64,
  mediaType,
  alt: z.string().max(MAX_TEXT),
  provenance,
});

/** A staging request that passed {@link stageInput}. */
export type StageInput = Readonly<z.infer<typeof stageInput>>;

/**
 * Checks a media processor's output: the normalized `base64` bytes and `mediaType`; the `kind`
 * (`image`, `icon` or `font`); `width` and `height` (positive, at most {@link limits}.dimension,
 * or `null`); and `fontFamily` (1–1024 characters, or `null`). No other fields.
 */
export const normalizedMedia = z
  .strictObject({
    base64,
    mediaType,
    kind: z.enum(['image', 'icon', 'font']),
    width: z.number().positive().max(limits.dimension).nullable(),
    height: z.number().positive().max(limits.dimension).nullable(),
    fontFamily: z.string().min(1).max(1024).nullable(),
  })
  .readonly();

/** A processor output that passed {@link normalizedMedia}. */
export type NormalizedMedia = z.infer<typeof normalizedMedia>;

/**
 * Checks a stored blob's descriptor: the {@link normalizedMedia} fields except the bytes, plus the
 * bytes' `digest` and decoded `byteLength` (a positive integer up to {@link limits}.bytes).
 */
export const descriptor = normalizedMedia
  .unwrap()
  .omit({ base64: true })
  .extend({ digest, byteLength: z.number().int().positive().max(limits.bytes) })
  .readonly();

/** A descriptor that passed {@link descriptor}. */
export type BlobDescriptor = z.infer<typeof descriptor>;

/** Checks a stored blob: its {@link descriptor} and its `base64` bytes. No other fields. */
export const storedBlob = z.strictObject({ descriptor, base64 }).readonly();

/** A stored blob that passed {@link storedBlob}. */
export type StoredBlob = z.infer<typeof storedBlob>;

/**
 * The result of staging one media file, returned to the caller (the service and the CLI). Only
 * the descriptor is stored; the other fields belong to this submission.
 */
export interface Admission {
  /** The stored blob's descriptor. */
  readonly descriptor: BlobDescriptor;
  /** The digest of the submitted bytes, before normalization. */
  readonly originalDigest: Digest;
  /** The submitted alt text. */
  readonly alt: string;
  /** The submitted provenance. */
  readonly provenance: z.infer<typeof provenance>;
}

/**
 * Checks the base64 length, alphabet and padding. It scans the alphabet with a simple character
 * class, not a repeated-group regex, so long input cannot exhaust the regex stack.
 */
function validBase64(value: string): boolean {
  if (value.length % 4 !== 0) {
    return false;
  }
  if (/[^A-Za-z0-9+/=]/.test(value)) {
    return false;
  }
  return validPadding(value);
}

/** Padding is optional; when present it is `=` or `==` at the very end. */
function validPadding(value: string): boolean {
  const start = value.indexOf('=');
  if (start === -1) {
    return true;
  }
  const suffix = value.slice(start);
  return suffix === '=' || suffix === '==';
}
