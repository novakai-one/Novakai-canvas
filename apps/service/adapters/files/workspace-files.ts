/*
 * Why this file exists
 *
 * A workspace is a folder on disk. For example, `pnpm dev --workspace ./my-workspace` needs two
 * stores in that folder: `assets/` for uploaded files, and `workspace.sqlite` for the diagrams.
 *
 * This file opens both, in that order, and hands back one way to close them. If the database won't
 * open, it closes the files store again. It only makes folders and opens the stores; it never
 * writes a record, and never deletes or replaces an existing file.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetError, Assets } from '@novakai/canvas-assets';
import type { Persistence, StorageError } from '@novakai/canvas-persistence';
import type {
  WorkspaceOptions,
  StoreOpeners,
  OpenStores,
} from '../../contract/records/workspace/startup.js';
import { failure, success, type Result } from '../../contract/errors.js';

/** The uploaded-files folder, inside the workspace folder. */
const ASSETS_FOLDER = 'assets';
/** The database file, inside the workspace folder. */
const DATABASE_FILE = 'workspace.sqlite';

/** A mistake one of the two stores reported. */
type StoreError = AssetError | StorageError;

/**
 * Opens the uploaded-files store, then the database, in `options.directory`, making the folder if
 * it is missing. The answer's `close` closes both, and reports the first that failed to close.
 * Fails with `unavailable`: at the store's path when a store won't open (its mistake kept as the
 * source), or at `workspace` when the folder can't be made or a store throws.
 */
export async function openWorkspaceFiles(
  options: WorkspaceOptions,
  openers: StoreOpeners,
): Promise<Result<OpenStores>> {
  try {
    const assetsFolder = join(options.directory, ASSETS_FOLDER);
    await mkdir(assetsFolder, { recursive: true });
    return openStores(options, openers);
  } catch {
    return workspaceFilesFailure();
  }
}

/** Opens the uploaded-files store first, then the database next to it. */
function openStores(
  options: WorkspaceOptions,
  openers: StoreOpeners,
): Result<OpenStores> {
  const assetsFolder = join(options.directory, ASSETS_FOLDER);
  const assets = openers.assets(assetsFolder);
  if (!assets.ok) {
    return storeFailure(assets.error);
  }
  return openDatabase(options, openers, assets.value);
}

/**
 * Opens the database once the uploaded-files store is open. If the database won't open, it closes
 * the files store again. Nothing is written yet: Authoring sets the workspace up afterwards.
 */
function openDatabase(
  options: WorkspaceOptions,
  openers: StoreOpeners,
  assets: Assets,
): Result<OpenStores> {
  const databaseFile = join(options.directory, DATABASE_FILE);
  const storage = openers.storage(databaseFile, options.workspace);
  if (!storage.ok) {
    assets.close();
    return storeFailure(storage.error);
  }
  const stores: OpenStores = {
    assets,
    storage: storage.value,
    close: () => closeStores(storage.value, assets),
  };
  return success(stores);
}

/**
 * Closes the database and the uploaded-files store. Both are closed even when one fails, and the
 * first that failed is reported. The files themselves are left as they are.
 */
async function closeStores(
  storage: Persistence,
  assets: Assets,
): Promise<Result<void>> {
  const databaseClosed = storage.close();
  const assetsClosed = assets.close();
  if (!databaseClosed.ok) {
    return storeFailure(databaseClosed.error);
  }
  if (!assetsClosed.ok) {
    return storeFailure(assetsClosed.error);
  }
  return success(undefined);
}

/** Makes the mistake for a store that won't open or close, at its path, keeping its own mistake. */
function storeFailure(storeError: StoreError): Result<never> {
  return failure('unavailable', storeError.path, storeError.message, storeError);
}

/** Makes the mistake for a workspace folder that can't be made, or a store that throws. */
function workspaceFilesFailure(): Result<never> {
  return failure('unavailable', 'workspace', 'Workspace files could not be opened');
}
