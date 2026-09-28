/*
 * Why this file exists
 *
 * A render stores each font and image its collection uses, then reads the bytes back to draw.
 * A logo is stored once, and the collection points at it by its digest. Core asks for this
 * through `RenderAssets`, but can't import Assets itself.
 *
 * This file answers those asks with the render's own throwaway Assets store. It never writes to
 * the saved workspace. Every mistake is Assets' own, given back as a value.
 */
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { RenderAssets } from '../../contract/ports/render-assets.js';
import type { AssetDigest } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';
import type { Assets, StageInput } from '../../contract/records/foreign.js';

/**
 * Gives core its way to store a render's fonts and images, and read them back, using `store`, the
 * render's throwaway Assets store. Storing and reading back fail as Assets does.
 */
export function createRenderAssets(store: Pick<Assets, 'stage' | 'resolve'>): RenderAssets {
  return {
    stage: (input) => stagedDigest(store, input),
    readBack: (digest) => store.resolve(digest),
    decodeBase64: (text) => Buffer.from(text, 'base64'),
  };
}

/** The digest Assets stored `input`'s normalized bytes under. Fails with Assets' failure. */
async function stagedDigest(
  assets: Pick<Assets, 'stage'>,
  input: StageInput,
): Promise<Result<AssetDigest, RenderFailureSource>> {
  const admitted = await assets.stage(input);
  if (!admitted.ok) return admitted;
  return success(admitted.value.descriptor.digest);
}
