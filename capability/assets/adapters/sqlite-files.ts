import { digest } from '../contract/brands.js';
import type { Digest } from '../contract/brands.js';
import { fail, StorageFault } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import type { AssetStorage, AssetTransaction } from '../contract/ports/storage.js';
import type { AssetDatabase, BlobFiles, AssetStatement } from '../contract/ports/native.js';
import type { StoredBlob } from '../contract/records/media.js';

/**
 * Creates the durable asset store: blob metadata and leases in one SQLite table
 * (`asset_metadata`, key/value JSON rows), and blob bytes in immutable files. It depends on no
 * other capability's storage.
 *
 * Opening, in one `BEGIN IMMEDIATE` transaction (after WAL mode, full sync and a 5 s busy
 * timeout are set): create the table with `schema` = 1 only if the table does not exist, prepare
 * the statements, and require `schema` to be exactly 1 (`corrupt-asset` at `schema`, "Unsupported
 * asset metadata schema"). An existing damaged store is never repaired. On failure it tries to
 * close the database; if that close fails, the failure is ignored and the database may stay open.
 *
 * Each `transact` runs in `BEGIN IMMEDIATE`, which serializes acquire, reserved staging and
 * collection across connections. A successful result commits; a failed result rolls back. A
 * throw rolls back and becomes a failure: a `StorageFault` keeps its code, path and message;
 * anything else is `storage-unavailable` at `$`, "Asset storage operation could not be
 * confirmed". A rollback that itself fails is `storage-unavailable`, "Metadata rollback
 * unconfirmed; re-read files and leases". Blob files are not rolled back. Exception: if checking
 * the thrown value itself throws (for example a thrown Proxy whose traps throw), that throw
 * escapes `transact` with no ROLLBACK; the transaction stays open until the next `transact`,
 * whose `BEGIN IMMEDIATE` fails with `storage-unavailable` and clears it. The same applies to
 * `close`: if `database.close` throws such a value, `close` throws. When opening fails, the check
 * can throw from the opening error or from the attempted close; the database may then be open or
 * closed.
 *
 * Inside a transaction:
 * - blobs are keyed `blob:<digest>` (the descriptor) plus the file; a blob whose descriptor or file
 *   is missing reads as `null`; bytes are written before the descriptor;
 * - `listBlobs` returns the sorted union of recorded digests and file digests, so orphan files
 *   are collected too; a malformed key throws;
 * - leases are keyed `lease:<id>`; writing replaces;
 * - stored values that are not strings or not JSON throw `corrupt-asset` at `metadata`;
 * - every `transact` receives the same view object. It is not frozen, so an action that replaces
 *   one of its members changes it for every later transaction.
 *
 * @param database - The opened database.
 * @param files - The blob file store.
 * @returns The storage, or the opening failure.
 * @throws Only when checking a thrown value itself throws (see above), from opening, `transact`
 * or `close`. Otherwise never.
 */
export function createSqliteFiles(
  database: AssetDatabase,
  files: BlobFiles,
): Result<AssetStorage> {
  try {
    const prepared = initialize(database);
    const view = createView(prepared, files);
    return {
      ok: true,
      value: {
        transact: (action) => transact(database, view, action),
        close: () => close(database),
      },
    };
  } catch (error) {
    close(database);
    return failed(error);
  }
}

/** The four prepared statements on the metadata table. */
interface Statements {
  readonly read: Pick<AssetStatement, 'get'>;
  readonly write: Pick<AssetStatement, 'run'>;
  readonly remove: Pick<AssetStatement, 'run'>;
  readonly list: Pick<AssetStatement, 'all'>;
}

/** Prepares the read, upsert, delete and prefix-list statements. Rows are never cast to domain types. */
function statements(database: AssetDatabase): Statements {
  return {
    read: database.prepare('SELECT value FROM asset_metadata WHERE key=?'),
    write: database.prepare(
      'INSERT INTO asset_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ),
    remove: database.prepare('DELETE FROM asset_metadata WHERE key=?'),
    list: database.prepare('SELECT key,value FROM asset_metadata WHERE key LIKE ? ORDER BY key'),
  };
}

/** Reads and decodes one metadata value, or returns `null` when the key has no row. */
function readMetadata(
  key: string,
  read: Pick<AssetStatement, 'get'>,
): unknown | null {
  const row = read.get(key);
  if (!row) {
    return null;
  }
  return decodeValue(row.value);
}

/** Decodes a stored JSON string. Corruption throws; it is never reset or replaced with an empty value. */
function decodeValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    throw new StorageFault('corrupt-asset', 'metadata', 'Expected encoded metadata');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new StorageFault('corrupt-asset', 'metadata', 'Malformed stored JSON');
  }
}

/** Reads a blob's descriptor and bytes; `null` when either is missing (for example after a crash). */
function readBlob(
  id: Digest,
  read: Pick<AssetStatement, 'get'>,
  files: Pick<BlobFiles, 'read'>,
): unknown | null {
  const descriptor = readMetadata(`blob:${id}`, read);
  if (descriptor === null) {
    return null;
  }
  const base64 = files.read(id);
  if (base64 === null) {
    return null;
  }
  return { descriptor, base64 };
}

