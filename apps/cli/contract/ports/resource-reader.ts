/*
 * The fonts and images a source declares, read from disk. Declaration only;
 * adapters/files/resource-reader.ts implements it. Service commands and render:png share it. Every
 * failure is returned as a value.
 */
import type { FilePath } from '../brands.js';
import type { LocalFailure, Result } from '../errors.js';
import type { ResourceRequest } from '../records/foreign.js';
import type { LocalBytes } from '../records/staged-resource.js';

/**
 * Reads are confined to the directory of `file`, the DSL or theme source that declares them. Core
 * calls it only for a declaration whose source is a path, never for a pinned `sha256:` digest.
 */
export interface ResourceReader {
  /**
   * The declared file's bytes and media type. Fails with `absolute-path`, `path-escape`,
   * `source-unavailable`, `unsupported-media`, `resource-mismatch` or `resource-too-large`; core
   * adds the declaration's `location` to every failure.
   */
  read(
    file: FilePath,
    request: ResourceRequest,
  ): Promise<Result<LocalBytes, LocalFailure>>;
}
