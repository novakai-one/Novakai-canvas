/*
 * Local text files named on the command line: the UTF-8 source a command reads and the --out file
 * it writes. Filesystem I/O; each failure is returned as a value and nothing is sent to the service.
 * The caller fixes the path and runs the command again.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { RequestFiles } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';

/** Source reads and --out writes; neither needs the workspace directory. */
export function createLocalFiles(): Pick<RequestFiles, 'source' | 'output'> {
  return { source, output };
}
/** A bounded UTF-8 file is decoded strictly; unreadable inputs fail before any service request. */
async function source(path: string): Promise<Result<string>> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > 16 * 1024 * 1024)
      return failure('source-too-large', 'DSL source exceeds 16 MiB');
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return failure('source-unavailable', `Cannot read UTF-8 source: ${path}`);
  }
}
/** --out is an explicit destination. Writing source output never changes canonical service data. */
async function output(
  path: string,
  text: string,
): Promise<Result<void>> {
  try {
    await writeFile(path, text, 'utf8');
    return { ok: true, value: undefined };
  } catch {
    return failure('output-unavailable', `Cannot write output: ${path}`);
  }
}
