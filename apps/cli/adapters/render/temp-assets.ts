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

/** The start of each temp folder's name; the system adds six random characters. */
const tempFolderPrefix = 'canvas-render-';

/**
 * Makes a fresh temp folder and opens an Assets store in it. Fails with `provider-failed` if the
 * folder can't be made, or with Assets' own failure (the folder is then removed).
 */
export async function openTempAssetStore(): Promise<Result<TempAssetStore, StoreFailure>> {
  const folder = await makeTempFolder();
  if (!folder.ok) {
    return folder;
  }
  return openStoreIn(folder.value);
}

/** Makes a fresh, empty folder in the system's temp folder, such as `/tmp/canvas-render-a1B2c3`. */
async function makeTempFolder(): Promise<Result<FilePath, ProviderFault>> {
  try {
    const prefixPath = join(tmpdir(), tempFolderPrefix);
    const createdPath = await mkdtemp(prefixPath);
    const folder = filePath.parse(createdPath);
    return success(folder);
  } catch (thrown) {
    return providerFailure(thrown);
  }
}

/** Opens an Assets store in the folder. If that fails, removes the folder first. */
async function openStoreIn(folder: FilePath): Promise<Result<TempAssetStore, StoreFailure>> {
  const opened = openAssets(folder);
  if (!opened.ok) {
    // A failed removal isn't reported: Assets' own mistake says more.
    await removeFolder(folder);
    return openStoreFailure(opened.error);
  }
  const store = storeWithClose(opened.value, folder);
  return success(store);
}

/** Pairs the open store with its `close`, which also removes the folder. */
function storeWithClose(
  assets: Assets,
  folder: FilePath,
): TempAssetStore {
  return { assets, close: () => closeStoreAndRemoveFolder(assets, folder) };
}

/** Closes the store, then removes its folder. Both always run; a close mistake comes first. */
async function closeStoreAndRemoveFolder(
  assets: Pick<Assets, 'close'>,
  folder: FilePath,
): Promise<Result<void, StoreFailure>> {
  const closed = assets.close();
  const removed = await removeFolder(folder);
  if (!closed.ok) {
    return closed;
  }
  return removed;
}

/** Deletes the folder and everything in it. A folder already gone is not a mistake. */
async function removeFolder(folder: FilePath): Promise<Result<void, ProviderFault>> {
  try {
    await rm(folder, { recursive: true, force: true });
    return success(undefined);
  } catch (thrown) {
    return providerFailure(thrown);
  }
}

/** Passes on Assets' own mistake about opening the store. */
function openStoreFailure(assetError: AssetError): Result<never, AssetError> {
  return { ok: false, error: assetError };
}
