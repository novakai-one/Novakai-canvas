/**
 * The prepared SQLite driver the adapter uses. Only trusted adapter code passes SQL, and only
 * transaction commands.
 *
 * Every method may throw. The SQLite adapter catches every throw: `transact` turns it into
 * `storage-unavailable` after attempting a rollback (a decode throw, including a `parts.get`
 * throw while decoding, is `corrupt-record`), and
 * `close` turns it into `storage-unavailable`. A throw at or after COMMIT leaves the outcome
 * uncertain; Authoring reopens and reconciles the request's receipt.
 */
export interface DatabasePort {
  /** Runs one transaction command. */
  exec(sql: TransactionCommand): void;
  /** The stored envelope (normally its text), or `undefined` when there is no row yet. */
  read(): unknown;
  /**
   * The database's data version. It changes only when another connection commits, so an unchanged
   * value means the last text this store read or wrote is still current. Optional: without it
   * every transaction reads again.
   */
  version?(): unknown;
  /** Stores the envelope text. */
  write(serialized: string): void;
  /**
   * Optional one-row-per-item storage. With it, the envelope lists item ids and a commit writes
   * only items not stored before.
   */
  readonly parts?: PartsPort;
  /** Closes the database. */
  close(): void;
}

/** The only SQL the adapter passes to {@link DatabasePort.exec}. */
export type TransactionCommand = 'BEGIN IMMEDIATE' | 'COMMIT' | 'ROLLBACK';

/** Item rows keyed by id. A row's text never changes once written; unused rows are removed. */
export interface PartsPort {
  /** One row's text, or `undefined` when there is no such row. */
  get(id: string): string | undefined;
  /** Writes a new row. */
  put(
    id: string,
    body: string,
  ): void;
  /** Removes a row. */
  remove(id: string): void;
}
