import type { RenderingJob, RenderDocument } from '../records/rendering/job.js';
import type { Result } from '../errors.js';
/** Owner-bound decoding is separate from thread scheduling and can run in browser/contract consumers. */
export interface RenderReader {
  read(
    input: unknown,
    job: RenderingJob,
  ): Result<RenderDocument>;
}
