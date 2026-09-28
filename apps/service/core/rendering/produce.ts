import type { RenderReader, RenderTransport } from '../../contract/ports/rendering.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** A worker result is a proposal until owner admission succeeds; cancellation retains the current scene. */
export async function produce(
  job: RenderingJob,
  signal: AbortSignal,
  transport: RenderTransport,
  reader: RenderReader,
): Promise<Result<RenderDocument>> {
  const output = await transport.run(job, signal);
  if (!output.ok) return output;
  if (signal.aborted)
    return failure('cancelled', 'render', 'A newer rendering request replaced this result');
  return reader.read(output.value, job);
}
