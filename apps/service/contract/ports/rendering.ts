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
  produce(
    job: RenderingJob,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
}

/** Worker transport returns unknown; the owner-bound decoder reconstructs all admitted scene content. */
export interface RenderTransport {
  run(
    job: RenderingJob,
    signal: AbortSignal,
  ): Promise<Result<unknown>>;
}

/** Owner-bound decoding is separate from thread scheduling and can run in browser/contract consumers. */
export interface RenderReader {
  read(
    input: unknown,
    job: RenderingJob,
  ): Result<RenderDocument>;
}

/** Resource-backed job construction remains separate from scheduling and rendered scene admission. */
export interface RenderJobs {
  create(
    collection: Collection,
    view: WorkspaceContents,
    previous: Scene | null,
    id: string,
  ): AuthoringResult<RenderingJob>;
}

/** A committed read rendering holds its exact bytes until worker settlement independently from mutation admission. */
export interface CollectionRenderer {
  render(
    collection: Collection,
    workspace: WorkspaceContents,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
}
