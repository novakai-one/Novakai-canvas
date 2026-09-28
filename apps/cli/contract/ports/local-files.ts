/*
 * Why this file exists
 *
 * Some commands read a file the agent names, and any command can write its answer to a file.
 * `create my-diagram.canvas --out result.txt` reads the source, then writes the answer to
 * `result.txt` instead of printing it.
 *
 * This file names those two file steps, so core can ask for them without touching the disk.
 * `adapters/files/local-files.ts` does the reading and writing.
 */
import type { FilePath } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';

/** Reads a source file and writes the `--out` file. */
export interface LocalFiles {
  /**
   * Reads a source file's text, before anything is sent. Fails with `source-too-large` (over
   * 16 MiB) or `source-unavailable` (missing, or not UTF-8 text).
   */
  readSource(path: FilePath): Promise<Result<string, LocalFailure>>;
  /**
   * Writes the answer to the `--out` file, after the command ran. Fails with `output-unavailable`.
   * The change may already be saved then, so the agent should look it up, not run it again.
   */
  writeOutput(
    path: FilePath,
    text: string,
  ): Promise<Result<void, LocalFailure>>;
}
