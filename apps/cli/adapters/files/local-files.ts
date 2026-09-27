/*
 * Local text files named on the command line: the UTF-8 source a command reads and the --out file
 * it writes. Both paths are checked (non-empty) before the command runs. Filesystem I/O; each
 * failure is returned as a value.
 * `readSource` fails before anything is sent: fix the path and run the command again.
 * `writeOutput` fails after the command already ran, so a write may have changed the workspace:
 * fix the path, then fetch the result with `read ID` or `receipt REQUEST` (the --request value, or
 * the file name in the workspace `requests` folder). Do not re-run a write command.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success, unreadableSource, unwritableOutput } from '../../contract/errors.js';
import type { FilePath } from '../../contract/brands.js';

/** The largest source file a command reads. */
const sourceByteLimit = 16 * 1024 * 1024;

/** Source reads and --out writes; neither needs the workspace directory. */
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
    return failure(unreadableSource(file));
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
    return failure(unwritableOutput(path));
  }
}
