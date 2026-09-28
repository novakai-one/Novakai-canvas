import { DatabaseSync } from 'node:sqlite';
import { createSqliteStore } from '../adapters/sqlite.js';
import { createPersistence } from './api.js';
import { workspaceId } from './brands.js';
import { fail } from './errors.js';
import type { Result } from './errors.js';
import type { DatabasePort } from './ports/database.js';
import type { Persistence } from './types.js';

/**
 * Opens (or creates) a SQLite workspace database and returns its Persistence service.
 *
 * Needs Node 24.13 or later (`node:sqlite`). A file location uses WAL journaling with FULL
 * sync; `':memory:'` selects an ephemeral database that does not survive close.
 *
 * Steps, in order:
 * 1. Open the database. A failure to open is `storage-unavailable` and leaves the location as it
 *    was.
 * 2. Check the workspace ID. An invalid ID closes the database and fails with `invalid-input`.
 * 3. Create the tables if missing and prepare the statements.
 * 4. Read and validate the stored state. A failure closes the service and is returned (for
 *    example `corrupt-record` or `unsupported-version`).
 * 5. Any throw during steps 2–4 closes the database: `storage-unavailable`
 *    (`Database initialization failed`, or `Database initialization and cleanup failed` when the
 *    close also throws). No live connection is left unreachable.
 *
 * @param location - The database file path, or `':memory:'`.
 * @param workspace - The workspace ID the database belongs to; checked here.
 * @param openDatabase - Opens the native database. Defaults to `node:sqlite`'s `DatabaseSync`.
 * A fake can be passed to exercise the failure paths without the file system; no repo test does
 * this yet.
 * @returns The Persistence service, or the first failure.
 */
export function openSqlite(
  location: string,
  workspace: unknown,
  openDatabase: (location: string) => NativeDatabase = (location) => new DatabaseSync(location),
): Result<Persistence> {
  try {
    return initialize(openDatabase(location), workspace);
  } catch {
    return fail(
      'storage-unavailable',
      '$',
      'Database could not be opened; retain original location',
    );
  }
}

/** The part of a native SQLite database this module uses; a fake can stand in for tests. */
export interface NativeDatabase {
  /** Runs SQL that returns no rows (pragmas, table setup, transaction commands). */
  exec(sql: string): void;
  /** Compiles one SQL statement for repeated use. */
  prepare(sql: string): {
    /** Runs the statement with the given parameters and returns its first row, if any. */
    get(...values: string[]): Readonly<Record<string, unknown>> | undefined;
    /** Runs the statement with the given parameters for its effect only. */
    run(...values: string[]): unknown;
  };
  /** Closes the connection. */
  close(): void;
}

/**
 * Pragmas and tables, run once on open. SQLite owns WAL/FULL crash recovery; there is no
 * hand-written file journaling.
 */
const SCHEMA_SQL = [
  'PRAGMA journal_mode=WAL;',
  'PRAGMA synchronous=FULL;',
  'PRAGMA busy_timeout=5000;',
  'CREATE TABLE IF NOT EXISTS canvas_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS canvas_part (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
].join(' ');

/** Runs initialization; on any throw, closes the database and returns a typed open failure. */
function initialize(
  database: NativeDatabase,
  workspace: unknown,
): Result<Persistence> {
  try {
    return initializeChecked(database, workspace);
  } catch {
    return closeFailedOpen(database);
  }
}

/**
 * Checks the workspace ID, builds the service and validates the stored state before returning
 * it. A failed check closes what was opened.
 */
function initializeChecked(
  database: NativeDatabase,
  workspace: unknown,
): Result<Persistence> {
  const identity = workspaceId.safeParse(workspace);
  if (!identity.success) {
    database.close();
    return fail('invalid-input', 'workspace', 'Invalid workspace identity');
  }
  const persistence = createPersistence(
    createSqliteStore(createDriver(database), identity.data),
    identity.data,
  );
  const checked = persistence.readSnapshot();
  if (!checked.ok) {
    persistence.close();
    return checked;
  }
  return { ok: true, value: persistence };
}

/**
 * Closes a database whose initialization failed, so the opener never keeps an unreachable live
 * connection. A failed close is still reported as a typed open failure.
 */
function closeFailedOpen(database: NativeDatabase): Result<Persistence> {
  try {
    database.close();
  } catch {
    return fail('storage-unavailable', '$', 'Database initialization and cleanup failed');
  }
  return fail('storage-unavailable', '$', 'Database initialization failed');
}

/** Creates the tables, prepares every statement once, and wraps them as the database port. */
function createDriver(database: NativeDatabase): DatabasePort {
  database.exec(SCHEMA_SQL);
  const read = database.prepare('SELECT payload FROM canvas_state WHERE singleton=1');
  const write = database.prepare(
    'INSERT INTO canvas_state(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload',
  );
  const dataVersion = database.prepare('PRAGMA data_version');
  const getPart = database.prepare('SELECT body FROM canvas_part WHERE id=?');
  const putPart = database.prepare('INSERT OR REPLACE INTO canvas_part(id,body) VALUES(?,?)');
  const removePart = database.prepare('DELETE FROM canvas_part WHERE id=?');
  return {
    /** Runs a transaction command such as `BEGIN IMMEDIATE`. */
    exec: (sql) => database.exec(sql),
    /** The stored envelope text, or `undefined` when there is no row yet. */
    read: () => read.get()?.payload,
    /** SQLite's data version; it changes only when another connection commits. */
    version: () => dataVersion.get()?.data_version,
    /** Inserts or replaces the stored envelope text. */
    write: (serialized) => {
      write.run(serialized);
    },
    parts: {
      /** One item row's text, or `undefined` when the row is missing or not text. */
      get: (id) => {
        const body = getPart.get(id)?.body;
        return typeof body === 'string' ? body : undefined;
      },
      /** Writes one item row. */
      put: (id, body) => {
        putPart.run(id, body);
      },
      /** Deletes one item row. */
      remove: (id) => {
        removePart.run(id);
      },
    },
    /** Closes the native database. */
    close: () => database.close(),
  };
}
