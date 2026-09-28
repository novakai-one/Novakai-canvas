/*
 * Why this file exists
 *
 * Every command ends with an answer, as text. The agent either reads it on screen, or asks for it
 * in a file. `pnpm canvas read my-diagram --out my-diagram.canvas` writes the diagram to that file,
 * and prints `Written: my-diagram.canvas` instead.
 *
 * This file is the one place that makes that choice and writes the `--out` file. It writes through
 * the writer it is handed, so it never touches the disk itself.
 *
 * If the write fails, it returns the mistake as a `Result` (see `contract/errors.ts`). The command
 * has already run by then. For a command that changes a collection, the change may already be
 * saved, so the agent doesn't run it again: it fetches the result with `read ID` or
 * `receipt REQUEST_ID`. A command that only reads, such as `read`, can simply be run again.
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
 * Writes the command's answer to the `--out` file, if one was asked for.
 *
 * `answer` is the text the command made. `outOption` is `{ out: FilePath }` when `--out` was typed,
 * or `{}` when it wasn't. What comes back is the text to show on screen: the answer itself when
 * there is no `--out`, or `Written: FILE` once the file holds the answer.
 *
 * The mistake it can find: the file can't be written (`output-unavailable`).
 */
export async function deliverAnswer(
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
