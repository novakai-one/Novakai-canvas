/*
 * Why this file exists
 *
 * Export draws an SVG or PNG only from what it is handed: the collection, its theme, and the bytes
 * of every image and font it shows. For example, a diagram with a logo needs the logo's bytes and
 * the font its text uses, exactly as stored.
 *
 * This file gathers those from the held files: the theme first, then the images, then the fonts.
 * A missing theme or a file that can't be read refuses the export (`resource-rejected`). When
 * Export later asks to check them again, this file passes them through unchanged. It only reads.
 */
import type {
  AssetResult,
  Catalog,
  Collection,
  ExportResult,
  Preset,
  Resource,
  Resources,
  StoredBlob,
  ThemePreset,
} from '../../contract/records/capability-types.js';
import type { LeaseRead } from '../../contract/ports/export.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { removeDigestPrefix } from '../../contract/brands.js';
import { collect, success } from '../../contract/errors.js';
import { exportFailure } from './faults.js';

/**
 * Gathers the collection's theme, images and fonts, in that order, for Export. The theme comes
 * from `presets`, the fonts are the ones the drawn `document` uses, and files are read with
 * `readHeldFile`.
 * Mistakes: `resource-rejected` at `resources.theme` when the pinned theme isn't in `presets`, or
 * at the file's path when an image or font can't be read.
 */
export function gatherExportResources(
  readHeldFile: LeaseRead,
  collection: Collection,
  document: RenderDocument,
  presets: Catalog,
): ExportResult<readonly Resource[]> {
  const theme = findPinnedTheme(collection, presets);
  if (theme === undefined) {
    return missingThemeFailure();
  }
  return gatherHeldFiles(readHeldFile, collection, document, theme);
}

/**
 * Builds the resource check Export asks for (its `Resources`), which lets every resource through
 * unchanged: `gatherExportResources` already checked them. Never fails.
 */
export function createPassThroughResources(): Resources {
  return {
    inspect: async (resources) => success(resources),
  };
}

/** One image a collection shows: its name, its digest (with `sha256:`) and its alt text. */
type ImageBinding = Collection['assets'][number];

/** One font the drawing uses: its family and the digest of its bytes. */
type DrawnFont = RenderDocument['fonts'][number];

/** Finds the saved theme the collection pins, by its ID and version. */
function findPinnedTheme(
  collection: Collection,
  presets: Catalog,
): ThemePreset | undefined {
  const pin = collection.theme;
  return presets.find((preset) => isPinnedTheme(preset, pin));
}

/** Whether the preset is the theme `pin` names: a theme with the same ID and version. */
function isPinnedTheme(
  preset: Preset,
  pin: Collection['theme'],
): preset is ThemePreset {
  return preset.kind === 'theme' && preset.id === pin.id && preset.version === pin.version;
}

/** Reads each image, then each font, and lists them after the theme. */
function gatherHeldFiles(
  readHeldFile: LeaseRead,
  collection: Collection,
  document: RenderDocument,
  theme: ThemePreset,
): ExportResult<readonly Resource[]> {
  const images = collect(collection.assets, (image) => readImage(readHeldFile, image));
  if (!images.ok) {
    return images;
  }
  const fonts = collect(document.fonts, (font) => readFont(readHeldFile, font));
  if (!fonts.ok) {
    return fonts;
  }
  const themeFile = themeResource(theme);
  const resources = [themeFile, ...images.value, ...fonts.value];
  return success(resources);
}

/** Turns the theme into a resource: its JSON text as bytes. */
function themeResource(theme: ThemePreset): Resource {
  const bytes = Buffer.from(JSON.stringify(theme));
  return {
    kind: 'preset',
    digest: theme.digest,
    mediaType: 'application/json',
    bytes,
    metadata: {},
  };
}

/** Reads one image by its bare digest; a failed read is reported at `resources.<image name>`. */
function readImage(
  readHeldFile: LeaseRead,
  image: ImageBinding,
): ExportResult<Resource> {
  const digest = removeDigestPrefix(image.digest);
  const blob = readHeldFile(digest, `resources.${image.id}`);
  return heldFileResource(blob, 'asset', { alt: image.alt });
}

/** Reads one font by its digest; a failed read is reported at `resources.<digest>`. */
function readFont(
  readHeldFile: LeaseRead,
  font: DrawnFont,
): ExportResult<Resource> {
  const blob = readHeldFile(font.digest, `resources.${font.digest}`);
  return heldFileResource(blob, 'font', { family: font.family });
}

/** Turns one held file's read into an Export resource, refusing a file that couldn't be read. */
function heldFileResource(
  blob: AssetResult<StoredBlob>,
  kind: Resource['kind'],
  metadata: Readonly<Record<string, string>>,
): ExportResult<Resource> {
  if (!blob.ok) {
    return unreadableFileFailure(blob.error.path, blob.error.message);
  }
  const { descriptor, base64 } = blob.value;
  const bytes = Buffer.from(base64, 'base64');
  const resource: Resource = {
    kind,
    digest: descriptor.digest,
    mediaType: descriptor.mediaType,
    bytes,
    metadata,
  };
  return success(resource);
}

/** Makes the mistake for a pinned theme that isn't saved: `resource-rejected`. */
function missingThemeFailure(): ExportResult<never> {
  return exportFailure('resource-rejected', 'resources.theme', 'The pinned theme is unavailable');
}

/** Makes the mistake for a held file that couldn't be read: `resource-rejected` at its path. */
function unreadableFileFailure(
  path: string,
  message: string,
): ExportResult<never> {
  return exportFailure('resource-rejected', path, message);
}
