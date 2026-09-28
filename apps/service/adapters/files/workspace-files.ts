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
/** Explicit host lifecycle creates only directories/native handles; malformed paths never trigger deletion or replacement. */
export async function openWorkspaceFiles(
  options: WorkspaceOptions,
  factories: StoreOpeners,
): Promise<Result<OpenStores>> {
  try {
    await mkdir(join(options.directory, 'assets'), { recursive: true });
    return open(options, factories);
  } catch {
    return failure('unavailable', 'workspace', 'Workspace files could not be opened');
  }
}
