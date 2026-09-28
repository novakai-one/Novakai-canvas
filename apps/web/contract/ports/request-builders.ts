/*
 * Request builders seam: builds Authoring requests, and the DSL text a source request carries,
 * from a base the caller captured, under a request ID the caller took from the ID source.
 * Declarations only; `adapters/edge/request-builders.ts` implements it with Authoring's request
 * schema and Language's printer. Nothing is sent here: builders answer a `Result` and never throw,
 * and the caller that sends owns recovery.
 */
import type { OrganisationChange } from '@novakai/canvas-library';
import type { Result } from '../errors.js';
import type { CollectionId, Direction, RequestId } from '../brands.js';
import type { EditingBase } from '../records/editor-recovery.js';
import type { Collection, Snapshot, Request, Change } from '../records/owners.js';

/** Builds the browser's Authoring requests and their DSL text. */
export interface RequestBuilders {
  /**
   * Builds a Model change request for `collection`, expecting the versions in `snapshot`.
   * Fails with `invalid-recovery` when `snapshot` lacks that live collection, or `invalid-request`.
   */
  model(
    snapshot: EditingBase,
    collection: CollectionId,
    changes: readonly Change[],
    request: RequestId,
  ): Result<Request>;
  /**
   * Builds a DSL request that creates or replaces collection `id` with `source`. Fails with
   * `invalid-recovery` when a replace base lacks that live collection, or `invalid-request`.
   */
  dsl(
    snapshot: EditingBase,
    id: CollectionId,
    source: string,
    mode: 'create' | 'replace',
    request: RequestId,
  ): Result<Request>;
  /** Builds a Library catalog request scoped to the catalog in `snapshot`. Fails with `invalid-library-request`. */
  library(
    snapshot: Snapshot,
    changes: readonly OrganisationChange[],
    request: RequestId,
  ): Result<Request>;
  /**
   * Builds the undo or redo request from Authoring's history status, or `null` when there is
   * nothing to undo or redo. Fails with `invalid-history`.
   */
  history(
    input: unknown,
    direction: Direction,
    request: RequestId,
  ): Result<Request | null>;
  /** Prints `collection` as DSL source. Fails with `source-unavailable`. */
  source(collection: Collection): Result<string>;
  /** The starter DSL for a new diagram `id` titled `title`. Cannot fail. */
  newSource(
    id: CollectionId,
    title: string,
  ): string;
}
