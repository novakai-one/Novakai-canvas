/*
 * The rendering seams: the diagram producer, the worker transport under it, the owner-bound reply
 * reader, render-job building and the committed-collection renderer. Declarations only;
 * adapters/render-worker implements the transport and reply reader, core/rendering the rest, and
 * compose binds them. A failed render keeps the caller's last accepted scene; Authoring owns
 * admission and retry.
 */
import type { Result } from '../errors.js';
import type { AuthoringResult, Collection, Scene } from '../records/capabilities.js';
import type { RenderDocument, RenderingJob } from '../records/rendering/job.js';
import type { WorkspaceContents } from '../records/workspace/contents.js';

/** Service schedules real worker work; callers keep the last accepted scene until this request succeeds. */
export interface DiagramProducer {
  /**
   * The owner-checked document for one job. Fails with `cancelled` when the signal aborts,
   * `unavailable` when the worker or native runtime cannot finish, and `invalid-input` when an
   * owner rejects the input or the reply does not match the job.
   */
  produce(
    job: RenderingJob,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
}

/** Worker transport returns unknown; the owner-bound decoder reconstructs all admitted scene content. */
export interface RenderTransport {
  /**
   * The worker's unchecked reply, or the failure the worker returned. Fails with `cancelled` at
   * `worker` when the signal aborts, and `unavailable` at `worker` when the worker cannot start,
   * crashes, exits, times out or returns a malformed result.
   */
  run(
    job: RenderingJob,
    signal: AbortSignal,
  ): Promise<Result<unknown>>;
}

/** Owner-bound decoding is separate from thread scheduling and can run in browser/contract consumers. */
export interface RenderReader {
  /**
   * Rebuilds the document from one reply with each owner's checks. Fails with `invalid-input` at
   * `render-response` when any check fails or the reply differs from its job.
   */
  read(
    input: unknown,
    job: RenderingJob,
  ): Result<RenderDocument>;
}

/** Resource-backed job construction remains separate from scheduling and rendered scene admission. */
export interface RenderJobs {
  /**
   * The job for one collection with its resources resolved. Fails with `missing-asset` at
   * `render-resources` when an owner rejects a resource or the pin is not a theme, and
   * `invalid-input` at `render-resources` when a resource does not fit its schema.
   */
  create(
    collection: Collection,
    view: WorkspaceContents,
    previous: Scene | null,
    id: string,
  ): AuthoringResult<RenderingJob>;
}

/** A committed read rendering holds its exact bytes until worker settlement independently from mutation admission. */
export interface CollectionRenderer {
  /**
   * Renders one committed collection while holding its bytes under a read lease. Fails with
   * `unavailable` when its bytes cannot be selected or leased or its job cannot be built; producer
   * failures pass through.
   */
  render(
    collection: Collection,
    workspace: WorkspaceContents,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
}
