/*
 * Local text files named on the command line: the UTF-8 source a command reads and the --out file
 * it writes. Filesystem I/O; each failure is returned as a value.
 * `source` fails before anything is sent: fix the path and run the command again.
 * `output` fails after the command already ran, so a write may have changed the workspace: fix the
 * path, then fetch the result with `read ID` or `receipt REQUEST` (the --request value, or the
 * file name in the workspace `requests` folder). Do not re-run a write command.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { RequestFiles } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/** Source reads and --out writes; neither needs the workspace directory. */
export function createLocalFiles(): Pick<RequestFiles, 'source' | 'output'> {
  return { source, output };
}
/** A bounded UTF-8 file is decoded strictly; unreadable inputs fail before any service request. */
async function source(path: string): Promise<Result<string>> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > 16 * 1024 * 1024)
      return failure({ code: 'source-too-large', message: 'DSL source exceeds 16 MiB' });
    return success(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return failure({ code: 'source-unavailable', message: `Cannot read UTF-8 source: ${path}` });
  }
}
/** --out is an explicit destination, written after the command ran. Never changes service data. */
async function output(
  path: string,
  text: string,
): Promise<Result<void>> {
  try {
    await writeFile(path, text, 'utf8');
    return success(undefined);
  } catch {
    return failure({ code: 'output-unavailable', message: `Cannot write output: ${path}` });
  }
}
