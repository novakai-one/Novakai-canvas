/*
 * Why this file exists
 *
 * The render worker can't read stored files, so a render job carries the bytes of every font and
 * image it draws with. For example, if `my-diagram`'s theme uses two fonts and the diagram shows
 * one logo, its job carries those three files.
 *
 * This file reads those files through Assets and checks each is in the form Presentation expects.
 * Its mistakes are made in job-refusal.ts. It only reads.
 */
import type {
  Assets,
  AuthoringResult,
  Collection,
  FontSource,
  ThemePreset,
  VisualAsset,
} from '../../contract/records/capability-types.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import { fontSource, fontSet, visualAsset } from '../../contract/schemas.js';
import { collect, success } from '../../contract/errors.js';
import { removeDigestPrefix } from '../../contract/brands.js';
import { malformedResourceFailure, requireResource } from './job-refusal.js';

/** One file a collection uses, as Model records it. */
type CollectionFile = Collection['assets'][number];

/**
 * Reads every font the theme uses, as one font set.
 * Mistakes: `missing-asset` when Assets can't find a font, and `invalid-input` when the fonts
 * aren't in the form Presentation expects.
 */
export function readThemeFonts(
  theme: ThemePreset,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<RenderingJob['fonts']> {
  const fonts = collect(theme.payload.fonts, (digest) => readFont(digest, assets));
  if (!fonts.ok) {
    return fonts;
  }
  const checked = fontSet.safeParse(fonts.value);
  if (!checked.success) {
    return malformedResourceFailure();
  }
  return success(checked.data);
}

/**
 * Reads every image the collection shows; its other files are left out.
 * Mistakes: `missing-asset` when Assets can't find an image, and `invalid-input` when one isn't
 * in the form Presentation expects.
 */
export function readCollectionImages(
  collection: Collection,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<readonly VisualAsset[]> {
  const images = collection.assets.filter(isImage);
  const digests = images.map((image) => removeDigestPrefix(image.digest));
  return collect(digests, (digest) => readImage(digest, assets));
}

/**
 * Reads one font's stored bytes and the family Assets recorded for it, which measuring, the
 * browser and export all use. `digest` is the font's content hash as the theme lists it; Assets
 * checks it.
 */
function readFont(
  digest: string,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<FontSource> {
  const stored = requireResource(assets.resolve(digest));
  if (!stored.ok) {
    return stored;
  }
  const font = fontSource.safeParse({
    digest,
    family: stored.value.descriptor.fontFamily,
    mediaType: stored.value.descriptor.mediaType,
    base64: stored.value.base64,
  });
  if (!font.success) {
    return malformedResourceFailure();
  }
  return success(font.data);
}

/** Whether the file's media type starts with `image/`. */
function isImage(file: CollectionFile): boolean {
  return file.mediaType.startsWith('image/');
}

/**
 * Reads one image's stored bytes; its width and height come from Assets, never from sizes typed
 * in the diagram. `digest` is the image's content hash with `sha256:` removed; Assets checks it.
 */
function readImage(
  digest: string,
  assets: Pick<Assets, 'resolve'>,
): AuthoringResult<VisualAsset> {
  const stored = requireResource(assets.resolve(digest));
  if (!stored.ok) {
    return stored;
  }
  const image = visualAsset.safeParse({
    digest,
    mediaType: stored.value.descriptor.mediaType,
    base64: stored.value.base64,
    width: stored.value.descriptor.width,
    height: stored.value.descriptor.height,
  });
  if (!image.success) {
    return malformedResourceFailure();
  }
  return success(image.data);
}
