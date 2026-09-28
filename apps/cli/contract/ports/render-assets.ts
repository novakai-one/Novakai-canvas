/*
 * Why this file exists
 *
 * A render needs the bytes of every font and image its collection uses, but it must never change
 * the saved workspace. So each render stores those bytes in its own throwaway store, in a fresh
 * temp folder, and removes it at the end. A logo the source names is stored there, then read back
 * when the section is drawn.
 *
 * This file names that throwaway store and what a render asks of it. It declares types only;
 * `adapters/render/` does the work.
 */
import type { RenderEvidence } from '../records/render-failure.js';
import type { Assets, StageInput, StoredBlob } from '../records/foreign.js';
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';

/** What a render asks of its throwaway font and image store. */
export interface RenderAssets {
  /**
   * Stores one file's bytes, tidied by Assets, and gives back their digest. Fails as Assets does.
   */
  stage(input: StageInput): Promise<Result<AssetDigest, RenderEvidence>>;
  /** Reads back the stored bytes of one digest, checked by Assets. Fails as Assets does. */
  resolve(digest: AssetDigest): Result<StoredBlob, RenderEvidence>;
  /** Turns base64 text into bytes. The text was already checked, so this never fails. */
  decodeBase64(base64: string): Uint8Array;
}

/** One render's throwaway Assets store, in a fresh temp folder only this render uses. */
export interface TempAssetStore {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  /**
   * Closes the store, then removes its folder. Both are always tried. Fails with Assets' close
   * failure first, or else `provider-failed` if the folder couldn't be removed.
   */
  close(): Promise<Result<void, RenderEvidence>>;
}
