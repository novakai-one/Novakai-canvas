/*
 * The render worker realm's side of the worker port: the start-up handshake, then the message
 * loop that decodes each job the parent posts, produces it and posts the result back. Impure
 * (worker port). The parent sends one job at a time and cancels a job by terminating this realm;
 * it keeps the prior scene on any failed job or failed start.
 */
import { parentPort } from 'node:worker_threads';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import type { DiagramProducer } from '../../contract/ports/rendering.js';
import type { RenderingJob } from '../../contract/records/rendering/job.js';
import { READY_HANDSHAKE, type WorkerHandshake } from '../../contract/records/rendering/worker.js';

/** Parsing is injected at composition; worker transport owns no domain schema or rendering implementation. */
export interface WorkerOwners {
  readonly producer: DiagramProducer;
  read(input: unknown): Result<RenderingJob>;
}

/**
 * The signal every job in this realm renders under. It never aborts: the parent cancels a job by
 * terminating the realm.
 */
const WORKER_REALM_SIGNAL: AbortSignal = new AbortController().signal;

/**
 * Answers every posted job, then tells the parent it is ready. Fails with `invalid-input` at
 * `worker` when this is not a worker realm.
 */
export async function serveRenderWorker(owners: WorkerOwners): Promise<Result<void>> {
  const port = parentPort;
  if (port === null)
    return failure('invalid-input', 'worker', 'Rendering entry requires a worker realm');
  port.on('message', async (input: unknown) => {
    port.postMessage(await rendered(owners.read(input), owners.producer));
  });
  port.postMessage(READY_HANDSHAKE);
  return success(undefined);
}

/**
 * Tells the parent this realm could not start, with `error` as the reason; the parent answers
 * its start-up with that failure. Does nothing outside a worker realm, where no parent listens.
 */
export function reportStartupFailure(error: Diagnostic): void {
  const port = parentPort;
  if (port === null) return;
  const refused: WorkerHandshake = { ready: false, error };
  port.postMessage(refused);
}

/** The produced document, or the job's decode failure without invoking native measurement. */
async function rendered(
  job: Result<RenderingJob>,
  producer: DiagramProducer,
): Promise<Result<unknown>> {
  if (!job.ok) return job;
  return producer.produce(job.value, WORKER_REALM_SIGNAL);
}
