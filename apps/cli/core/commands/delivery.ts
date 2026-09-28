/*
 * Delivering a command's answer: printed as it is, or written to the --out file with
 * `Written: FILE` printed instead. The CLI's one --out writer. Uses the injected local-files port
 * only. A failed write is returned as a value; the command already ran and is not run again.
 */
import type { FilePath } from '../../contract/brands.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { OutOption } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';

/** A command's answer: the text its flow returns. */
export type CommandAnswer = string;

/** What the terminal prints: the answer itself, or `Written: FILE` once the --out file holds it. */
export type PrintedText = string;

/** Where the answer goes: the terminal, or the --out file. */
type AnswerDestination =
  { readonly kind: 'terminal' } | { readonly kind: 'file'; readonly path: FilePath };

/** The one port delivery uses: the --out write. */
export interface OutputPorts {
  readonly files: Pick<LocalFiles, 'writeOutput'>;
}

/**
 * Delivers the command's answer where its --out option asks, and returns what the terminal
 * prints: the answer itself; or, with --out, `Written: FILE` once the file holds the answer. Fails
 * with `output-unavailable` when the file cannot be written.
 */
export async function deliverAnswer(
  answer: CommandAnswer,
  outOption: OutOption,
  ports: OutputPorts,
): Promise<Result<PrintedText>> {
  const destination = chooseDestination(outOption);
  if (destination.kind === 'terminal') {
    return success(answer);
  }
  return writeAnswer(answer, destination.path, ports);
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
  answer: CommandAnswer,
  path: FilePath,
  ports: OutputPorts,
): Promise<Result<PrintedText>> {
  const written = await ports.files.writeOutput(path, answer);
  if (!written.ok) {
    return written;
  }
  const notice = `Written: ${path}`;
  return success(notice);
}
