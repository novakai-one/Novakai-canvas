/*
 * Render resource retention: the export snapshot retains every asset, font and preset
 * byte-for-byte, and Export may inspect only what the snapshot already retained. Pure; the
 * asset resolve port is injected. Model checked every asset pin; Assets refuses anything else with
 * its own failure. Theme pins live in contract/render.js.
 */
import type {
  Assets,
  Catalog,
  Collection,
  RenderDocument,
  Resource,
  Resources,
} from '../../contract/records/foreign.js';
import { assetOfPin } from '../resources/digests.js';
import { accepted } from './faults.js';

/** Every byte the exact export snapshot needs: collection assets, document fonts, catalog presets. */
export function retainedResources(
  document: RenderDocument,
  catalog: Catalog,
  collection: Collection,
  resolve: Assets['resolve'],
): readonly Resource[] {
  return [
    ...collection.assets.map((asset): Resource => {
      const blob = accepted(resolve(assetOfPin(asset.digest)));
      return {
        kind: 'asset',
        digest: blob.descriptor.digest,
        mediaType: blob.descriptor.mediaType,
        bytes: Buffer.from(blob.base64, 'base64'),
        metadata: { alt: asset.alt },
      };
    }),
    ...document.fonts.map((font): Resource => ({
      kind: 'font',
      digest: font.digest,
      mediaType: font.mediaType,
      bytes: Buffer.from(font.base64, 'base64'),
      metadata: { family: font.family },
    })),
    ...catalog.map((preset): Resource => ({
      kind: 'preset',
      digest: preset.digest,
      mediaType: 'application/json',
      bytes: Buffer.from(JSON.stringify(preset)),
      metadata: {},
    })),
  ];
}

/** Export may inspect only the exact resources already admitted for the immutable snapshot. */
export function resourceInspector(retained: readonly Resource[]): Resources {
  return {
    async inspect(items) {
      if (!items.every((item) => retained.some((candidate) => sameResource(item, candidate))))
        return {
          ok: false,
          error: {
            code: 'resource-rejected',
            path: 'snapshot.resources',
            message: 'Resource differs from its owner-admitted snapshot',
            recovery: 'Rebuild the snapshot through its resource owners and retry.',
          },
        };
      return { ok: true, value: items };
    },
  };
}

/** Byte equality and complete metadata equality prevent borrowing a retained identity. */
function sameResource(
  left: Resource,
  right: Resource,
): boolean {
  return (
    left.kind === right.kind &&
    left.digest === right.digest &&
    left.mediaType === right.mediaType &&
    Buffer.from(left.bytes).equals(Buffer.from(right.bytes)) &&
    JSON.stringify(left.metadata) === JSON.stringify(right.metadata)
  );
}
