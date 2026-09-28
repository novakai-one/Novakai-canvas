/*
 * The immutable export snapshot of one render: identity, collection, scene, paint, and every byte
 * it retains (collection assets, document fonts, catalog presets), plus the resource inspector that
 * lets Export check only what the snapshot retained. Pure; asset bytes resolve through the render's
 * asset store and base64 is decoded by the injected decoder. The caller fixes the named asset and
 * runs render:png again.
 */
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type {
  Catalog,
  Collection,
  ExportSnapshot,
  RenderDocument,
  Resource,
  Resources,
} from '../../contract/records/foreign.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import { faulted, type Result } from '../../contract/errors.js';
import { assetOfPin } from '../resources/digests.js';
import { combined, mapped } from '../shared/results.js';

/** What the snapshot reads: the stored asset bytes and the base64 decoder. */
export type SnapshotEnvironment = Pick<RenderAssets, 'resolve' | 'decodeBase64'>;

/** One asset record the collection declares. */
type CollectionAsset = Collection['assets'][number];

/** One font the rendered document embeds. */
type DocumentFont = RenderDocument['fonts'][number];

/** A preset's JSON text as UTF-8 bytes. */
const utf8 = new TextEncoder();

/**
 * The snapshot Export draws every section from. Fails with `invalid-asset-pin` when an asset's
 * digest is not Model's `sha256:` pin, or with Assets' failure to resolve an asset's bytes.
 */
export function renderSnapshot(
  collection: Collection,
  document: RenderDocument,
  catalog: Catalog,
  env: SnapshotEnvironment,
): Result<ExportSnapshot, RenderEvidence> {
  return mapped(retainedResources(document, catalog, collection, env), (resources) => ({
    identity: {
      collectionId: collection.id,
      revision: collection.revision,
      inputKey: document.scene.inputKey,
      title: collection.title,
    },
    collection,
    scene: document.scene,
    resources,
    paint: {
      fill: document.style.surface,
      stroke: document.style.border,
      text: document.style.text,
    },
  }));
}

/** Export may inspect only resources equal, byte for byte and in metadata, to retained ones. */
export function resourceInspector(retained: readonly Resource[]): Resources {
  return {
    async inspect(items) {
      if (!items.every((item) => isRetained(item, retained)))
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

/**
 * Every byte the snapshot retains: collection assets, then document fonts, then catalog presets.
 * Fails as the first failing asset does.
 */
function retainedResources(
  document: RenderDocument,
  catalog: Catalog,
  collection: Collection,
  env: SnapshotEnvironment,
): Result<readonly Resource[], RenderEvidence> {
  const assets = combined(collection.assets.map((asset) => assetResource(asset, env)));
  return mapped(assets, (retained) => [
    ...retained,
    ...document.fonts.map((font) => fontResource(font, env)),
    ...catalog.map(presetResource),
  ]);
}

/**
 * One asset's stored bytes with its alt text. Fails with `invalid-asset-pin` when its digest is
 * not a pin (Model's check refuses such a collection first), or with Assets' failure.
 */
function assetResource(
  asset: CollectionAsset,
  env: SnapshotEnvironment,
): Result<Resource, RenderEvidence> {
  const digest = assetOfPin(asset.digest);
  if (digest === undefined)
    return faulted({ code: 'invalid-asset-pin', asset: asset.id, digest: asset.digest });
  return mapped(env.resolve(digest), (blob) => ({
    kind: 'asset',
    digest: blob.descriptor.digest,
    mediaType: blob.descriptor.mediaType,
    bytes: env.decodeBase64(blob.base64),
    metadata: { alt: asset.alt },
  }));
}

/** One embedded font's bytes with its family. */
function fontResource(
  font: DocumentFont,
  env: SnapshotEnvironment,
): Resource {
  return {
    kind: 'font',
    digest: font.digest,
    mediaType: font.mediaType,
    bytes: env.decodeBase64(font.base64),
    metadata: { family: font.family },
  };
}

/** One catalog preset as its JSON text. */
function presetResource(preset: Catalog[number]): Resource {
  return {
    kind: 'preset',
    digest: preset.digest,
    mediaType: 'application/json',
    bytes: utf8.encode(JSON.stringify(preset)),
    metadata: {},
  };
}

/** Whether `item` equals one retained resource. */
function isRetained(
  item: Resource,
  retained: readonly Resource[],
): boolean {
  return retained.some((candidate) => sameResource(item, candidate));
}

/** Same kind, digest, media type, bytes and metadata: no retained identity can be borrowed. */
function sameResource(
  left: Resource,
  right: Resource,
): boolean {
  return (
    left.kind === right.kind &&
    left.digest === right.digest &&
    left.mediaType === right.mediaType &&
    sameBytes(left.bytes, right.bytes) &&
    sameMetadata(left.metadata, right.metadata)
  );
}

/** Byte-for-byte equality. */
function sameBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The same keys, each with the same value. */
function sameMetadata(
  left: Resource['metadata'],
  right: Resource['metadata'],
): boolean {
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(([key, value]) => hasEntry(right, key, value))
  );
}

/** Whether `record` holds `key` with exactly `value`. */
function hasEntry(
  record: Resource['metadata'],
  key: string,
  value: unknown,
): boolean {
  return Object.hasOwn(record, key) && Object.is(record[key], value);
}
