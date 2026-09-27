import { parentPort } from 'node:worker_threads';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { DiagramProducer } from '../../contract/ports/rendering.js';
import type { RenderingJob } from '../../contract/records/rendering.js';
/** Parsing is injected at composition; worker transport owns no domain schema or rendering implementation. */
export interface WorkerOwners {
  readonly producer: DiagramProducer;
  read(input: unknown): Result<RenderingJob>;
}
/** The parent sends one job at a time; terminating the worker remains the hard cancellation boundary. */
export async function serveRenderWorker(owners: WorkerOwners): Promise<Result<void>> {
  const port = parentPort;
  if (port === null)
    return failure('invalid-input', 'worker', 'Rendering entry requires a worker realm');
  port.on('message', async (input: unknown) => {
    port.postMessage(await rendered(owners.read(input), owners.producer));
  });
  port.postMessage({ ready: true });
  return { ok: true, value: undefined };
}
/** Invalid messages return typed failures without invoking native measurement. */
async function rendered(
  job: Result<RenderingJob>,
  producer: DiagramProducer,
): Promise<Result<unknown>> {
  if (!job.ok) return job;
  return producer.produce(job.value, new AbortController().signal);
}
