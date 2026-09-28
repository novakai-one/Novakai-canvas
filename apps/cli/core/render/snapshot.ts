/*
 * The immutable export snapshot of one render: identity, collection, scene, paint, and every byte
 * it retains (collection assets, document fonts, catalog presets). Pure; asset bytes resolve
 * through the render's asset store and base64 is decoded by the injected decoder. Export's check
 * that it reads only these bytes lives in retained-resources.ts. The caller fixes the named asset
 * and runs render:png again.
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
import { assetOfPin } from '../resources/digests.js';
import { combined, mapped } from '../shared/results.js';

/** What the snapshot reads: the stored asset bytes and the base64 decoder. */
export type SnapshotAssets = Pick<RenderAssets, 'readBack' | 'decodeBase64'>;

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
  const digest = assetOfPin(asset.digest);
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
