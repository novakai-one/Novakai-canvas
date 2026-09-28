import type {
  BlobFiles,
  Result,
  AssetStorage,
  IdentityPort,
  MediaRegistry,
} from '../contract/index.js';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { onTestFinished } from 'vitest';
import { createAssets } from '../contract/index.js';
import type { Assets, AssetDependencies, Digest, AssetDatabase } from '../contract/index.js';
import { createSqliteFiles } from '../adapters/sqlite-files.js';
import { createBlobFiles } from '../adapters/files.js';
import { createIdentity } from '../adapters/identity.js';
import { createRaster } from '../adapters/raster.js';
import { createSvg } from '../adapters/svg.js';
import { createFont } from '../adapters/font.js';
import { detectMedia } from '../adapters/detect.js';
import { value } from './fixtures.js';

/** The native pieces a harness is built from and the file operations tests use to damage it. */
interface NativeFixture {
  /** Opens blob files under `root`. */
  readonly files: (root: string) => BlobFiles;
  /** Opens metadata storage over a database and blob files. */
  readonly storage: (database: AssetDatabase, files: BlobFiles) => Result<AssetStorage>;
  /** Creates the hasher and lease identity. */
  readonly identity: () => IdentityPort;
  /** Creates the media processors and detector. */
  readonly media: () => MediaRegistry;
  /** Creates a new temporary directory and returns its path. */
  readonly directory: () => string;
  /** Deletes a directory and everything in it. */
  readonly remove: (root: string) => void;
  /** Opens a database connection at `path`. */
  readonly database: (path: string) => AssetDatabase;
  /** Reads a file as base64. */
  readonly read: (path: URL) => string;
  /** Overwrites a file with other bytes. */
  readonly corrupt: (path: string) => void;
  /** Deletes a file. */
  readonly unlink: (path: string) => void;
}

/** A real Assets instance in its own temporary directory, plus ways to damage its storage. */
interface AssetHarness {
  /** The facade over real SQLite storage, blob files, hasher and media processors. */
  readonly assets: Assets;
  /** The dependencies `assets` was built from, for building variants. */
  readonly deps: AssetDependencies;
  /** The temporary directory. */
  readonly root: string;
  /** Reads the bundled Inter WOFF2 font as base64. */
  font(): string;
  /** Overwrites a blob's file with other bytes. */
  corrupt(id: Digest): void;
  /** Deletes a blob's file. */
  unlink(id: Digest): void;
  /** Deletes the metadata schema row, through a separate connection. */
  removeSchema(): void;
}

/**
 * Builds a real Assets instance in a new temporary directory: blob files at `root/blobs` and the
 * database at `root/assets.sqlite`. When the test finishes, storage is closed and the directory
 * removed.
 *
 * Setup order: create the directory and register its removal, open blob files, open the database
 * and storage, then register `close`. If a step after the first throws or fails, `close` is never
 * registered; the directory is still removed. When `io.storage` fails, the harness does not close
 * the database it passed in (the real `createSqliteFiles` closes it itself; an injected one might
 * not).
 *
 * @param io - The native pieces. Defaults to the real adapters and `node:fs`.
 * @returns The harness.
 * @throws Whatever `io.directory`, `io.files`, `io.database`, `io.storage`, `io.identity` or
 * `io.media` throws, and Vitest's assertion error when opening storage fails (from `value`). Vitest
 * reports each as the test's failure and still runs the cleanup registered so far.
 */
export function harness(io: NativeFixture = native): AssetHarness {
  const root = io.directory();
  // Registered first, so the directory is removed even when a later step fails.
  onTestFinished(() => io.remove(root));
  const files = io.files(join(root, 'blobs'));
  const storage = value(io.storage(io.database(join(root, 'assets.sqlite')), files));
  // Closes storage (and its database connection) when the test finishes.
  onTestFinished(() => {
    storage.close();
  });
  const deps: AssetDependencies = {
    storage,
    identity: io.identity(),
    media: io.media(),
  };
  return {
    assets: createAssets(deps),
    deps,
    root,
    // The members below are documented on `AssetHarness`.
    font: () =>
      io.read(new URL('../../../resources/fonts/inter-latin-400-normal.woff2', import.meta.url)),
    corrupt: (id) => io.corrupt(join(root, 'blobs', `${id}.blob`)),
    unlink: (id) => io.unlink(join(root, 'blobs', `${id}.blob`)),
    removeSchema: () => removeSchema(io.database(join(root, 'assets.sqlite'))),
  };
}

/** The real adapters and `node:fs` operations. */
const native: NativeFixture = {
  // Each member is documented on `NativeFixture`.
  files: createBlobFiles,
  storage: createSqliteFiles,
  identity: createIdentity,
  media: () => ({ handlers: [createRaster(), createSvg(), createFont()], detect: detectMedia }),
  directory: () => mkdtempSync(join(tmpdir(), 'canvas-assets-')),
  remove: (root) => rmSync(root, { recursive: true, force: true }),
  database: (path) => new DatabaseSync(path),
  read: (path) => readFileSync(path).toString('base64'),
  corrupt: (path) => writeFileSync(path, 'corrupt bytes'),
  unlink: unlinkSync,
};

/** Deletes the schema row; the connection is closed even when that fails. */
function removeSchema(database: AssetDatabase): void {
  try {
    database.exec("DELETE FROM asset_metadata WHERE key='schema'");
  } finally {
    database.close();
  }
}
