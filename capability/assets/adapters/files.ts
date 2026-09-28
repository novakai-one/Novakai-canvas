import {
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  linkSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../contract/brands.js';
import type { Digest } from '../contract/brands.js';
import { StorageFault } from '../contract/errors.js';
import type { BlobFiles } from '../contract/ports/native.js';

/** The file system calls the blob store uses, injectable so tests can simulate I/O failures. */
interface FileSystem {
  /** Reads a file as base64. */
  readonly read: (path: string) => string;
  /** Creates a new file for writing (fails if it exists) and returns its handle. */
  readonly open: (path: string) => number;
  /** Writes base64-decoded bytes to an open file. */
  readonly write: (handle: number, encoded: string) => void;
  /** Flushes an open file to disk. */
  readonly flush: (handle: number) => void;
  /** Closes an open file. */
  readonly close: (handle: number) => void;
  /** Links `source` at `target`; fails if `target` exists. */
  readonly publish: (source: string, target: string) => void;
  /** Deletes a file. */
  readonly remove: (path: string) => void;
  /** Lists a directory's entry names. */
  readonly list: (path: string) => readonly string[];
  /** Creates a directory and its parents. */
  readonly directory: (path: string) => void;
  /** Flushes a directory's entries to disk. */
  readonly flushDirectory: (path: string) => void;
}

/**
 * Creates the blob file store: one immutable file `<digest>.blob` per digest under `root`. It
 * creates `root` (and its parents) immediately. Native errors other than the expected ones
 * (`ENOENT` for a missing file, `EEXIST` for a publish collision) are thrown for the storage
 * transaction to turn into failures.
 *
 * - `read`: the file's bytes as base64, or `null` when it does not exist.
 * - `write`: if a file already exists, its bytes must equal the new ones (otherwise a
 *   `StorageFault` `corrupt-asset` at `digest`: "Existing content-addressed file differs from
 *   submitted bytes"). Otherwise it writes `<digest>.blob.<nonce>.tmp`, flushes and closes it,
 *   links it at the final name without replacing (a racing identical file is accepted, a
 *   different one refused as above), flushes the directory, and always removes the temporary
 *   file.
 * - `remove`: deletes the file; a missing file is not an error.
 * - `list`: removes leftover temporary files matching `<digest>.blob.<uuid>.tmp`, then returns
 *   the digests of `<digest>.blob` files. Other names are never touched. Removing temporary files
 *   is safe only while writers are serialized: the storage adapter calls `list` inside its
 *   `BEGIN IMMEDIATE` transaction.
 *
 * @param root - The blob directory.
 * @param io - The file system calls. Defaults to `node:fs` (new files are created with mode 0600).
 * @param nonce - Names temporary files. Defaults to `randomUUID`.
 * @returns The blob file store.
 * @throws Whatever creating `root` throws.
 */
export function createBlobFiles(
  root: string,
  io: FileSystem = native,
  nonce: () => string = randomUUID,
): BlobFiles {
  io.directory(root);
  return {
    read: (id) => readFile(join(root, `${id}.blob`), io),
    write: (id, encoded) => writeFile(root, id, encoded, io, nonce),
    remove: (id) => removeFile(join(root, `${id}.blob`), io),
    list: () => listFiles(root, io),
  };
}

/** The real `node:fs` calls. */
const native: FileSystem = {
  read: (path) => readFileSync(path).toString('base64'),
  open: (path) => openSync(path, 'wx', 0o600),
  write: (handle, encoded) => writeFileSync(handle, Buffer.from(encoded, 'base64')),
  flush: fsyncSync,
  close: closeSync,
  publish: linkSync,
  remove: unlinkSync,
  list: (path) => readdirSync(path),
  directory: (path) => {
    mkdirSync(path, { recursive: true });
  },
  flushDirectory: (path) => {
    const handle = openSync(path, 'r');
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  },
};

/** Reads a file, or returns `null` when it does not exist. Other errors are thrown. */
function readFile(
  path: string,
  io: Pick<FileSystem, 'read'>,
): string | null {
  try {
    return io.read(path);
  } catch (error) {
    return missingOrThrow(error);
  }
}

/** Tells whether an error has the given native `code`. The message is never parsed. */
function hasCode(
  error: unknown,
  code: string,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return 'code' in error && error.code === code;
}

/** Throws `corrupt-asset` unless the existing bytes equal the new ones; a digest's file never changes. */
function requireSame(
  previous: string | null,
  encoded: string,
): void {
  if (previous !== encoded) {
    throw new StorageFault(
      'corrupt-asset',
      'digest',
      'Existing content-addressed file differs from submitted bytes',
    );
  }
}

/** Writes, flushes and closes a new temporary file. It is closed even when writing fails. */
function writeTemporary(
  path: string,
  encoded: string,
  io: Pick<FileSystem, 'open' | 'write' | 'flush' | 'close'>,
): void {
  const handle = io.open(path);
  try {
    io.write(handle, encoded);
    io.flush(handle);
  } finally {
    io.close(handle);
  }
}

/** Deletes a file; a missing file is not an error, so cleanup can run twice. */
function removeFile(
  path: string,
  io: Pick<FileSystem, 'remove'>,
): void {
  try {
    io.remove(path);
  } catch (error) {
    ignoreMissing(error);
  }
}

/** Links the temporary file at its final name without replacing an existing file. */
function publishFile(
  temporary: string,
  destination: string,
  encoded: string,
  io: Pick<FileSystem, 'publish' | 'read'>,
): void {
  try {
    io.publish(temporary, destination);
  } catch (error) {
    resolveCollision(error, destination, encoded, io);
  }
}

/**
 * Writes the temporary file, publishes it, and flushes the directory, all before the caller's
 * metadata transaction can commit. The temporary file is always removed.
 */
function persistFile(
  root: string,
  destination: string,
  encoded: string,
  io: FileSystem,
  nonce: () => string,
): void {
  const temporary = `${destination}.${nonce()}.tmp`;
  try {
    writeTemporary(temporary, encoded, io);
    publishFile(temporary, destination, encoded, io);
    io.flushDirectory(root);
  } finally {
    removeFile(temporary, io);
  }
}

/**
 * Writes a digest's file, or checks the existing one (which may be an orphan left by an earlier
 * rollback) has the same bytes.
 */
function writeFile(
  root: string,
  id: Digest,
  encoded: string,
  io: FileSystem,
  nonce: () => string,
): void {
  const destination = join(root, `${id}.blob`);
  const previous = readFile(destination, io);
  if (previous !== null) {
    requireSame(previous, encoded);
    return;
  }
  persistFile(root, destination, encoded, io, nonce);
}

/**
 * Removes leftover temporary files; only names in the exact temporary-file pattern are touched.
 * The caller must hold the storage write lock, so no writer's temporary file is in use.
 */
function cleanupTemporary(
  root: string,
  names: readonly string[],
  io: Pick<FileSystem, 'remove'>,
): void {
  names
    .filter((name) => /^[a-f0-9]{64}\.blob\.[a-f0-9-]{36}\.tmp$/.test(name))
    .forEach((name) => removeFile(join(root, name), io));
}

/** Cleans up temporary files, then lists the digests of blob files. Other names are ignored. */
function listFiles(
  root: string,
  io: Pick<FileSystem, 'list' | 'remove'>,
): readonly Digest[] {
  const names = io.list(root);
  cleanupTemporary(root, names, io);
  return names
    .filter((name) => /^[a-f0-9]{64}\.blob$/.test(name))
    .map((name) => digest.parse(name.slice(0, -5)));
}

/** Returns `null` for `ENOENT`; throws any other error. */
function missingOrThrow(error: unknown): null {
  if (hasCode(error, 'ENOENT')) {
    return null;
  }
  throw error;
}

/** Ignores `ENOENT`; throws any other error. */
function ignoreMissing(error: unknown): void {
  if (!hasCode(error, 'ENOENT')) {
    throw error;
  }
}

/** On `EEXIST`, accepts an identical racing file and refuses a different one; throws other errors. */
function resolveCollision(
  error: unknown,
  destination: string,
  encoded: string,
  io: Pick<FileSystem, 'read'>,
): void {
  if (!hasCode(error, 'EEXIST')) {
    throw error;
  }
  requireSame(readFile(destination, io), encoded);
}
