/*
 * Why this file exists
 *
 * A theme or source can name a font or image file, as in `font body source="./fonts/inter.woff2"`.
 * A render needs those bytes but must not touch the saved workspace, so each file is read and
 * stored in the render's temporary store. A `source="sha256:…"` names bytes by their hash, so it
 * is used as it is.
 *
 * This file does that for one font or image, and gives back the digest its bytes are stored under.
 * Theme fonts and source images both come through here. Only the temporary store is written.
 */
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { ResourceRequest } from '../../contract/records/foreign.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { ResourceToStage } from '../../contract/records/staged-resource.js';
import type { AssetDigest, FilePath } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';
import { readDeclaredResource } from '../resources/stage.js';

/**
 * What storing one font or image needs: `resources` reads the file, and `assets` is the
 * render's temporary store.
 */
export interface AdmissionDependencies {
  readonly assets: Pick<RenderAssets, 'stage'>;
  readonly resources: ResourceReader;
}

/**
 * Stores the font or image `declaration` names, and gives back the digest of its bytes. Its file is
 * read relative to `declaringFile`, the theme or source file that names it.
 * Mistakes: the file can't be read, is outside the declaring file's folder, is the wrong type or
 * too large, or Assets refuses the bytes.
 */
export async function admitResource(
  declaringFile: FilePath,
  declaration: ResourceRequest,
  dependencies: AdmissionDependencies,
): Promise<Result<AssetDigest, RenderFailureSource>> {
  const resource = await readDeclaredResource(declaringFile, declaration, dependencies.resources);
  if (!resource.ok) {
    return resource;
  }
  return storeResource(resource.value, dependencies.assets);
}

/**
 * Stores the bytes read from a local file, and gives back their digest. A `sha256:…` declaration
 * already names its bytes, so its digest is used as it is.
 */
async function storeResource(
  resource: ResourceToStage,
  assets: AdmissionDependencies['assets'],
): Promise<Result<AssetDigest, RenderFailureSource>> {
  if (resource.kind === 'pinned') {
    return success(resource.digest);
  }
  return assets.stage(resource.input);
}
