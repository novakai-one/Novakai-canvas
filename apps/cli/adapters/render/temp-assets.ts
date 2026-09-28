/*
 * Why this file exists
 *
 * A render must store its fonts and images somewhere, but never in the saved workspace. So each
 * render gets its own Assets store in a fresh temp folder, such as `/tmp/canvas-render-a1B2c3`,
 * and the folder is removed when the store is closed.
 *
 * This file opens and closes that store. If opening fails, the folder is removed at once, so
 * nothing is left behind. It never touches any other folder. Mistakes come back as values.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAssets, type AssetError, type Assets } from '@novakai/canvas-assets';
import type { ProviderFault } from '../../contract/records/render-fault.js';
import { filePath, type FilePath } from '../../contract/brands.js';
import type { TempAssetStore } from '../../contract/ports/render-assets.js';
import { providerFailure, success, type Result } from '../../contract/errors.js';

/** What opening or closing the store fails with. */
type StoreFailure = ProviderFault | AssetError;

/**
 * Makes a fresh temp folder and opens an Assets store in it. Fails with `provider-failed` if the
 * folder can't be made, or with Assets' own failure (the folder is then removed).
 */
export async function openTempAssetStore(): Promise<Result<TempAssetStore, StoreFailure>> {
  const directory = await created();
  if (!directory.ok) return directory;
  return opened(directory.value);
}

/** Make the directory. A throw becomes `provider-failed` with its path, OS code and syscall. */
async function created(): Promise<Result<FilePath, ProviderFault>> {
  try {
    return success(filePath.parse(await mkdtemp(join(tmpdir(), 'canvas-render-'))));
  } catch (error) {
    return providerFailure(error);
  }
}

/** Assets opened in `path`. Fails with Assets' failure after removing `path`. */
async function opened(path: FilePath): Promise<Result<TempAssetStore, StoreFailure>> {
  const assets = openAssets(path);
  if (!assets.ok) return removedAfter(path, assets.error);
  return success({ assets: assets.value, close: () => closed(assets.value, path) });
}

/** `error` as the outcome once `path` is removed; a failed removal is not reported over it. */
async function removedAfter(
  path: FilePath,
  error: AssetError,
): Promise<Result<never, AssetError>> {
  await removed(path);
  return { ok: false, error };
}

/**
 * Close the store, then remove its directory; both are always attempted. Fails with Assets' close
 * failure first, else the removal's `provider-failed`.
 */
async function closed(
  assets: Pick<Assets, 'close'>,
  path: FilePath,
): Promise<Result<void, StoreFailure>> {
  const store = assets.close();
  const directory = await removed(path);
  if (!store.ok) return store;
  return directory;
}

/** Delete the directory and all it holds; a missing one is not a failure. */
async function removed(path: FilePath): Promise<Result<void, ProviderFault>> {
  try {
    await rm(path, { recursive: true, force: true });
    return success(undefined);
  } catch (error) {
    return providerFailure(error);
  }
}
