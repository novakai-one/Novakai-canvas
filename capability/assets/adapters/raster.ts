import sharp from 'sharp';
import type { Sharp, Metadata } from 'sharp';
import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import { limits } from '../contract/records/media.js';
import type { NormalizedMedia, SupportedMedia } from '../contract/records/media.js';
import type { MediaHandler } from '../contract/ports/media.js';

/** Creates the image pipeline for some bytes, injectable so tests can simulate codec failures. */
type RasterFactory = (bytes: Uint8Array) => Pick<Sharp, 'metadata' | 'rotate' | 'png' | 'toBuffer'>;

/**
 * Creates the raster processor for PNG, JPEG and WebP. It fully decodes and re-encodes each image
 * as PNG, which drops metadata and applies the stored orientation.
 *
 * Normalizing, in order:
 * 1. read the header: the format must match the declared type (`unsupported-media` at
 *    `mediaType`), and the image must have one page (`unsafe-media` at `pages`, so no animation);
 * 2. width and height at most {@link limits}.dimension, and at most {@link limits}.pixels pixels
 *    (`unsafe-media` at `dimensions`);
 * 3. rotate to the stored orientation and encode as PNG (compression level 9, no adaptive
 *    filtering).
 *
 * A throw from the codec (for example a decode error or its pixel limit) becomes `unsafe-media`
 * at `base64`: "Raster decoding failed within admission limits". Recovery: the caller corrects
 * the bytes before retrying; Assets owns cleanup of orphan files.
 *
 * @param create - Creates the pipeline. Defaults to `sharp` with a {@link limits}.pixels input
 * limit that fails on warnings.
 * @returns The processor. Its `normalize` returns `image/png` media of kind `image` with the
 * encoded width and height, and never rejects.
 * @throws Never.
 */
export function createRaster(
  create: RasterFactory = (bytes) =>
    sharp(bytes, { limitInputPixels: limits.pixels, failOn: 'warning' }),
): MediaHandler {
  return {
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
    normalize: (encoded, declared) => protectRaster(encoded, declared, create),
  };
}

/** The codec's format name for each raster media type. */
const rasterFormats: Readonly<Partial<Record<SupportedMedia, string>>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

/** Normalizes the image; anything thrown becomes `unsafe-media`. */
async function protectRaster(
  encoded: string,
  declared: SupportedMedia,
  create: RasterFactory,
): Promise<Result<NormalizedMedia>> {
  try {
    return await normalizeRaster(encoded, declared, create);
  } catch {
    return fail('unsafe-media', 'base64', 'Raster decoding failed within admission limits');
  }
}

/** Checks the header, then fully decodes, rotates and re-encodes the image as PNG. */
async function normalizeRaster(
  encoded: string,
  declared: SupportedMedia,
  create: RasterFactory,
): Promise<Result<NormalizedMedia>> {
  const pipeline = create(Buffer.from(encoded, 'base64'));
  const metadata = await pipeline.metadata();
  const checked = inspectMetadata(metadata, declared);
  if (!checked.ok) {
    return checked;
  }
  const rotated = pipeline.rotate();
  const output = rotated.png({ compressionLevel: 9, adaptiveFiltering: false });
  const decoded = await output.toBuffer({ resolveWithObject: true });
  return {
    ok: true,
    value: {
      base64: decoded.data.toString('base64'),
      mediaType: 'image/png',
      kind: 'image',
      width: decoded.info.width,
      height: decoded.info.height,
      fontFamily: null,
    },
  };
}

/** Rejects a format that differs from the declared type, and animated or multipage images. */
function inspectMetadata(
  metadata: Metadata,
  declared: SupportedMedia,
): Result<void> {
  if (metadata.format !== rasterFormats[declared]) {
    return fail('unsupported-media', 'mediaType', 'Declared raster format differs from bytes');
  }
  if ((metadata.pages ?? 1) !== 1) {
    return fail('unsafe-media', 'pages', 'Animated or multipage images are not admitted');
  }
  return checkDimensions(metadata.width, metadata.height);
}

/** Rejects a side over the dimension limit, then a pixel count over the pixel limit. */
function checkDimensions(
  width: number,
  height: number,
): Result<void> {
  if (Math.max(width, height) > limits.dimension) {
    return fail('unsafe-media', 'dimensions', 'Raster dimension exceeds limit');
  }
  if (width * height > limits.pixels) {
    return fail('unsafe-media', 'dimensions', 'Raster pixel count exceeds limit');
  }
  return { ok: true, value: undefined };
}
