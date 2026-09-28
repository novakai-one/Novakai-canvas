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
    stage: (input) => stageAndGiveDigest(store, input),
    readBack: (digest) => store.resolve(digest),
    decodeBase64,
  };
}

/** Stores one file's bytes in the render's store, and gives the digest they are stored under. */
async function stageAndGiveDigest(
  store: Pick<Assets, 'stage'>,
  input: StageInput,
): Promise<Result<AssetDigest, RenderFailureSource>> {
  const staged = await store.stage(input);
  if (!staged.ok) {
    return staged;
  }
  const digest = staged.value.descriptor.digest;
  return success(digest);
}

/** Turns base64 text back into bytes. */
function decodeBase64(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64');
}
