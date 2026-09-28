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
} from '../../contract/records/foreign.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import { renderFaultFailure, success, type Result } from '../../contract/errors.js';
import { parseAssetPin } from '../resources/digests.js';
import { combined, mapped } from '../shared/results.js';

/** What building a snapshot uses: stored bytes read back by digest, and a base64 decoder. */
export type SnapshotAssets = Pick<RenderAssets, 'readBack' | 'decodeBase64'>;

/** One font the rendered document embeds. */
type DocumentFont = RenderDocument['fonts'][number];

/** A preset's JSON text as UTF-8 bytes. */
const utf8 = new TextEncoder();

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
  if (!resources.ok) return resources;
  return success({
    identity: snapshotIdentity(collection, document),
    collection,
    scene: document.scene,
    resources: resources.value,
    paint: documentPaint(document),
  });
}

/**
 * Every byte the snapshot retains: collection assets, then document fonts, then catalog presets.
 * Fails as the first failing asset does.
 */
function retainedResources(
  document: RenderDocument,
  catalog: Catalog,
  collection: Collection,
  assets: SnapshotAssets,
): Result<readonly Resource[], RenderFailureSource> {
  const assetResources = combined(collection.assets.map((asset) => assetResource(asset, assets)));
  return mapped(assetResources, (retained) => [
    ...retained,
    ...document.fonts.map((font) => fontResource(font, assets)),
    ...catalog.map(presetResource),
  ]);
}

/**
 * One asset's stored bytes with its alt text. Fails with `invalid-asset-pin` when its digest is
 * not a pin (Model's check refuses such a collection first), or with Assets' failure.
 */
function assetResource(
  asset: CollectionAsset,
  assets: SnapshotAssets,
): Result<Resource, RenderFailureSource> {
  const digest = parseAssetPin(asset.digest);
  if (digest === undefined)
    return renderFaultFailure({ code: 'invalid-asset-pin', asset: asset.id, digest: asset.digest });
  return mapped(assets.readBack(digest), (blob) => ({
    kind: 'asset',
    digest: blob.descriptor.digest,
    mediaType: blob.descriptor.mediaType,
    bytes: assets.decodeBase64(blob.base64),
    metadata: { alt: asset.alt },
  }));
}

/** One embedded font's bytes with its family. */
function fontResource(
  font: DocumentFont,
  assets: SnapshotAssets,
): Resource {
  return {
    kind: 'font',
    digest: font.digest,
    mediaType: font.mediaType,
    bytes: assets.decodeBase64(font.base64),
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

/** The collection's ID, revision and title with the scene's input key. */
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

/** The document's surface, border and text colours as Export's paint. */
function documentPaint(document: RenderDocument): ExportSnapshot['paint'] {
  return {
    fill: document.style.surface,
    stroke: document.style.border,
    text: document.style.text,
  };
}
