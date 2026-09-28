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
import type { Assets } from '@novakai/canvas-assets';
import type { Persistence } from '@novakai/canvas-persistence';
import type {
  WorkspaceOptions,
  StoreOpeners,
  OpenStores,
} from '../../contract/records/workspace/startup.js';
import { failure, type Result } from '../../contract/errors.js';
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
    await mkdir(join(options.directory, 'assets'), { recursive: true });
    return open(options, openers);
  } catch {
    return failure('unavailable', 'workspace', 'Workspace files could not be opened');
  }
}
/** Closing both owners is attempted even if one reports a failure; callers preserve the original files. */
async function close(
  storage: Persistence,
  assets: Assets,
): Promise<Result<void>> {
  const database = storage.close();
  const blobs = assets.close();
  if (!database.ok)
    return failure('unavailable', database.error.path, database.error.message, database.error);
  if (!blobs.ok) return failure('unavailable', blobs.error.path, blobs.error.message, blobs.error);
  return { ok: true, value: undefined };
}
/** Asset opening precedes canonical storage; failed database opening releases the already-open byte owner. */
function open(
  options: WorkspaceOptions,
  factories: StoreOpeners,
): Result<OpenStores> {
  const assets = factories.assets(join(options.directory, 'assets'));
  if (!assets.ok)
    return failure('unavailable', assets.error.path, assets.error.message, assets.error);
  return openDatabase(options, factories, assets.value);
}
/** No direct record writes occur during physical opening; Authoring performs initialization after all owners are ready. */
function openDatabase(
  options: WorkspaceOptions,
  factories: StoreOpeners,
  assets: Assets,
): Result<OpenStores> {
  const storage = factories.storage(join(options.directory, 'workspace.sqlite'), options.workspace);
  if (!storage.ok) {
    assets.close();
    return failure('unavailable', storage.error.path, storage.error.message, storage.error);
  }
  return {
    ok: true,
    value: { assets, storage: storage.value, close: () => close(storage.value, assets) },
  };
}
