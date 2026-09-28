/*
 * Why this file exists
 *
 * Every command ends with a text answer. The agent reads it on screen, or asks for it in a file:
 * `pnpm canvas read my-diagram --out my-diagram.canvas` writes the file and prints
 * `Written: my-diagram.canvas`.
 *
 * This file returns the answer to print, or writes it to the `--out` file. It never touches the
 * disk itself: it writes through the writer it is handed.
 */
import type { FilePath } from '../../contract/brands.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { OutOption } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';

/** Writes the answer to the `--out` file: `writeOutput(path, text)`. */
export type OutFileWriter = Pick<LocalFiles, 'writeOutput'>;

/**
 * Returns the answer to print, or writes it to the `--out` file and returns `Written: FILE`.
 *
 * `outOption` is `{ out: FILE }` when `--out` was typed, or `{}` when it wasn't.
 * The mistake it can find: the file can't be written (`output-unavailable`). The command has
 * already run by then, so a change may already be saved.
 */
export async function printOrWriteAnswer(
  answer: string,
  outOption: OutOption,
  writer: OutFileWriter,
): Promise<Result<string>> {
  if (outOption.out === undefined) {
    return success(answer);
  }
  return writeAnswer(answer, outOption.out, writer);
}

/** Writes the answer to the `--out` file, and returns a line saying where it went. */
async function writeAnswer(
  answer: string,
  path: FilePath,
  writer: OutFileWriter,
): Promise<Result<string>> {
  const written = await writer.writeOutput(path, answer);
  if (!written.ok) {
    return written;
  }
  const notice = `Written: ${path}`;
  return success(notice);
}
