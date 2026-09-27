/*
 * The local text files a command names: the UTF-8 source it reads and the --out file it writes.
 * Declaration only; adapters/files/local-files.ts implements it. Every method returns its failure
 * as a value.
 */
import type { FilePath } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';

/** Source reads and --out writes; neither needs the workspace directory. */
export interface LocalFiles {
  /**
   * The file's text, decoded as strict UTF-8, before any service request. Fails with
   * `source-too-large` or `source-unavailable`: fix the path and run the command again.
   */
  readSource(path: FilePath): Promise<Result<string, LocalFailure>>;
  /**
   * Writes `text` to the --out file after the command ran. Fails with `output-unavailable`: a
   * write command may already have changed the workspace, so fetch the result, do not re-run.
   */
  writeOutput(
    path: FilePath,
    text: string,
  ): Promise<Result<void, LocalFailure>>;
}
