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
  Resource,
  Resources,
  StoredBlob,
  ThemePreset,
} from '../../contract/records/capability-types.js';
import type { ExportFailure } from '../../contract/records/export/snapshot.js';
import type { LeaseRead } from '../../contract/ports/export.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { removeDigestPrefix } from '../../contract/brands.js';
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
  const theme = themeResource(collection, presets);
  if (theme === undefined)
    return exportFailure('resource-rejected', 'resources.theme', 'The pinned theme is unavailable');
  const assets = assetResources(readHeldFile, collection);
  const fonts = fontResources(readHeldFile, document);
  return combineResources(theme, assets, fonts);
}

/**
 * Builds the resource check Export asks for (its `Resources`), which lets every resource through
 * unchanged: `gatherExportResources` already checked them. Never fails.
 */
export function createPassThroughResources(): Resources {
  return {
    inspect: async (items) => ({ ok: true, value: items }),
  };
}

/** The catalog preset matching the collection's pinned theme id and version. */
function themeResource(
  collection: Collection,
  presets: Catalog,
): ThemePreset | undefined {
  return presets.find(
    (item): item is ThemePreset =>
      item.kind === 'theme' &&
      item.id === collection.theme.id &&
      item.version === collection.theme.version,
  );
}

/** The theme preset's JSON bytes lead the list; an asset failure outranks a font failure. */
function combineResources(
  theme: ThemePreset,
  assets: ExportResult<readonly Resource[]>,
  fonts: ExportResult<readonly Resource[]>,
): ExportResult<readonly Resource[]> {
  if (!assets.ok) return assets;
  if (!fonts.ok) return fonts;
  return {
    ok: true,
    value: [
      {
        kind: 'preset',
        digest: theme.digest,
        mediaType: 'application/json',
        bytes: Buffer.from(JSON.stringify(theme)),
        metadata: {},
      },
      ...assets.value,
      ...fonts.value,
    ],
  };
}

/** Every collection asset, read by its bare digest and reported at its asset id. */
function assetResources(
  read: LeaseRead,
  collection: Collection,
): ExportResult<readonly Resource[]> {
  return resourceList(
    collection.assets.map((item) =>
      resourceFromBlob(read(removeDigestPrefix(item.digest), `resources.${item.id}`), 'asset', {
        alt: item.alt,
      }),
    ),
  );
}

/** Every document font, read and reported by its digest. */
function fontResources(
  read: LeaseRead,
  document: RenderDocument,
): ExportResult<readonly Resource[]> {
  return resourceList(
    document.fonts.map((font) =>
      resourceFromBlob(read(font.digest, `resources.${font.digest}`), 'font', {
        family: font.family,
      }),
    ),
  );
}

/** A leased blob as an Export resource; a failed read is a rejected resource at its path. */
function resourceFromBlob(
  blob: AssetResult<StoredBlob>,
  kind: Resource['kind'],
  metadata: Record<string, string>,
): ExportResult<Resource> {
  return blob.ok
    ? {
        ok: true,
        value: {
          kind,
          digest: blob.value.descriptor.digest,
          mediaType: blob.value.descriptor.mediaType,
          bytes: Buffer.from(blob.value.base64, 'base64'),
          metadata,
        },
      }
    : exportFailure('resource-rejected', blob.error.path, blob.error.message);
}

/** The first failed read, or every resource in order. */
function resourceList(
  results: readonly ExportResult<Resource>[],
): ExportResult<readonly Resource[]> {
  const failed = results.find(isFailure);
  if (failed !== undefined) return failed;
  return { ok: true, value: results.filter(isRetained).map((result) => result.value) };
}

/** A read that failed. */
function isFailure(result: ExportResult<Resource>): result is ExportFailure {
  return !result.ok;
}

/** A read that retained its resource. */
function isRetained(
  result: ExportResult<Resource>,
): result is { readonly ok: true; readonly value: Resource } {
  return result.ok;
}
