/*
 * A source's images as Model asset records, and the admission of any declared font or image into
 * the render's temporary asset store. A declaration pinned by `sha256:` digest is taken as it is;
 * any other is read through the confined resource reader and staged with Assets. Model checks the
 * records on a stand-in collection. Pure apart from the injected ports; nothing stored is changed.
 * The caller fixes the named declaration and runs render:png again.
 */
import type { RenderEnvironment } from '../../contract/ports/render.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { Catalog, Collection, ResourceRequest } from '../../contract/records/foreign.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { StagedResource } from '../../contract/records/staged-resource.js';
import type { AssetDigest, FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { pinOf, type PinnedDigest } from '../resources/digests.js';
import { altText, credit, type Credit } from '../resources/provenance.js';
import { declaredResource } from '../resources/stage.js';
import { combined, mapped } from '../shared/results.js';
import { themePins } from './pins.js';

/** What admitting one declaration uses: the resource reader and the render's asset store. */
export interface AdmissionDependencies {
  readonly env: Pick<RenderEnvironment, 'stageAsset'>;
  readonly resources: ResourceReader;
}

/** What a source's asset records use: admission, the parse, the asset reads and Model's check. */
export interface AssetDependencies extends AdmissionDependencies {
  readonly env: Pick<RenderEnvironment, 'parse' | 'stageAsset' | 'resolveAsset' | 'validate'>;
}

/** One asset record before Model checks it. */
interface AssetEntry extends Credit {
  readonly id: string;
  readonly digest: PinnedDigest;
  readonly mediaType: string;
  readonly alt: string;
}

/** The theme the stand-in collection is checked with; any admitted theme would do. */
const standInTheme = 'paper';

/**
 * The asset records of every image `source` declares, in declaration order, as Model checked
 * them. Fails with Language's diagnostics, the first failed declaration (see
 * {@link admitResource}), Assets' failure, or Model's diagnostics.
 */
export async function sourceAssets(
  source: SourceFile,
  catalog: Catalog,
  dependencies: AssetDependencies,
): Promise<Result<Collection['assets'], RenderEvidence>> {
  const parsed = dependencies.env.parse(source.source);
  if (!parsed.ok) return parsed;
  const images = parsed.value.resources.filter(isImage);
  const entries = await Promise.all(
    images.map((request) => assetEntry(source.file, request, dependencies)),
  );
  const checked = combined(entries);
  if (!checked.ok) return checked;
  return checkedAssets(checked.value, catalog, dependencies.env);
}

/**
 * The digest of one declaration's bytes, read relative to `file`: its pin, or the digest Assets
 * stored the file's bytes under. Fails as the resource read does (`absolute-path`, `path-escape`,
 * `source-unavailable`, `unsupported-media`, `resource-mismatch`, `resource-too-large`, each with
 * its `location`), or with Assets' failure.
 */
export async function admitResource(
  file: FilePath,
  request: ResourceRequest,
  dependencies: AdmissionDependencies,
): Promise<Result<AssetDigest, RenderEvidence>> {
  const resource = await declaredResource(file, request, dependencies.resources);
  if (!resource.ok) return resource;
  return storedDigest(resource.value, dependencies.env);
}

/** Whether a declaration is an image or font, not the theme reference. */
function isImage(request: ResourceRequest): boolean {
  return request.kind !== 'theme';
}

/** A pinned declaration's digest as it is; local bytes staged first. Fails with Assets' failure. */
function storedDigest(
  resource: StagedResource,
  env: AdmissionDependencies['env'],
): Promise<Result<AssetDigest, RenderEvidence>> {
  if (resource.kind === 'pinned') return Promise.resolve(success(resource.digest));
  return env.stageAsset(resource.input);
}

/**
 * One declaration's asset record: alias, pin, the stored media type, alt text and credit. Fails as
 * {@link admitResource} does, or with Assets' failure to resolve the stored bytes.
 */
async function assetEntry(
  file: FilePath,
  request: ResourceRequest,
  dependencies: AssetDependencies,
): Promise<Result<AssetEntry, RenderEvidence>> {
  const digest = await admitResource(file, request, dependencies);
  if (!digest.ok) return digest;
  return mapped(dependencies.env.resolveAsset(digest.value), (blob) => ({
    id: request.alias,
    digest: pinOf(digest.value),
    mediaType: blob.descriptor.mediaType,
    alt: altText(request),
    ...credit(request),
  }));
}

/** The records as Model checks them on a stand-in collection. Fails with Model's diagnostics. */
function checkedAssets(
  entries: readonly AssetEntry[],
  catalog: Catalog,
  env: AssetDependencies['env'],
): Result<Collection['assets'], RenderEvidence> {
  const standIn = env.validate({
    schemaVersion: 1,
    id: 'headless-assets',
    revision: 0,
    title: 'Headless asset bindings',
    arrangement: { algorithm: 'grid' },
    theme: themePins(catalog)[standInTheme],
    assets: entries,
  });
  return mapped(standIn, (collection) => collection.assets);
}
