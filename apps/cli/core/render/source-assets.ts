/*
 * A source's asset records: every font and image it declares, admitted into the render's temporary
 * asset store and described as Model's asset record (ID, pin, stored media type, alt text and
 * credit). Model is not asked here: Language's lowering hands the records to Model inside the
 * collection that declares them, so a bad record is reported at its declaration. Only an asset ID
 * declared twice is refused here, because the pins hold one record per ID. Pure apart from the
 * injected ports; only the temporary store is written. The caller fixes the named declaration and
 * runs render:png again.
 */
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type {
  CollectionAsset,
  ResourceRequest,
  StoredBlob,
} from '../../contract/records/foreign.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { RenderFault } from '../../contract/records/render-fault.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import { assetId, type AssetDigest, type AssetId, type FilePath } from '../../contract/brands.js';
import { faulted, success, type Result } from '../../contract/errors.js';
import { pinOf } from '../resources/digests.js';
import { altText, credit } from '../resources/provenance.js';
import { checked } from '../shared/checks.js';
import { combined } from '../shared/results.js';
import { admitResource, type AdmissionDependencies } from './resource-admission.js';

/** What a source's asset records use: Language's parse, admission and the stored bytes. */
export interface AssetDependencies extends AdmissionDependencies {
  readonly sources: Pick<RenderSources, 'parse'>;
  readonly assets: Pick<RenderAssets, 'stage' | 'resolve'>;
}

/**
 * The asset record of every font and image `source` declares, in declaration order.
 *
 * Steps; the first failure stops:
 * 1. Language parses the source.
 * 2. Each declaration is admitted and described by its stored bytes.
 * 3. Each asset ID must be declared once.
 *
 * Not done here: Model's check of the records, which Language's lowering runs on the whole
 * collection. Fails with Language's diagnostics, as {@link assetRecord} does, or with
 * `duplicate-asset`.
 */
export async function sourceAssets(
  source: SourceFile,
  dependencies: AssetDependencies,
): Promise<Result<readonly CollectionAsset[], RenderEvidence>> {
  const parsed = dependencies.sources.parse(source.source);
  if (!parsed.ok) return parsed;
  const declarations = parsed.value.resources.filter(isAsset);
  const described = await Promise.all(
    declarations.map((request) => assetRecord(source.file, request, dependencies)),
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
): Promise<Result<CollectionAsset, RenderEvidence>> {
  const digest = await admitResource(file, request, dependencies);
  if (!digest.ok) return digest;
  const stored = dependencies.assets.resolve(digest.value);
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
    digest: pinOf(digest),
    mediaType: stored.descriptor.mediaType,
    alt: altText(request),
    ...credit(request),
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
  return faulted({ code: 'duplicate-asset', asset: repeated.id });
}

/** Whether `record`, at `index`, is the first of `records` with its ID. */
function isFirstWithId(
  records: readonly CollectionAsset[],
  record: CollectionAsset,
  index: number,
): boolean {
  return records.findIndex((other) => other.id === record.id) === index;
}
