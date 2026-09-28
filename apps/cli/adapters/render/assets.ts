/*
 * The render environment's asset port over one render's temporary Assets store: stage a file's
 * bytes and return their digest, read a digest's stored bytes back, decode base64. Writes only to
 * the temporary store; nothing stored is changed. Every failure is Assets' own, returned as a
 * value; core/render/render.ts owns recovery.
 */
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { AssetDigest } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';
import type { Assets, StageInput } from '../../contract/records/foreign.js';

/** The asset port over `assets`. Builds nothing and cannot fail; each method fails as Assets does. */
export function createRenderAssets(assets: Pick<Assets, 'stage' | 'resolve'>): RenderAssets {
  return {
    stage: (input) => stagedDigest(assets, input),
    resolve: (digest) => assets.resolve(digest),
    decodeBase64: (text) => Buffer.from(text, 'base64'),
  };
}

/** The digest Assets stored `input`'s normalized bytes under. Fails with Assets' failure. */
async function stagedDigest(
  assets: Pick<Assets, 'stage'>,
  input: StageInput,
): Promise<Result<AssetDigest, RenderEvidence>> {
  const admitted = await assets.stage(input);
  if (!admitted.ok) return admitted;
  return success(admitted.value.descriptor.digest);
}
