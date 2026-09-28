/*
 * One render's temporary Assets store, and the environment's asset port over it: stage bytes, read
 * stored bytes back, decode base64. Declarations only; adapters/render/temp-assets.ts opens the
 * store and adapters/render/assets.ts implements the port. Only the temporary store is written.
 * Every failure is returned as a value.
 */
import type { RenderEvidence } from '../records/render-failure.js';
import type { Assets, StageInput, StoredBlob } from '../records/foreign.js';
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';

/** The environment's asset reads and writes, over the render's temporary store. */
export interface RenderAssets {
  /** Normalize and store one file's bytes; returns their digest. Fails with Assets' failure. */
  stage(input: StageInput): Promise<Result<AssetDigest, RenderEvidence>>;
  /** The stored, verified bytes of one digest. Fails with Assets' failure. */
  resolve(digest: AssetDigest): Result<StoredBlob, RenderEvidence>;
  /** The bytes a base64 text holds. Assets and the service verified the text; cannot fail. */
  decodeBase64(text: string): Uint8Array;
}

/** One render's Assets store, opened in a fresh private temporary directory. */
export interface TempAssetStore {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  /**
   * Close the store, then remove the directory; both are always attempted. Fails with Assets'
   * close failure first, else `provider-failed` from the removal.
   */
  close(): Promise<Result<void, RenderEvidence>>;
}
