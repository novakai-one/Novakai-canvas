/*
 * Why this file exists
 *
 * A source can declare fonts and images, as in `asset @logo image source="./assets/logo.svg"`.
 * Before the collection is drawn, each file's bytes must be stored for this render, and described
 * the way Model expects: ID, content hash, file type, alt text and credit.
 *
 * This file stores each one and writes that description (Model's asset record). It refuses an
 * asset ID declared twice. Model checks the records later, when Language turns the source into a
 * collection. Each step gives back a `Result` (see `contract/errors.ts`).
 */
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type {
  CollectionAsset,
  ResourceRequest,
  StoredBlob,
} from '../../contract/records/foreign.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { RenderFault } from '../../contract/records/render-fault.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import { assetId, type AssetDigest, type AssetId, type FilePath } from '../../contract/brands.js';
import {
  failure,
  renderFaultFailure,
  success,
  type LocalFailure,
  type Result,
} from '../../contract/errors.js';
import { formatPin } from '../resources/digests.js';
import { chooseAltText, collectCredit } from '../resources/provenance.js';
import { combined } from '../shared/results.js';
import { admitResource, type AdmissionDependencies } from './resource-admission.js';

/**
 * What storing a source's fonts and images needs: Language's parser, the file reader and the
 * render's temporary store.
 */
export interface AssetDependencies extends AdmissionDependencies {
  readonly sources: Pick<RenderSources, 'parse'>;
  readonly assets: Pick<RenderAssets, 'stage' | 'readBack'>;
}

/**
 * Stores every font and image `source` declares, and gives back Model's record of each, in the
 * order they are declared.
 * Mistakes: Language can't parse the source, a file can't be read or stored, or one asset ID is
 * declared twice (`duplicate-asset`).
 */
export async function admitSourceAssets(
  source: SourceFile,
  dependencies: AssetDependencies,
): Promise<Result<readonly CollectionAsset[], RenderFailureSource>> {
  const parsed = dependencies.sources.parse(source.source);
  if (!parsed.ok) {
    return parsed;
  }
  const declarations = parsed.value.resources.filter(isAsset);
  const records = await storeAssets(source.path, declarations, dependencies);
  if (!records.ok) {
    return records;
  }
  return requireUniqueIds(records.value);
}

/** Whether a declaration is a font or image, not the theme reference. */
function isAsset(declaration: ResourceRequest): boolean {
  return declaration.kind !== 'theme';
}

/**
 * Stores every declared font and image, all at once, and writes Model's record of each. Gives
 * back the records in declaration order, or the first failure in that order.
 */
async function storeAssets(
  file: FilePath,
  declarations: readonly ResourceRequest[],
  dependencies: AssetDependencies,
): Promise<Result<readonly CollectionAsset[], RenderFailureSource>> {
  const storing = declarations.map((declaration) => storeAsset(file, declaration, dependencies));
  const records = await Promise.all(storing);
  return combined(records);
}

/** Stores one declared font or image, reads it back, and writes Model's record of it. */
async function storeAsset(
  file: FilePath,
  declaration: ResourceRequest,
  dependencies: AssetDependencies,
): Promise<Result<CollectionAsset, RenderFailureSource>> {
  const digest = await admitResource(file, declaration, dependencies);
  if (!digest.ok) {
    return digest;
  }
  const stored = dependencies.assets.readBack(digest.value);
  if (!stored.ok) {
    return stored;
  }
  return assetRecord(declaration, digest.value, stored.value);
}

/**
 * Writes Model's record of one stored font or image: the declared name as its asset ID, the
 * bytes' pin and file type, its alt text and its credit.
 */
function assetRecord(
  declaration: ResourceRequest,
  digest: AssetDigest,
  stored: StoredBlob,
): Result<CollectionAsset> {
  const id = checkDeclaredId(declaration);
  if (!id.ok) {
    return id;
  }
  const record: CollectionAsset = {
    id: id.value,
    digest: formatPin(digest),
    mediaType: stored.descriptor.mediaType,
    alt: chooseAltText(declaration),
    ...collectCredit(declaration),
  };
  return success(record);
}

/**
 * Checks the declared name as Model's asset ID. Language reads the name with Model's ID rules, so
 * only a broken Language answer fails here.
 */
function checkDeclaredId(declaration: ResourceRequest): Result<AssetId> {
  const id = assetId.safeParse(declaration.alias);
  if (!id.success) {
    return invalidAssetIdFailure(declaration.alias);
  }
  return success(id.data);
}

/**
 * Gives back the records when no asset ID is declared twice. Language's lookup holds one record
 * per ID, so a second declaration of an ID can't be told apart from the first.
 */
function requireUniqueIds(
  records: readonly CollectionAsset[],
): Result<readonly CollectionAsset[], RenderFault> {
  const repeated = findRepeatedRecord(records);
  if (repeated !== undefined) {
    return duplicateAssetFailure(repeated.id);
  }
  return success(records);
}

/** Finds the first record whose asset ID an earlier record already has. */
function findRepeatedRecord(records: readonly CollectionAsset[]): CollectionAsset | undefined {
  return records.find((record, index) => hasEarlierSameId(records, record, index));
}

/** Whether a record before `index` in `records` has the same asset ID as `record`. */
function hasEarlierSameId(
  records: readonly CollectionAsset[],
  record: CollectionAsset,
  index: number,
): boolean {
  const firstIndex = records.findIndex((other) => other.id === record.id);
  return firstIndex < index;
}

/** Makes the mistake for a declared name that isn't an asset ID (`invalid-response`). */
function invalidAssetIdFailure(alias: ResourceRequest['alias']): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-response',
    message: `Declared asset is not an asset ID: ${alias}`,
  });
}

/** Makes the mistake for one asset ID declared twice (`duplicate-asset`). */
function duplicateAssetFailure(asset: AssetId): Result<never, RenderFault> {
  return renderFaultFailure({ code: 'duplicate-asset', asset });
}
