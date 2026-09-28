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
import type { RenderFailureSource } from '../records/render-failure.js';
import type { Assets, StageInput, StoredBlob } from '../records/foreign.js';
import type { AssetDigest } from '../brands.js';
import type { Result } from '../errors.js';

/** What core asks of a render's throwaway font and image store. */
export interface RenderAssets {
  /**
   * Stores one file's bytes and gives back their digest. Assets checks the bytes first, and may
   * store a cleaned-up copy. Fails as Assets does.
   */
  stage(input: StageInput): Promise<Result<AssetDigest, RenderFailureSource>>;
  /** Reads back the stored bytes of one digest. Fails as Assets does. */
  readBack(digest: AssetDigest): Result<StoredBlob, RenderFailureSource>;
  /** Turns base64 text into bytes. The text was already checked, so this never fails. */
  decodeBase64(base64: string): Uint8Array;
}

/**
 * One render's throwaway Assets store, in a fresh temp folder only this render uses. `assets` is
 * Assets' own store, which the service's drawing code needs; core uses it only as `RenderAssets`.
 */
export interface TempAssetStore {
  readonly assets: Pick<Assets, 'stage' | 'resolve'>;
  /**
   * Closes the store, then removes its folder. Both are always tried. Fails with Assets' close
   * failure first, or else `provider-failed` if the folder couldn't be removed.
   */
  close(): Promise<Result<void, RenderFailureSource>>;
}
