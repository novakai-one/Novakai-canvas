/*
 * Admitting one declared font or image into the render's temporary asset store. A declaration
 * pinned by `sha256:` digest is taken as it is; any other is read through the confined resource
 * reader and staged with Assets. Theme fonts and source images both come through here. Pure apart
 * from the injected ports; only the temporary store is written. The caller fixes the named
 * declaration and runs render:png again.
 */
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { ResourceRequest } from '../../contract/records/foreign.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { ResourceToStage } from '../../contract/records/staged-resource.js';
import type { AssetDigest, FilePath } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';
import { readDeclaredResource } from '../resources/stage.js';

/** What admitting one declaration uses: the resource reader and the render's asset store. */
export interface AdmissionDependencies {
  readonly assets: Pick<RenderAssets, 'stage'>;
  readonly resources: ResourceReader;
}

/**
 * The digest of one declaration's bytes, read relative to `file`: its pin, or the digest Assets
 * stored the file's bytes under. Fails with `invalid-response` (the declaration has no alias), as
 * the resource read does (`absolute-path`, `path-escape`, `source-unavailable`, `unsupported-media`,
 * `resource-mismatch`, `resource-too-large`, each with its `location`), or with Assets' failure.
 */
export async function admitResource(
  file: FilePath,
  request: ResourceRequest,
  dependencies: AdmissionDependencies,
): Promise<Result<AssetDigest, RenderFailureSource>> {
  const resource = await readDeclaredResource(file, request, dependencies.resources);
  if (!resource.ok) return resource;
  return storedDigest(resource.value, dependencies.assets);
}

/** A pinned declaration's digest as it is; local bytes staged first. Fails with Assets' failure. */
function storedDigest(
  resource: ResourceToStage,
  assets: AdmissionDependencies['assets'],
): Promise<Result<AssetDigest, RenderFailureSource>> {
  if (resource.kind === 'pinned') return Promise.resolve(success(resource.digest));
  return assets.stage(resource.input);
}
