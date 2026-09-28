/*
 * Why this file exists
 *
 * A source can name a font or image file next to it:
 * `asset @logo image source="./assets/logo.png"`.
 * The CLI must read that file, but only from the source's own folder. A path like `../../secrets`
 * must be refused, or a source could make the CLI send any file on the machine.
 *
 * This file names that careful read. `pnpm canvas` and render:png both use it;
 * `adapters/files/resource-reader.ts` does the reading.
 */
import type { FilePath } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';
import type { ResourceRequest } from '../records/foreign.js';
import type { LocalBytes } from '../records/staged-resource.js';

/**
 * Reads a font or image a source names, only from inside the folder of `file`, the `.canvas` or
 * `.theme` file that names it. A font or image pinned by digest is never read.
 */
export interface ResourceReader {
  /**
   * Reads the file `request` names, and gives back its bytes and type. Fails when the path is
   * absolute or leaves the folder, the file can't be read, or it is the wrong type or too large.
   */
  read(
    file: FilePath,
    request: ResourceRequest,
  ): Promise<Result<LocalBytes, LocalFailure>>;
}
