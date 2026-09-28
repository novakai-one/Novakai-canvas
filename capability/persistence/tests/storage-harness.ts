import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { onTestFinished } from 'vitest';
import { openSqlite, createPersistence } from '../contract/index.js';
import type { Result, Persistence, DatabasePort } from '../contract/index.js';
import { createSqliteStore } from '../adapters/sqlite.js';
import { workspace, pristine, value } from './fixtures.js';

/**
 * Opens a real SQLite Persistence service in its own temporary directory.
 *
 * Cleanup is registered with Vitest and runs when the test finishes, even after a failed
 * assertion: the service is closed (its result ignored) and the directory removed. Cleanup is
 * attempted, not guaranteed. Vitest owns setup, assertion and teardown failures.
 *
 * @param mode - `memory` for `:memory:`, or `file` for a database file in the directory.
 * @param environment - Creates and removes the directory. Defaults to the real file system.
 * @param open - Opens the service. Defaults to `openSqlite`.
 * @returns The service, its location, and `remove` to delete the directory early.
 * @throws Vitest's `AssertionError` when the service does not open; any error from creating the
 * directory.
 */
export function harness(
  mode: 'memory' | 'file',
  environment: FileEnvironment = files,
  open: typeof openSqlite = openSqlite,
): { readonly persistence: Persistence; readonly location: string; remove(): void } {
  const directory = environment.createDirectory();
  onTestFinished(() => environment.removeDirectory(directory));
  const location = mode === 'memory' ? ':memory:' : join(directory, 'workspace.sqlite');
  const persistence = value(open(location, workspace));
  onTestFinished(() => {
    persistence.close();
  });
  return { persistence, location, remove: () => environment.removeDirectory(directory) };
}

/**
 * A Persistence service over a simple one-table SQL store that throws at one chosen point.
 *
 * The store has no item rows and no data version, so every transaction reads the whole envelope.
 * The adapter must turn the injected throw into a typed failure.
 *
 * @param fault - Where to throw: `read`, `write`, `commit` (instead of COMMIT), `after-commit`
 * (after COMMIT succeeded, as if the acknowledgement were lost), or `none`.
 * @param raw - The initial stored envelope. Defaults to an empty workspace.
 * @param open - Opens the native database. Defaults to an in-memory `DatabaseSync`.
 * @returns The service, `inspect` to read the stored envelope directly, and `close`. The database
 * is also closed at test end; a failed close there is ignored.
 * @throws Any error from opening or initializing the native database. `inspect` throws when the
 * stored text is not JSON.
 */
export function faultStore(
  fault: Fault,
  raw: unknown = pristine(),
  open: () => TestDatabase = () => new DatabaseSync(':memory:'),
): { readonly persistence: Persistence; inspect(): unknown; close(): void } {
  const database = open();
  onTestFinished(() => {
    closeFixture(database);
  });
  const driver = initializeDriver(database, raw);
  const faulted: DatabasePort = {
    exec: (sql) => executeFault(driver, fault, sql),
    read: () => failAt(fault, 'read', driver.read),
    write: (serialized) => {
      failAt(fault, 'write', () => driver.write(serialized));
    },
    close: driver.close,
  };
  return {
    persistence: createPersistence(createSqliteStore(faulted, workspace), workspace),
    inspect: () => JSON.parse(String(driver.read())),
    close: driver.close,
  };
}

/** Creates and removes a temporary directory. */
interface FileEnvironment {
  createDirectory(): string;
  removeDirectory(directory: string): void;
}

/** The part of a native SQLite database the fault store uses. */
interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(): Readonly<Record<string, unknown>> | undefined;
    run(value: string): unknown;
  };
  close(): void;
}

/** Where {@link faultStore} throws. */
type Fault = 'read' | 'write' | 'commit' | 'after-commit' | 'none';

/** The real file system, under the OS temporary directory. */
const files: FileEnvironment = {
  createDirectory: () => mkdtempSync(join(tmpdir(), 'canvas-persistence-')),
  removeDirectory: (directory) => rmSync(directory, { recursive: true, force: true }),
};

/** Creates the one-table store holding `raw`, and wraps its prepared statements as a port. */
function initializeDriver(
  database: TestDatabase,
  raw: unknown,
): DatabasePort {
  database.exec('CREATE TABLE data(payload TEXT)');
  const initialize = database.prepare('INSERT INTO data VALUES(?)');
  initialize.run(JSON.stringify(raw));
  const read = database.prepare('SELECT payload FROM data');
  const write = database.prepare('UPDATE data SET payload=?');
  return {
    exec: (sql) => database.exec(sql),
    read: () => read.get()?.payload,
    write: (serialized) => {
      write.run(serialized);
    },
    close: () => database.close(),
  };
}

/**
 * Closes the fixture database at test end. The test may already have closed it, so a failed close
 * is returned, not thrown.
 */
function closeFixture(database: TestDatabase): Result<void> {
  try {
    database.close();
    return { ok: true, value: undefined };
  } catch {
    return {
      ok: false,
      error: {
        code: 'storage-unavailable',
        path: 'fixture',
        message: 'Already closed or cleanup failed',
        recovery: 'Vitest releases the isolated temporary location',
      },
    };
  }
}

/**
 * Runs a transaction command with the fault applied. With `commit`, COMMIT throws instead of
 * running; with `after-commit`, it runs and then throws; with any other fault it runs normally.
 * Other commands always run.
 */
function executeFault(
  driver: DatabasePort,
  fault: Fault,
  sql: Parameters<DatabasePort['exec']>[0],
): void {
  if (sql !== 'COMMIT') {
    driver.exec(sql);
    return;
  }
  failAt(fault, 'commit', () => driver.exec(sql));
  failAt(fault, 'after-commit', () => undefined);
}

/** Throws the injected driver failure when `actual` is `target`; otherwise runs `action`. */
function failAt<T>(
  actual: Fault,
  target: Fault,
  action: () => T,
): T {
  if (actual === target) {
    throw new Error('Injected driver failure');
  }
  return action();
}
