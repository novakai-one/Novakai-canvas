/*
 * The fonts and images a source declares, read from disk. Declaration only;
 * adapters/files/resource-reader.ts implements it. Service commands and render:png share it. Every
 * failure is returned as a value.
 */
import type { FilePath } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';
import type { ResourceRequest } from '../records/foreign.js';
import type { StagedResource } from '../records/staged-resource.js';

/** Reads are confined to the directory of `file`, the DSL or theme source that declares them. */
export interface ResourceReader {
  /**
   * The declaration's pinned digest (nothing is read), or its bytes ready to stage. Fails with
   * `absolute-path`, `path-escape`, `source-unavailable`, `unsupported-media`,
   * `resource-mismatch` or `resource-too-large`; the message starts with
   * `file:line:column asset @alias`.
   */
  read(
    file: FilePath,
    request: ResourceRequest,
  ): Promise<Result<StagedResource, LocalFailure>>;
}
