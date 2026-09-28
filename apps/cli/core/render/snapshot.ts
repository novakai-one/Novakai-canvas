/*
 * Why this file exists
 *
 * Export draws from a snapshot: one fixed record of what to draw. It holds the collection, its
 * layout and colours, and the bytes Export may use: the collection's images, the drawing's fonts,
 * and every theme and recipe the render knows. A logo is read back from the temporary store.
 *
 * This file builds that snapshot. It only gathers bytes already stored or already in the layout;
 * it writes nothing. `retained-resources.ts` makes sure Export reads only these bytes.
 */
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type {
  Catalog,
  Collection,
  CollectionAsset,
  ExportSnapshot,
  RenderDocument,
  Resource,
  StoredBlob,
} from '../../contract/records/foreign.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { RenderFault } from '../../contract/records/render-fault.js';
import { renderFaultFailure, success, type Result } from '../../contract/errors.js';
import { parseAssetPin } from '../resources/digests.js';
import { combined } from '../shared/results.js';

/** What building a snapshot uses: stored bytes read back by digest, and a base64 decoder. */
export type SnapshotAssets = Pick<RenderAssets, 'readBack' | 'decodeBase64'>;

/** One font the rendered document embeds. */
type DocumentFont = RenderDocument['fonts'][number];

/** Turns a preset's JSON text into UTF-8 bytes. */
const utf8Encoder = new TextEncoder();

/**
 * Builds the snapshot Export draws every section from, out of the checked `collection`, the
 * service's laid-out `document` and the render's `catalog`.
 * Mistakes: a font or image whose digest isn't a `sha256:…` pin (`invalid-asset-pin`), or bytes the
 * temporary store can't give back.
 */
export function buildExportSnapshot(
  collection: Collection,
  document: RenderDocument,
  catalog: Catalog,
  assets: SnapshotAssets,
): Result<ExportSnapshot, RenderFailureSource> {
  const resources = retainedResources(document, catalog, collection, assets);
  if (!resources.ok) {
    return resources;
  }
  const identity = snapshotIdentity(collection, document);
  const paint = documentPaint(document);
  return success({
    identity,
    collection,
    scene: document.scene,
    resources: resources.value,
    paint,
  });
}

/**
 * Gathers every resource the snapshot keeps: the collection's fonts and images, then the
 * document's fonts, then the catalog's themes and recipes.
 */
function retainedResources(
  document: RenderDocument,
  catalog: Catalog,
  collection: Collection,
  store: SnapshotAssets,
): Result<readonly Resource[], RenderFailureSource> {
  const collectionAssets = collectionAssetResources(collection, store);
  if (!collectionAssets.ok) {
    return collectionAssets;
  }
  const fonts = document.fonts.map((font) => fontResource(font, store));
  const presets = catalog.map(presetResource);
  return success([...collectionAssets.value, ...fonts, ...presets]);
}

/** Reads back the stored bytes of each of the collection's fonts and images, in record order. */
function collectionAssetResources(
  collection: Collection,
  store: SnapshotAssets,
): Result<readonly Resource[], RenderFailureSource> {
  const resources = collection.assets.map((asset) => assetResource(asset, store));
  return combined(resources);
}

/**
 * Reads back one font or image's stored bytes by its pin. Model's check refuses a collection with a
 * malformed pin first, so that mistake shouldn't happen here.
 */
function assetResource(
  asset: CollectionAsset,
  store: SnapshotAssets,
): Result<Resource, RenderFailureSource> {
  const digest = parseAssetPin(asset.digest);
  if (digest === undefined) {
    return invalidAssetPinFailure(asset);
  }
  const stored = store.readBack(digest);
  if (!stored.ok) {
    return stored;
  }
  const resource = storedAssetResource(asset, stored.value, store);
  return success(resource);
}

/** Describes one font or image's stored bytes for Export, with its alt text. */
function storedAssetResource(
  asset: CollectionAsset,
  stored: StoredBlob,
  store: SnapshotAssets,
): Resource {
  return {
    kind: 'asset',
    digest: stored.descriptor.digest,
    mediaType: stored.descriptor.mediaType,
    bytes: store.decodeBase64(stored.base64),
    metadata: { alt: asset.alt },
  };
}

/** Describes one font the document embeds for Export, with its family. */
function fontResource(
  font: DocumentFont,
  store: SnapshotAssets,
): Resource {
  return {
    kind: 'font',
    digest: font.digest,
    mediaType: font.mediaType,
    bytes: store.decodeBase64(font.base64),
    metadata: { family: font.family },
  };
}

/** Describes one catalog theme or recipe for Export, as its JSON text. */
function presetResource(preset: Catalog[number]): Resource {
  const presetJson = JSON.stringify(preset);
  return {
    kind: 'preset',
    digest: preset.digest,
    mediaType: 'application/json',
    bytes: utf8Encoder.encode(presetJson),
    metadata: {},
  };
}

/** Names the snapshot: the collection's ID, revision and title, and the scene's input key. */
function snapshotIdentity(
  collection: Collection,
  document: RenderDocument,
): ExportSnapshot['identity'] {
  return {
    collectionId: collection.id,
    revision: collection.revision,
    inputKey: document.scene.inputKey,
    title: collection.title,
  };
}

/** Gives the document's surface, border and text colours as Export's paint. */
function documentPaint(document: RenderDocument): ExportSnapshot['paint'] {
  return {
    fill: document.style.surface,
    stroke: document.style.border,
    text: document.style.text,
  };
}

/** Makes the mistake for a font or image whose digest isn't a `sha256:…` pin. */
function invalidAssetPinFailure(asset: CollectionAsset): Result<never, RenderFault> {
  return renderFaultFailure({ code: 'invalid-asset-pin', asset: asset.id, digest: asset.digest });
}
