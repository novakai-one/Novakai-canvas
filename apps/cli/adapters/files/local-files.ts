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
/**
 * The file's text, decoded as strict UTF-8, before any service request. Fails with
 * `source-too-large` (over 16 MiB) or `source-unavailable` (cannot be opened, or is not UTF-8).
 */
async function readSource(file: FilePath): Promise<Result<string, LocalFailure>> {
  try {
    const bytes = await readFile(file);
    if (bytes.byteLength > sourceByteLimit)
      return failure({ code: 'source-too-large', message: 'DSL source exceeds 16 MiB' });
    return success(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return unreadableSourceFailure(file);
  }
}
/**
 * Writes `text` to the explicit --out destination after the command ran. Never changes service
 * data. Fails with `output-unavailable`.
 */
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
