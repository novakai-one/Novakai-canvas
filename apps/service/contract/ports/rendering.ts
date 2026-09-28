/*
 * Why this file exists
 *
 * To show a collection, the service must measure its text, place every node and route every wire.
 * That slow work runs on a separate render worker thread. For example,
 * `GET /api/v1/render?id=my-diagram` becomes one render job; the worker lays it out, and its reply
 * is checked before it goes to the browser.
 *
 * This file declares each step of that trip: build the job (`RenderJobs`), send it
 * (`RenderTransport`), check the reply (`RenderReader`), send and check (`DiagramProducer`), and
 * all three for a saved collection (`CollectionRenderer`). core/rendering builds most of them. A
 * failed render leaves the caller's last good picture in place.
 */
import type { Result } from '../errors.js';
import type { AuthoringResult, Collection } from '../records/capability-types.js';
import type { RenderDocument, RenderingJob, RenderPurpose } from '../records/rendering/job.js';
import type { WorkspaceContents } from '../records/workspace/contents.js';

/**
 * Turns one render job into a checked document. The caller keeps its last picture until it
 * succeeds.
 */
export interface DiagramProducer {
  /**
   * Renders one job and checks the result. Fails with `cancelled` when `signal` aborts,
   * `unavailable` when the worker or the compiled layout code can't finish, and `invalid-input`
   * when a capability refuses the input or the reply doesn't match the job.
   */
  produce(
    job: RenderingJob,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
}

/** Sends a job to the render worker. The reply comes back unchecked (`unknown`). */
export interface RenderTransport {
  /**
   * Runs one job on the worker and answers its reply as sent, or the failure the worker sent.
   * Fails with `cancelled` at `worker` when `signal` aborts, and `unavailable` at `worker` when the
   * worker can't start, crashes, exits, runs out of time or sends a malformed reply.
   */
  run(
    job: RenderingJob,
    signal: AbortSignal,
  ): Promise<Result<unknown>>;
}

/**
 * Checks a worker's reply. Separate from the worker, so the browser can check a reply the same way.
 */
export interface RenderReader {
  /**
   * Rebuilds the document from one reply, with each capability checking its own part. Fails with
   * `invalid-input` at `render-response` when a check fails or the reply doesn't match its job.
   */
  read(
    input: unknown,
    job: RenderingJob,
  ): Result<RenderDocument>;
}

/**
 * Builds render jobs. Separate from running them and from checking their replies. Building a job
 * answers Authoring's `Result`, because Authoring's layout check calls it.
 */
export interface RenderJobs {
  /**
   * Builds the job for one collection, with its theme, fonts and images looked up in `contents`.
   * `purpose` says why the job runs; it becomes the start of the job ID. Fails with
   * `missing-asset` at `render-resources` when a file or theme can't be used or the chosen preset
   * is not a theme, and `invalid-input` at `render-resources` when a resource is malformed.
   */
  create(
    collection: Collection,
    contents: WorkspaceContents,
    purpose: RenderPurpose,
  ): AuthoringResult<RenderingJob>;
}

/**
 * Renders one saved collection. It holds the collection's files until the worker is done, so they
 * can't be removed mid-render. A change being saved at the same time is not blocked.
 */
export interface CollectionRenderer {
  /**
   * Renders one saved collection. Fails with `unavailable` when its files can't be found or held,
   * or its job can't be built; the producer's failures pass through.
   */
  render(
    collection: Collection,
    contents: WorkspaceContents,
    signal: AbortSignal,
  ): Promise<Result<RenderDocument>>;
}
