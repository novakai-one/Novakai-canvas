/*
 * Export resource retention: the snapshot retains its pinned theme preset, every collection asset
 * and every document font, byte-for-byte through the lease. A missing theme refuses before any
 * read; otherwise every asset and font is read, and the first failure — assets before fonts —
 * refuses the snapshot. Pure; the guarded lease read is injected.
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
} from '../../contract/records/capabilities.js';
import type { ExportFailure } from '../../contract/records/export/snapshot.js';
import type { LeaseRead } from '../../contract/ports/export.js';
import type { RenderDocument } from '../../contract/records/rendering/job.js';
import { exportRejection } from './faults.js';

/** Every retained resource: the theme preset, then collection assets, then document fonts. */
export function retainedResources(
  read: LeaseRead,
  collection: Collection,
  document: RenderDocument,
  presets: Catalog,
): ExportResult<readonly Resource[]> {
  const theme = themeResource(collection, presets);
  if (theme === undefined)
    return exportRejection(
      'resource-rejected',
      'resources.theme',
      'The pinned theme is unavailable',
    );
  const assets = assetResources(read, collection);
  const fonts = fontResources(read, document);
  return combineResources(theme, assets, fonts);
}

/** The resource port Export inspects through; it admits the retained resources as given. */
export function resourceInspector(): Resources {
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
      resourceFromBlob(read(item.digest.slice(7), `resources.${item.id}`), 'asset', {
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
    : exportRejection('resource-rejected', blob.error.path, blob.error.message);
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
