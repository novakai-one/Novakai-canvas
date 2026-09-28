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

/** Where the answer goes: the terminal, or the --out file. */
type AnswerDestination =
  { readonly kind: 'terminal' } | { readonly kind: 'file'; readonly path: FilePath };

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
  const destination = chooseDestination(outOption);
  if (destination.kind === 'terminal') {
    return success(answer);
  }
  return writeAnswer(answer, destination.path, writer);
}

/** Where the command asked for its answer: the --out file when given, otherwise the terminal. */
function chooseDestination(outOption: OutOption): AnswerDestination {
  if (outOption.out === undefined) {
    return { kind: 'terminal' };
  }
  return { kind: 'file', path: outOption.out };
}

/** Writes the answer to the --out file, then says so. Fails with `output-unavailable`. */
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
