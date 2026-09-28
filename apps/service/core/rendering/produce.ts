/*
 * Why this file exists
 *
 * A render job runs on a worker thread, and its reply must be checked before anyone trusts it.
 * For example, the reply for `my-diagram` must hold a scene drawn from exactly the job that was
 * sent. And if the request was stopped while the job ran, the reply is thrown away.
 *
 * This file sends one job, drops the reply of a stopped request, then checks the reply. How the
 * worker runs and how a reply is checked are passed in. It never retries.
 */
import type { RenderReader, RenderTransport } from '../../contract/ports/rendering.js';
import type { RenderingJob, RenderDocument } from '../../contract/records/rendering/job.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/**
 * Runs one render job on the worker and checks the reply, giving back the drawn document.
 * Mistakes: `cancelled` at `render` when `signal` aborted while the job ran. The worker's and the
 * reply check's own mistakes pass through.
 */
export async function runRenderJob(
  job: RenderingJob,
  signal: AbortSignal,
  transport: RenderTransport,
  reader: RenderReader,
): Promise<Result<RenderDocument>> {
  const reply = await transport.run(job, signal);
  if (!reply.ok) {
    return reply;
  }
  if (signal.aborted) {
    return stoppedRequestFailure();
  }
  return reader.read(reply.value, job);
}

/** Makes the `cancelled` mistake at `render` for a request that was stopped while its job ran. */
function stoppedRequestFailure(): Result<never> {
  return failure('cancelled', 'render', 'A newer rendering request replaced this result');
}
