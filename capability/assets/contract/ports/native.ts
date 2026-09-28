import type { Digest } from '../brands.js';

/**
 * The SQLite database the storage adapter uses (a subset of `node:sqlite`'s `DatabaseSync`). Only
 * the composition root and the adapters see it; core sees only `AssetStorage`. Its methods throw
 * native errors, which the storage adapter turns into failures.
 */
export interface AssetDatabase {
  /**
   * Runs one or more SQL statements.
   *
   * @param sql - The statements.
   * @throws The native error when a statement fails.
   */
  exec(sql: string): void;
  /**
   * Prepares one SQL statement.
   *
   * @param sql - The statement, with `?` parameters.
   * @returns The prepared statement.
   * @throws The native error when the statement is invalid.
   */
  prepare(sql: string): AssetStatement;
  /**
   * Closes the database.
   *
   * @throws The native error when closing fails (for example when already closed).
   */
  close(): void;
}

/** A prepared SQL statement with string parameters. */
export interface AssetStatement {
  /**
   * Runs the statement and returns its first row.
   *
   * @param values - The parameter values, in order.
   * @returns The first row (column name → unchecked value), or `undefined` when there is none.
   * @throws The native error when the statement fails.
   */
  get(...values: readonly string[]): Readonly<Record<string, unknown>> | undefined;
  /**
   * Runs the statement and returns every row.
   *
   * @param values - The parameter values, in order.
   * @returns Every row, in result order.
   * @throws The native error when the statement fails.
   */
  all(...values: readonly string[]): readonly Readonly<Record<string, unknown>>[];
  /**
   * Runs the statement for its effect.
   *
   * @param values - The parameter values, in order.
   * @returns The driver's run summary (not used).
   * @throws The native error when the statement fails.
   */
  run(...values: readonly string[]): unknown;
}

/**
 * The content-addressed blob files: one immutable file per digest. The storage adapter catches
 * what these methods throw (native errors, or a `StorageFault` carrying a failure code).
 */
export interface BlobFiles {
  /**
   * Reads a digest's bytes.
   *
   * @param digest - The digest.
   * @returns The bytes as base64, or `null` when the file does not exist.
   * @throws The native error for any other read failure.
   */
  read(digest: Digest): string | null;
  /**
   * Writes a digest's bytes durably. Existing identical bytes are kept as they are.
   *
   * @param digest - The digest.
   * @param base64 - The bytes, base64 encoded.
   * @throws A `StorageFault` `corrupt-asset` when different bytes already exist at the digest, or
   * the native error for a write failure.
   */
  write(
    digest: Digest,
    base64: string,
  ): void;
  /**
   * Removes a digest's file. Removing a missing file is not an error.
   *
   * @param digest - The digest.
   * @throws The native error for any other removal failure.
   */
  remove(digest: Digest): void;
  /**
   * Lists the digests that have files.
   *
   * @returns The digests.
   * @throws The native error when the directory cannot be listed.
   */
  list(): readonly Digest[];
}
