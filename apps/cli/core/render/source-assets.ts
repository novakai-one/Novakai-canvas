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
import { renderFaultFailure, success, type Result } from '../../contract/errors.js';
import { formatPin } from '../resources/digests.js';
import { chooseAltText, collectCredit } from '../resources/provenance.js';
import { checked } from '../shared/checks.js';
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
  if (!parsed.ok) return parsed;
  const declarations = parsed.value.resources.filter(isAsset);
  const described = await Promise.all(
    declarations.map((request) => assetRecord(source.path, request, dependencies)),
  );
  const records = combined(described);
  if (!records.ok) return records;
  return uniqueRecords(records.value);
}

/** Whether a declaration is a font or image, not the theme reference. */
function isAsset(request: ResourceRequest): boolean {
  return request.kind !== 'theme';
}

/**
 * One declaration admitted, read back from the store and described. Fails as
 * {@link admitResource} does, with Assets' failure to resolve the stored bytes, or as
 * {@link describedAsset} does.
 */
async function assetRecord(
  file: FilePath,
  request: ResourceRequest,
  dependencies: AssetDependencies,
): Promise<Result<CollectionAsset, RenderFailureSource>> {
  const digest = await admitResource(file, request, dependencies);
  if (!digest.ok) return digest;
  const stored = dependencies.assets.readBack(digest.value);
  if (!stored.ok) return stored;
  return describedAsset(request, digest.value, stored.value);
}

/**
 * The record of one declaration's stored bytes: its alias as the asset ID, the bytes' pin and media
 * type, its alt text and credit. Fails with `invalid-response` when the alias is not an asset ID.
 */
function describedAsset(
  request: ResourceRequest,
  digest: AssetDigest,
  stored: StoredBlob,
): Result<CollectionAsset> {
  const id = declaredId(request);
  if (!id.ok) return id;
  return success({
    id: id.value,
    digest: formatPin(digest),
    mediaType: stored.descriptor.mediaType,
    alt: chooseAltText(request),
    ...collectCredit(request),
  });
}

/**
 * The declaration's alias as Model's asset ID. Language reads an alias with Model's ID grammar, so
 * this fails (`invalid-response`) only on a broken Language answer.
 */
function declaredId(request: ResourceRequest): Result<AssetId> {
  return checked(assetId, request.alias, {
    code: 'invalid-response',
    message: `Declared asset is not an asset ID: ${request.alias}`,
  });
}

/**
 * The records when no asset ID is declared twice. Fails with `duplicate-asset` naming the first
 * repeated ID: the pins Language lowers against hold one record per ID, so a second declaration
 * cannot be told apart from the first.
 */
function uniqueRecords(
  records: readonly CollectionAsset[],
): Result<readonly CollectionAsset[], RenderFault> {
  const repeated = records.find((record, index) => !isFirstWithId(records, record, index));
  if (repeated === undefined) return success(records);
  return renderFaultFailure({ code: 'duplicate-asset', asset: repeated.id });
}

/** Whether `record`, at `index`, is the first of `records` with its ID. */
function isFirstWithId(
  records: readonly CollectionAsset[],
  record: CollectionAsset,
  index: number,
): boolean {
  return records.findIndex((other) => other.id === record.id) === index;
}