/** Writes the file first, then the descriptor; a failed commit can only leave a harmless orphan file. */
function writeBlob(
  blob: StoredBlob,
  write: Pick<AssetStatement, 'run'>,
  files: Pick<BlobFiles, 'write'>,
): void {
  files.write(blob.descriptor.digest, blob.base64);
  write.run(`blob:${blob.descriptor.digest}`, JSON.stringify(blob.descriptor));
}

/** The sorted union of recorded blob digests and file digests, so orphan files are collected too. */
function blobIds(
  list: Pick<AssetStatement, 'all'>,
  files: Pick<BlobFiles, 'list'>,
): readonly Digest[] {
  const rows = list.all('blob:%');
  const recorded = rows.map((row) => readDigestKey(row.key));
  const union = new Set([...recorded, ...files.list()]);
  return [...union].sort();
}

/** Reads the digest from a `blob:` key. A malformed key throws, so it never becomes a file path. */
function readDigestKey(key: unknown): Digest {
  if (typeof key !== 'string') {
    throw new StorageFault('corrupt-asset', 'key', 'Invalid blob metadata identity');
  }
  return digest.parse(key.slice(5));
}

/**
 * Builds the transaction view over the prepared statements and the blob files. One view object is
 * built per storage and shared by every transaction; it is not frozen.
 */
function createView(
  prepared: Statements,
  files: BlobFiles,
): AssetTransaction {
  return {
    readBlob: (id) => readBlob(id, prepared.read, files),
    writeBlob: (blob) => writeBlob(blob, prepared.write, files),
    listBlobs: () => blobIds(prepared.list, files),
    deleteBlob: (id) => {
      files.remove(id);
      prepared.remove.run(`blob:${id}`);
    },
    readLease: (id) => readMetadata(`lease:${id}`, prepared.read),
    writeLease: (lease) => {
      prepared.write.run(`lease:${lease.id}`, JSON.stringify(lease));
    },
    listLeases: () => prepared.list.all('lease:%').map((row) => decodeValue(row.value)),
    deleteLease: (id) => {
      prepared.remove.run(`lease:${id}`);
    },
  };
}

/** Turns a throw into a failure: a `StorageFault` keeps its fields; anything else is `storage-unavailable`. */
function failed<T>(error: unknown): Result<T> {
  if (error instanceof StorageFault) {
    return fail(error.code, error.path, error.message);
  }
  return fail('storage-unavailable', '$', 'Asset storage operation could not be confirmed');
}

/** Rolls back and returns `outcome`; a failed rollback is reported instead. Deleted files stay deleted. */
function rollback<T>(
  database: AssetDatabase,
  outcome: Result<T>,
): Result<T> {
  try {
    database.exec('ROLLBACK');
    return outcome;
  } catch {
    return fail(
      'storage-unavailable',
      '$',
      'Metadata rollback unconfirmed; re-read files and leases',
    );
  }
}

/** Commits a success; rolls back a failure. */
function settle<T>(
  database: AssetDatabase,
  result: Result<T>,
): Result<T> {
  if (!result.ok) {
    return rollback(database, result);
  }
  database.exec('COMMIT');
  return result;
}

/** Runs the action in `BEGIN IMMEDIATE`, then commits or rolls back; a throw rolls back. */
function transact<T>(
  database: AssetDatabase,
  view: AssetTransaction,
  action: (view: AssetTransaction) => Result<T>,
): Result<T> {
  try {
    database.exec('BEGIN IMMEDIATE');
    return settle(database, action(view));
  } catch (error) {
    return rollback(database, failed(error));
  }
}

/**
 * Closes the database; a throw becomes a failure (unless checking the thrown value itself throws,
 * which escapes). Later operations then fail as storage failures.
 */
function close(database: AssetDatabase): Result<void> {
  try {
    database.close();
    return { ok: true, value: undefined };
  } catch (error) {
    return failed(error);
  }
}

/** Creates the metadata table with `schema` = 1, only when the table does not exist yet. */
function createSchema(database: AssetDatabase): void {
  const lookup = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='asset_metadata'",
  );
  if (lookup.get()) {
    return;
  }
  database.exec('CREATE TABLE asset_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = database.prepare('INSERT INTO asset_metadata(key,value) VALUES(?,?)');
  insert.run('schema', '1');
}

/** Sets the pragmas, then in one transaction creates the table if needed and requires schema 1. */
function initialize(database: AssetDatabase): Statements {
  database.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE',
  );
  createSchema(database);
  const prepared = statements(database);
  if (readMetadata('schema', prepared.read) !== 1) {
    throw new StorageFault('corrupt-asset', 'schema', 'Unsupported asset metadata schema');
  }
  database.exec('COMMIT');
  return prepared;
}
