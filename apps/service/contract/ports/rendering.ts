import type { RenderingJob, RenderDocument } from '../records/rendering/job.js';
import type { Result } from '../errors.js';
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
