import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createBlobFiles } from '../adapters/files.js';
import { createSqliteFiles } from '../adapters/sqlite-files.js';
import { createIdentity } from '../adapters/identity.js';
import { createRaster } from '../adapters/raster.js';
import { createSvg } from '../adapters/svg.js';
import { createFont } from '../adapters/font.js';
import { detectMedia } from '../adapters/detect.js';
import { createAssets } from './api.js';
import { success } from '../core/validation/outcomes.js';
import { fail } from './errors.js';
import type { Result } from './errors.js';
import type { Assets } from './types.js';
import type { AssetDatabase, BlobFiles } from './ports/native.js';

/** Opens the native file store and database. Tests replace them to simulate open failures. */
interface NativeFactories {
  /** Opens the blob file store rooted at a directory. */
  readonly files: (root: string) => BlobFiles;
  /** Opens the SQLite database at a file path. */
  readonly database: (location: string) => AssetDatabase;
}

/**
 * Opens Assets on disk at `root` and wires it to the built-in hasher and media processors
 * (raster, SVG, font). Nothing is opened until the host calls this; `createAssets` alone does no
 * I/O.
 *
 * Steps, in order: open the blob files at `root/blobs`, open the database at
 * `root/assets.sqlite`, then prepare the storage (which may create the metadata table).
 *
 * @param root - The asset directory.
 * @param factories - How to open the file store and database. Defaults to the real ones.
 * @returns A new, unfrozen success holding the frozen {@link Assets} facade. Fails with the storage's own failure when preparing
 * the storage fails (for example `corrupt-asset` for an unsupported schema), or
 * `storage-unavailable` when anything throws, such as a factory that cannot open its location.
 * On `storage-unavailable`, keep the original files and retry opening.
 * @throws Never.
 */
export function openAssets(
  root: string,
  factories: NativeFactories = native,
): Result<Assets> {
  try {
    const files = factories.files(join(root, 'blobs'));
    const store = createSqliteFiles(factories.database(join(root, 'assets.sqlite')), files);
    if (!store.ok) {
      return store;
    }
    return success(
      createAssets({
        storage: store.value,
        identity: createIdentity(),
        media: { handlers: [createRaster(), createSvg(), createFont()], detect: detectMedia },
      }),
    );
  } catch {
    return fail(
      'storage-unavailable',
      '$',
      'Asset location could not be opened; retain original files',
    );
  }
}

/** The real factories: a blob file store and a `node:sqlite` database. */
const native: NativeFactories = {
  files: createBlobFiles,
  database: (location) => new DatabaseSync(location),
};
