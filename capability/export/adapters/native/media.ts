/*
 * Image preparation for PDF export. PDFKit embeds only PNG and JPEG, so other image resources
 * (for example WebP and SVG assets) are transcoded to PNG with `sharp`.
 */
import sharp from 'sharp';
import type { MediaConverter } from '../../contract/render-types.js';
import type { Resource } from '../../contract/records/resource.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Creates the native media converter used by the PDF encoder.
 *
 * `convert` takes every resource whose media type starts with `image/` and maps its original
 * data URL (`data:<type>;base64,<bytes>`) to the data URL to embed. PNG and JPEG map to
 * themselves; any other image type is converted to PNG, with inputs over 64 million pixels
 * refused. All images are converted at the same time. Resource bytes and digests are never
 * changed; the conversion exists only inside this export. When two resources have the same
 * data URL, the later one's entry is kept.
 *
 * The PDF encoder only looks images up in this map: an image link that is not a key fails the
 * PDF, with no file or network fallback.
 *
 * @returns The converter. `convert` never throws: any failure, including one from `sharp`,
 * becomes `encoding-failed` at `images`. It keeps no state, so it is safe to call again.
 * @throws Never.
 */
export function createMediaConverter(): MediaConverter {
  /** Converts every image resource; see {@link createMediaConverter}. */
  async function convert(
    resources: readonly Resource[],
  ): Promise<Result<ReadonlyMap<string, string>>> {
    try {
      const images = resources.filter(
        /** Whether the resource is an image (`image/…` media type). */ (item) =>
          item.mediaType.startsWith('image/'),
      );
      const entries = await Promise.all(images.map(convertImage));
      return success(new Map(entries));
    } catch {
      return failure('encoding-failed', 'images', 'An admitted image could not be encoded for PDF');
    }
  }
  return { convert };
}

/**
 * One map entry: the image's original data URL, and the same URL for PNG and JPEG or a PNG
 * data URL for any other image type. Rejects when `sharp` cannot decode or convert the image.
 */
async function convertImage(resource: Resource): Promise<readonly [string, string]> {
  const original = dataUrl(resource);
  const embeddable = ['image/png', 'image/jpeg'].includes(resource.mediaType);
  if (embeddable) return [original, original];
  const image = sharp(Buffer.from(resource.bytes), { limitInputPixels: 64000000 });
  const png = await image.png().toBuffer();
  const pngBase64 = png.toString('base64');
  return [original, `data:image/png;base64,${pngBase64}`];
}

/**
 * The data URL `data:<mediaType>;base64,<bytes>`, used as the map key the PDF encoder looks up.
 * The media type is read and turned into text before the bytes are read.
 */
function dataUrl(resource: Resource): string {
  const prefix = `data:${resource.mediaType};base64,`;
  const bytes = Buffer.from(resource.bytes);
  const base64 = bytes.toString('base64');
  return prefix + base64;
}
