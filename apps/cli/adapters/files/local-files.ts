/*
 * Why this file exists
 *
 * `create my-diagram.canvas --out result.txt` reads the source from disk, then writes the answer
 * to `result.txt` instead of printing it. Core decides when each happens, but can't touch the disk.
 *
 * This file does that reading and writing with Node. A source must be UTF-8 text of at most
 * 16 MiB. It never touches the workspace folder. Mistakes come back as values, never thrown.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import {
  failure,
  success,
  unreadableSourceFailure,
  unwritableOutputFailure,
} from '../../contract/errors.js';
import type { FilePath } from '../../contract/brands.js';

/** The largest source file a command reads. */
const sourceByteLimit = 16 * 1024 * 1024;

/** Gives core its source file reader and `--out` file writer. Neither uses the workspace folder. */
export function createLocalFiles(): LocalFiles {
  return { readSource, writeOutput };
}

/** Reads the source file as UTF-8 text, refusing one over 16 MiB or one that isn't UTF-8. */
async function readSource(file: FilePath): Promise<Result<string, LocalFailure>> {
  const bytes = await readSourceBytes(file);
  if (!bytes.ok) {
    return bytes;
  }
  if (bytes.value.byteLength > sourceByteLimit) {
    return sourceTooLargeFailure();
  }
  return decodeStrictUtf8(file, bytes.value);
}

/** Reads the source file's bytes. */
async function readSourceBytes(file: FilePath): Promise<Result<Buffer, LocalFailure>> {
  try {
    const bytes = await readFile(file);
    return success(bytes);
  } catch {
    return unreadableSourceFailure(file);
  }
}

/** Decodes the source file's bytes as UTF-8, refusing any byte that isn't valid UTF-8. */
function decodeStrictUtf8(
  file: FilePath,
  bytes: Buffer,
): Result<string, LocalFailure> {
  try {
    const strictDecoder = new TextDecoder('utf-8', { fatal: true });
    const text = strictDecoder.decode(bytes);
    return success(text);
  } catch {
    return unreadableSourceFailure(file);
  }
}

/** Writes the answer's text to the `--out` file, after the command ran. */
async function writeOutput(
  path: FilePath,
  text: string,
): Promise<Result<void, LocalFailure>> {
  try {
    await writeFile(path, text, 'utf8');
    return success(undefined);
  } catch {
    return unwritableOutputFailure(path);
  }
}

/** Makes the mistake for a source file over 16 MiB (`source-too-large`). */
function sourceTooLargeFailure(): Result<never, LocalFailure> {
  return failure({ code: 'source-too-large', message: 'DSL source exceeds 16 MiB' });
}
